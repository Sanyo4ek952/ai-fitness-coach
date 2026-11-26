import "fake-indexeddb/auto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { liveQuery } from "dexie";
import { describe, expect, it } from "vitest";
import { buildProgress, createTrainingStorage, programVersionSchema, workoutSessionSchema, type WorkoutSession } from "@/entities/training";
import { ProgressSummary, TrainingProgress } from "@/features/training-progress/training-progress";
import { runStorageCase } from "./storage-cases";

const id = () => crypto.randomUUID();
const time = "2026-11-01T01:00:00Z";
function session(exerciseId = "goblet-squat", value = 7, weightKg: number | null = null, day = 1) {
  const sessionId = id(); const rowId = id(); const templateId = id();
  const timestamp = `2026-11-${String(day).padStart(2, "0")}T01:00:00Z`;
  const actual = exerciseId === "plank" ? { type: "duration", seconds: value }
    : exerciseId === "treadmill-walk" ? { type: "distance", meters: value } : { type: "reps", reps: value, weightKg };
  const target = actual.type === "reps" ? { type: "reps", min: 6, max: 8, weightKg: 90 }
    : actual.type === "duration" ? { type: "duration", seconds: 90 } : { type: "distance", meters: 100 };
  return workoutSessionSchema.parse({ id: sessionId, programVersionId: id(), templateId,
    plannedSnapshot: { id: templateId, title: "A", exercises: [{ id: rowId, exerciseId, sets: 2, target, restSec: 60 }] },
    startedAt: timestamp, endedAt: timestamp, status: "partial", sets: [{ id: id(), sessionId, plannedExerciseId: rowId,
      originalExerciseId: exerciseId, actualExerciseId: exerciseId, index: 1, timestamp, status: "done", actual }] });
}
function summary(sessions: readonly WorkoutSession[], goal: string | null = "Сила") {
  return renderToStaticMarkup(createElement(ProgressSummary, { value: { goal, historyRevision: 1, ...buildProgress(sessions) } }));
}

describe("M5-01 фактическая работа", () => {
  it("пусто без обязательного графика и без анкеты", () => {
    expect(buildProgress([]).exercises).toEqual([]);
    const html = summary([], null);
    expect(html).toContain("История появится после занятия"); expect(html).not.toContain("<figure");
    expect(html).not.toContain("<input"); expect(html).toContain('href="/workout');
  });
  it("SSR без обращения к IndexedDB и синтетических результатов", () => {
    const html = renderToStaticMarkup(createElement(TrainingProgress));
    expect(html).toContain("Читаем историю"); expect(html).not.toContain("<figure");
  });
  it("вся история, все версии, стабильная хронология, вход не меняется", () => {
    const sessions = Array.from({ length: 25 }, (_, index) => session("goblet-squat", 7, null, index + 1));
    const before = JSON.stringify(sessions); const result = buildProgress(sessions);
    expect(result).toEqual(buildProgress([...sessions].reverse()));
    expect(result.exercises[0]).toMatchObject({ total: 175, doneSetCount: 25 });
    expect(result.exercises[0].points).toHaveLength(25); expect(JSON.stringify(sessions)).toBe(before);
    const html = summary(sessions); expect(html).toContain("Последние 12"); expect(html).toContain("Показать ещё до 12 занятий");
    expect((html.match(/progress-bar-track/g) ?? []).length).toBe(12);
  });
  it("равное время упорядочено по id, не по входному массиву", () => {
    const sessions = [session(), session()]; expect(buildProgress(sessions)).toEqual(buildProgress([...sessions].reverse()));
  });
  it("повторы, секунды, метры и разные упражнения раздельны, дроби сохраняются", () => {
    const result = buildProgress([session(), session("plank", 25.5), session("treadmill-walk", 125.5), session("leg-press", 8)]);
    expect(result.exercises.map((item) => [item.exercise.id, item.total, item.unit])).toEqual([
      ["goblet-squat", 7, "повт."], ["leg-press", 8, "повт."], ["plank", 25.5, "с"], ["treadmill-walk", 125.5, "м"],
    ]);
  });
  it("completed/partial дают работу; skipped/active/abandoned — только отдельные счётчики", () => {
    const s = session();
    const completed = workoutSessionSchema.parse({ ...session(), status: "completed", plannedSnapshot: { ...s.plannedSnapshot, id: s.templateId },
      id: s.id, templateId: s.templateId, sets: [s.sets[0], { ...s.sets[0], id: id(), index: 2 }] });
    const others = ["active", "abandoned", "skipped"].map((status) => ({ ...session(), status,
      ...(status === "skipped" ? { sets: [] } : {}), endedAt: status === "active" ? null : time }));
    const result = buildProgress([completed, session(), ...others]);
    expect(result.counts).toEqual({ completed: 1, partial: 1, active: 1, abandoned: 1, skipped: 1 });
    expect(result.exercises[0]).toMatchObject({ total: 21, doneSetCount: 3 }); expect(result.exercises[0].points).toHaveLength(2);
  });
  it("skipped подход не увеличивает объём и не создаёт нулевую точку", () => {
    const s = session(); const done = s.sets[0]; if (done.status !== "done") throw new Error("Нет факта");
    const { actual: _actual, ...set } = done; expect(_actual).toBeDefined();
    const skipped = { ...set, id: id(), index: 2, status: "skipped" };
    expect(buildProgress([{ ...s, sets: [...s.sets, skipped] }]).exercises[0].total).toBe(7);
  });
  it("замена группируется по actualExerciseId без потери исходного ID", () => {
    const s = session(); const set = s.sets[0];
    const replaced = workoutSessionSchema.parse({ ...s, replacements: [{ plannedExerciseId: set.plannedExerciseId,
      originalExerciseId: "goblet-squat", actualExerciseId: "leg-press", timestamp: s.startedAt }],
      sets: [set, { ...set, id: id(), index: 2, actualExerciseId: "leg-press" }], status: "completed" });
    const result = buildProgress([replaced]); expect(result.exercises.map((item) => item.exercise.id)).toEqual(["goblet-squat", "leg-press"]);
    expect(result.exercises[1].points[0].sets[0].originalExerciseId).toBe("goblet-squat");
    expect(summary([replaced])).toContain("замена упражнения");
  });
  it("unknown, 0, разные веса и RIR остаются фактами без тоннажа/оценки силы", () => {
    const sessions = [session(), session("goblet-squat", 8, 0), session("goblet-squat", 9, 12.5)];
    const result = buildProgress(sessions); expect(result.exercises[0].total).toBe(24);
    expect(result.exercises[0]).not.toHaveProperty("tonnage");
    const html = summary(sessions); expect(html).toContain("вес неизвестен"); expect(html).toContain("0 кг");
    expect(html).toContain("12,5 кг"); expect(html).toContain("RIR неизвестен"); expect(html).toContain("не сравнение силы");
    expect(html).not.toContain("90 кг");
  });
  it("RIR0 известен; помощь/добавочный/одна гантель подписаны отдельно", () => {
    const s = session("assisted-pull-up", 7, 20);
    const html = summary([workoutSessionSchema.parse({ ...s, sets: [{ ...s.sets[0], rir: 0 }] }), session("push-up", 8, 0), session("db-row", 9, 10)]);
    expect(html).toContain("RIR 0"); expect(html).toContain("Помощь тренажёра");
    expect(html).toContain("Добавочный вес"); expect(html).toContain("Вес одной гантели");
  });
  it("малые дробные факты не отображаются нулями", () => {
    const html = summary([session("goblet-squat", 7, 0.001), session("plank", 0.001), session("treadmill-walk", 0.0005)]);
    expect(html).toContain("0,001 кг"); expect(html).toContain("0,001 с"); expect(html).toContain("0,0005 м");
  });
  it("две строки одного упражнения — одна точка занятия, подходы не теряются", () => {
    const s = session(); const row = { ...s.plannedSnapshot.exercises[0], id: id() };
    const combined = { ...s, plannedSnapshot: { ...s.plannedSnapshot, exercises: [...s.plannedSnapshot.exercises, row] },
      sets: [...s.sets, { ...s.sets[0], id: id(), plannedExerciseId: row.id }] };
    const result = buildProgress([combined]); expect(result.exercises[0]).toMatchObject({ total: 14, doneSetCount: 2 });
    expect(result.exercises[0].points).toHaveLength(1); expect(result.exercises[0].points[0].sets).toHaveLength(2);
  });
  it("одна точка без графика; доступные даты/значения/частичность для двух", () => {
    expect(summary([session()])).not.toContain("<figure");
    const html = summary([session(), session()]); expect(html).toContain("<figcaption");
    expect(html).toContain("7 повт."); expect(html).toContain("частично"); expect(html).toContain("<time");
  });
  it("цель — экранированный текст, без интерпретации и HTML", () => {
    const html = summary([], "<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
  });
  it.each(["duplicate", "invalid"])("повреждённая история %s не превращается в частичный итог", (kind) => {
    const s = session(); expect(() => buildProgress(kind === "duplicate" ? [s, s] : [s, { ...s, sets: [{ status: "done" }] }])).toThrow();
  });
});

describe("M5-01 согласованное чтение IndexedDB", () => {
  async function seed(raw: Parameters<Parameters<typeof runStorageCase>[0]["run"]>[0]["raw"], s = session()) {
    const version = programVersionSchema.parse({ id: s.programVersionId, revision: 1, previousId: null, profileRevision: 1,
      createdAt: time, title: "Тест", goalInterpretation: "Тест", workouts: [s.plannedSnapshot], reviewAfterSessions: 2 });
    await raw.programVersions.add({ id: version.id, revision: 1, payload: version });
    await raw.sessions.add({ id: s.id, status: s.status, payload: s });
    await raw.counters.put({ key: "historyRevision", value: 1 });
    return s;
  }
  it("пустая БД читается без создания профиля и записей", () => runStorageCase({ name: "empty progress", async run({ storage, raw }) {
    expect(await storage.progress.overview()).toEqual({ goal: null, historyRevision: 0, ...buildProgress([]) });
    expect(await raw.profileRevisions.count()).toBe(0); expect(await raw.counters.count()).toBe(0);
  } }));
  it("повторное открытие, текущая цель и все факты без единой записи", () => runStorageCase({ name: "progress persists", async run({ storage, raw }) {
    const s = await seed(raw);
    const profile = { id: id(), revision: 1, goal: "Прежняя цель", experience: "unknown", sessionsPerWeek: null, equipment: ["unknown"], nutritionOptIn: false };
    await storage.profiles.save(profile);
    await storage.profiles.save({ ...profile, revision: 2, goal: "Моя цель" });
    const before = await Promise.all(raw.tables.map((table) => table.toArray()));
    const value = await storage.progress.overview(); expect(value.goal).toBe("Моя цель"); expect(value.exercises[0].total).toBe(7);
    storage.close(); await storage.open(); expect(await storage.progress.overview()).toEqual(value);
    expect(await Promise.all(raw.tables.map((table) => table.toArray()))).toEqual(before);
    expect(value.exercises[0].points[0].sets).toEqual(s.sets);
  } }));
  it.each(["snapshot", "envelope", "counter"])("ошибка %s не скрывается пустой аналитикой", (kind) => runStorageCase({ name: "corrupt progress", async run({ storage, raw }) {
    const s = await seed(raw);
    if (kind === "snapshot") await raw.sessions.put({ id: s.id, status: s.status, payload: { ...s, plannedSnapshot: { ...s.plannedSnapshot, title: "Подмена" } } });
    if (kind === "envelope") await raw.sessions.put({ id: s.id, status: "completed", payload: s });
    if (kind === "counter") await raw.counters.delete("historyRevision");
    await expect(storage.progress.overview()).rejects.toThrow(); expect(await raw.sessions.count()).toBe(1);
  } }));
  it("liveQuery видит commit другой связи: ревизия и работа согласованы", () => runStorageCase({ name: "live progress", async run({ storage, raw, name, track }) {
    const s = await seed(raw); const other = track(createTrainingStorage(name)); await other.open();
    let subscription: { unsubscribe(): void } | undefined;
    try {
      const changed = new Promise<void>((resolve, reject) => {
        subscription = liveQuery(() => storage.progress.overview()).subscribe({ next: (value) => {
          try {
            if (value.historyRevision === 1) expect(value.exercises[0].total).toBe(7);
            if (value.historyRevision === 2) { expect(value.exercises[0].total).toBe(8); resolve(); }
          } catch (error) { reject(error); }
        }, error: reject });
      });
      // sessions.save is an atomic facts + revision write through a second connection.
      const set = s.sets[0]; if (set.status !== "done" || set.actual.type !== "reps") throw new Error("Нет повторов");
      await other.sessions.save({ ...s, sets: [{ ...set, actual: { ...set.actual, reps: 8 } }] }, 1);
      await changed;
    } finally { subscription?.unsubscribe(); }
  } }));
});
