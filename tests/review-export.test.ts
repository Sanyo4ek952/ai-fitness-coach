import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { CoachExchange } from "@/features/coach-exchange";
import { buildReviewHistory, createTrainingStorage, workoutSessionSchema, type TrainingStorage } from "@/entities/training";
import { runStorageCase } from "./storage-cases";
import example from "../examples/coach-response.example.json";

const id = () => crypto.randomUUID();
const time = "2026-11-01T00:00:00Z";
const now = "2026-11-25T00:00:00Z";
const profile = { id: id(), revision: 1, goal: "Тест", experience: "unknown", sessionsPerWeek: null, equipment: ["dumbbells", "bench"], nutritionOptIn: false };
async function seed(s: TrainingStorage) {
  await s.profiles.save(profile);
  const request = await s.coach.createInitialRequest(id(), time);
  const response = await s.coach.importResponse({ ...example, requestId: request.requestId, context: request.context });
  await s.coach.accept(response, time, true);
}
async function token(s: TrainingStorage) {
  const analysis = await s.analysis.overview(now); if (!analysis) throw new Error("Нет анализа"); return analysis.token;
}
async function exportReview(s: TrainingStorage) { return s.coach.createReviewRequest(id(), now, await token(s)); }
function session(day: number, type: "reps" | "duration" | "distance" = "reps") {
  const sessionId = id(); const rowId = id(); const templateId = id();
  const timestamp = `2026-11-${String(day).padStart(2, "0")}T01:00:00Z`;
  const exerciseId = type === "reps" ? "goblet-squat" : type === "duration" ? "plank" : "treadmill-walk";
  const target = type === "reps" ? { type, min: 6, max: 8, weightKg: null } : type === "duration" ? { type, seconds: 30 } : { type, meters: 100 };
  const actual = type === "reps" ? { type, reps: 7, weightKg: null } : type === "duration" ? { type, seconds: 10.25 } : { type, meters: 50.5 };
  return workoutSessionSchema.parse({ id: sessionId, programVersionId: id(), templateId,
    plannedSnapshot: { id: templateId, title: "А", exercises: [{ id: rowId, exerciseId, sets: 2, target, restSec: 60 }] },
    startedAt: timestamp, endedAt: timestamp, status: "partial", sets: [{ id: id(), sessionId, plannedExerciseId: rowId,
      originalExerciseId: exerciseId, actualExerciseId: exerciseId, index: 1, timestamp, status: "done", actual }] });
}

describe("M4-02 агрегаты review", () => {
  it("последние 20, общий итог всех версий, стабильный порядок независимо от входа", () => {
    const sessions = Array.from({ length: 23 }, (_, index) => session(index + 1));
    const result = buildReviewHistory(sessions);
    expect(result).toEqual(buildReviewHistory([...sessions].reverse()));
    expect(result.recentSessions).toHaveLength(20); expect(result.recentSessions[0].id).toBe(sessions[22].id);
    expect(result.historySummary[0]).toMatchObject({ sessionCount: 23, doneSetCount: 23, total: 161 });
    expect(result.historySummary[0]).not.toHaveProperty("weightKg");
  });
  it("время, дистанция и повторы раздельны; дроби сохраняются, план не становится фактом", () => {
    const result = buildReviewHistory([session(1), session(2, "duration"), session(3, "distance")]);
    expect(result.historySummary.map((item) => [item.exerciseId, item.unit, item.total])).toEqual([
      ["goblet-squat", "reps", 7], ["plank", "seconds", 10.25], ["treadmill-walk", "meters", 50.5],
    ]);
  });
  it("active/abandoned/skipped исключены; пропущенный подход не увеличивает объём", () => {
    const s = session(1); const skipped = { ...s.sets[0], id: id(), index: 2, status: "skipped", actual: undefined };
    const { actual: _actual, ...skippedSet } = skipped; expect(_actual).toBeUndefined();
    expect(buildReviewHistory([{ ...s, sets: [...s.sets, skippedSet] }, { ...s, id: id(), status: "active", endedAt: null, sets: [] },
      { ...s, id: id(), status: "abandoned", sets: [] }, { ...s, id: id(), status: "skipped", sets: [] }]).historySummary[0].doneSetCount).toBe(1);
  });
  it("фактическая замена получает отдельную группу, unknown и нулевой вес сохраняются в фактах", () => {
    const s = session(1); const set = s.sets[0]; if (set.status !== "done" || set.actual.type !== "reps") throw new Error("Нет факта");
    const replaced = { ...s, replacements: [{ plannedExerciseId: set.plannedExerciseId, originalExerciseId: set.originalExerciseId, actualExerciseId: "leg-press", timestamp: s.startedAt }],
      sets: [set, { ...set, id: id(), index: 2, actualExerciseId: "leg-press", actual: { ...set.actual, weightKg: 0 } }], status: "completed" };
    const result = buildReviewHistory([replaced]); expect(result.historySummary.map((item) => item.exerciseId)).toEqual(["goblet-squat", "leg-press"]);
    expect(result.recentSessions[0].sets).toEqual(replaced.sets);
  });
  it("повреждённый факт отклоняется, пустая история допустима", () => {
    expect(buildReviewHistory([])).toEqual({ recentSessions: [], historySummary: [] });
    expect(() => buildReviewHistory([{ ...session(1), sets: [{ status: "done" }] }])).toThrow();
  });
});

describe("M4-02 транзакционный экспорт", () => {
  it("индикатор перед длинным экспортом; SSR без DB", () => {
    const html = renderToStaticMarkup(createElement(CoachExchange, null, createElement("div", { role: "alert" }, "Safety marker")));
    expect(html.indexOf("Safety marker")).toBeLessThan(html.indexOf("Загружаем локальный обмен"));
    expect(html).not.toContain("1. Передать запрос");
    expect(html).toContain("Загружаем локальный обмен");
  });
  it("без активной программы review не создаётся", () => runStorageCase({ name: "no review program", async run({ storage: s, raw }) {
    await s.profiles.save(profile);
    await expect(s.coach.createReviewRequest(id(), now, "missing")).rejects.toThrow(); expect(await raw.coachRequests.count()).toBe(0);
  } }));
  it.each(["future", "snapshot"])("повреждённая история %s запрещает частичный экспорт", (change) => runStorageCase({ name: "bad review history", async run({ storage: s, raw }) {
    await seed(s); const current = await s.programs.active(); if (!current) throw new Error("Нет программы");
    const saved = { ...session(2), programVersionId: current.program.id, templateId: current.workout.id, plannedSnapshot: current.workout,
      status: "abandoned", sets: [], ...(change === "future" ? { startedAt: "2026-11-26T00:00:00Z", endedAt: "2026-11-26T00:00:00Z" }
        : { plannedSnapshot: { ...current.workout, title: "Подменённый снимок" } }) };
    await raw.sessions.add({ id: saved.id, status: saved.status, payload: saved }); await raw.counters.put({ key: "historyRevision", value: 1 });
    await expect(exportReview(s)).rejects.toThrow(change === "future" ? "будущие даты" : "сохранённым версиям");
    expect(await raw.coachRequests.count()).toBe(1);
  } }));
  it("review переживает reopen; фото/внутренний профиль исключены; состояние не меняется", () => runStorageCase({ name: "review", async run({ storage: s, raw }) {
    await seed(s); const before = await s.sessions.overview(); const state = await raw.programState.toArray();
    const request = await exportReview(s);
    expect(request.mode).toBe("review"); expect(request.program?.id).toBe(before.active?.program.id);
    expect(request.reasonCodes).toEqual(["manual"]); expect(request.context.historyRevision).toBe(0);
    expect(request.profile).not.toHaveProperty("id"); expect(JSON.stringify(request)).not.toMatch(/"(?:photos|EXIF|measurements|contacts)"/);
    s.close(); await s.open(); expect(await s.coach.getRequest(request.requestId)).toEqual(request);
    expect(await s.sessions.overview()).toEqual(before); expect(await raw.programState.toArray()).toEqual(state);
  } }));
  it.each(["profile", "history", "control", "program"])("устаревший %s token отклоняется без request", (change) => runStorageCase({ name: "stale review", async run({ storage: s, raw, name, track }) {
    await seed(s); const expected = await token(s); const other = track(createTrainingStorage(name)); await other.open();
    if (change === "profile") await other.profiles.save({ ...profile, revision: 2, goal: "Другая цель" });
    if (change === "history") await raw.counters.put({ key: "historyRevision", value: 1 });
    if (change === "control") await other.analysis.act({ kind: "manual", now, expectedToken: expected });
    if (change === "program") await raw.programState.delete("activeProgram");
    await expect(s.coach.createReviewRequest(id(), now, expected)).rejects.toThrow("Контекст анализа изменился");
    expect(await raw.coachRequests.count()).toBe(1);
  } }));
  it("активное занятие запрещает экспорт без новой записи", () => runStorageCase({ name: "active review", async run({ storage: s, raw }) {
    await seed(s); const current = await s.sessions.overview(); if (!current.active) throw new Error("Нет программы");
    await s.sessions.start({ sessionId: id(), startedAt: now, expectedCursor: current.active.cursor, expectedHistoryRevision: 0 });
    await expect(exportReview(s)).rejects.toThrow("завершите активное занятие"); expect(await raw.coachRequests.count()).toBe(1);
  } }));
  it("сохранённый профиль новой ревизии, причины и история читаются вместе", () => runStorageCase({ name: "review facts", async run({ storage: s, raw }) {
    await seed(s); const current = await s.programs.active(); if (!current) throw new Error("Нет программы");
    const row = current.workout.exercises[0]; const fact = session(2); const set = fact.sets[0];
    const saved = workoutSessionSchema.parse({ ...fact, programVersionId: current.program.id, templateId: current.workout.id, plannedSnapshot: current.workout,
      sets: [{ ...set, plannedExerciseId: row.id, originalExerciseId: row.exerciseId, actualExerciseId: row.exerciseId, pain: true, note: "Тестовый комментарий" }] });
    await s.sessions.save(saved, 0);
    await s.profiles.save({ ...profile, revision: 2, goal: "Новая цель" });
    const before = await raw.sessions.toArray(); const request = await exportReview(s);
    expect(request.context).toMatchObject({ profileRevision: 2, historyRevision: 1 });
    expect(request.reasonCodes).toEqual(["safety", "changed_context", "manual"]);
    expect(request.recentSessions).toEqual([saved]); expect(request.historySummary[0].doneSetCount).toBe(1);
    expect(await raw.sessions.toArray()).toEqual(before);
  } }));
  it("отказ add не сохраняет request и не меняет программу/сигнал; повтор успешен", () => runStorageCase({ name: "quota review", async run({ storage: s, raw }) {
    await seed(s); const before = await s.sessions.overview(); const expected = await token(s); const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(value: unknown, key?: IDBValidKey) {
      if (this.name === "coachRequests") throw new DOMException("Synthetic quota", "QuotaExceededError");
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
    try { await expect(s.coach.createReviewRequest(id(), now, expected)).rejects.toThrow(); } finally { IDBObjectStore.prototype.add = original; }
    expect(await raw.coachRequests.count()).toBe(1); expect(await s.sessions.overview()).toEqual(before); expect(await token(s)).toBe(expected);
    expect((await exportReview(s)).mode).toBe("review");
  } }));
  it("одинаковый requestId из двух соединений сохраняется один раз", () => runStorageCase({ name: "race review", async run({ storage: s, raw, name, track }) {
    await seed(s); const other = track(createTrainingStorage(name)); await other.open(); const expected = await token(s); const requestId = id();
    const results = await Promise.allSettled([s.coach.createReviewRequest(requestId, now, expected), other.coach.createReviewRequest(requestId, now, expected)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1); expect(await raw.coachRequests.count()).toBe(2);
    expect(await token(s)).toBe(expected);
  } }));
});
