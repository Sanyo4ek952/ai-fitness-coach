import "fake-indexeddb/auto";
import { Dexie } from "dexie";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTrainingStorage, diffPrograms, programDraftSchema, programToDraft, type CoachRequest, type TrainingStorage } from "@/entities/training";
import { TrainingDatabase } from "@/shared/infrastructure/db";
import { CoachPreview } from "@/features/coach-exchange/coach-preview";
import { ProgramVersions } from "@/features/coach-exchange/program-versions";
import example from "../examples/coach-response.example.json";

const time = "2026-11-25T10:00:00.000Z";
const later = "2026-11-25T10:01:00.000Z";
const answer = (request: CoachRequest) => ({ ...example, requestId: request.requestId, context: request.context, nutritionTips: [] });
const draft = programDraftSchema.parse(example.proposedProgram);
async function fixture(action: (s: TrainingStorage, raw: TrainingDatabase, name: string) => Promise<void>) {
  const name = `m4-03-${crypto.randomUUID()}`; const s = createTrainingStorage(name); const raw = new TrainingDatabase(name);
  try {
    await s.open(); await raw.open();
    await s.profiles.save({ id: crypto.randomUUID(), revision: 1, goal: "Синтетическая цель", experience: "unknown", sessionsPerWeek: null, equipment: ["dumbbells", "bench"], nutritionOptIn: false });
    const initial = await s.coach.createInitialRequest(crypto.randomUUID(), time);
    await s.coach.accept(await s.coach.importResponse(answer(initial)), time, true);
    await action(s, raw, name);
  } finally { s.close(); raw.close(); await Dexie.delete(name); }
}
async function overview(s: TrainingStorage) {
  const value = await s.analysis.overview(later); if (!value) throw new Error("No overview"); return value;
}
async function review(s: TrainingStorage) { return s.coach.createReviewRequest(crypto.randomUUID(), later, (await overview(s)).token); }
async function update(s: TrainingStorage) {
  const request = await review(s);
  return s.coach.accept(await s.coach.importResponse({ ...answer(request), proposedProgram: { ...draft, title: "Новый план", goalInterpretation: "Новая интерпретация" } }), later, true);
}
async function snapshot(raw: TrainingDatabase) {
  return { programs: await raw.programVersions.toArray(), sessions: await raw.sessions.toArray(), counters: await raw.counters.toArray(), state: await raw.programState.toArray(), accepted: await raw.coachAcceptances.toArray() };
}

describe("M4-03 вычисляемые отличия", () => {
  it("равные снимки, unknown RIR и отсутствующий RIR не дают фиктивных отличий", () => {
    expect(diffPrograms(draft, structuredClone(draft))).toEqual([]);
    const row = draft.workouts[0].exercises[0];
    const base = { ...draft, workouts: [{ title: "A", exercises: [{ ...row, rir: null }] }] };
    expect(diffPrograms(base, { ...base, workouts: [{ title: "A", exercises: [{ ...row, rir: undefined }] }] })).toEqual([]);
  });
  it("показывает все параметры, интерпретацию и unknown→0 без мутации", () => {
    const before = { ...draft, workouts: [{ title: "A", exercises: [{ exerciseId: "goblet-squat", sets: 2, target: { type: "reps", min: 5, max: 8, weightKg: null }, restSec: 30, rir: null }] }] };
    const after = { ...before, title: "Другое", goalInterpretation: "Новая", reviewAfterSessions: 8, workouts: [{ title: "B", exercises: [{ exerciseId: "goblet-squat", sets: 3, target: { type: "reps", min: 6, max: 9, weightKg: 0 }, restSec: 60, rir: 0, note: "<script>alert(1)</script>" }] }] };
    const old = structuredClone(before); const changes = diffPrograms(before, after);
    expect(changes).toHaveLength(11); expect(changes).toContainEqual(expect.objectContaining({ before: "Подобрать вес", after: "0" }));
    expect(changes).toContainEqual(expect.objectContaining({ before: "Неизвестен", after: "0" })); expect(before).toEqual(old);
  });
  it("добавление/удаление и перестановка повторяющихся названий сравниваются по позициям", () => {
    const a = { ...draft, workouts: [{ title: "A", exercises: draft.workouts[0].exercises.slice(0, 1) }, { title: "A", exercises: draft.workouts[1].exercises.slice(0, 1) }] };
    expect(diffPrograms(a, { ...a, workouts: [...a.workouts].reverse() }).some((item) => item.path.includes("упражнение"))).toBe(true);
    expect(diffPrograms(a, { ...a, workouts: a.workouts.slice(0, 1) }).some((item) => item.after === "Отсутствует")).toBe(true);
    expect(diffPrograms({ ...a, workouts: a.workouts.slice(0, 1) }, a).some((item) => item.before === "Отсутствует")).toBe(true);
  });
  it("смена измерения сохраняет удалённые параметры и новые секунды/метры/интенсивность", () => {
    const a = { ...draft, workouts: [{ title: "A", exercises: [{ exerciseId: "plank", sets: 1, target: { type: "duration", seconds: 20, intensity: "Спокойно" }, restSec: 0 }] }] };
    const b = { ...a, workouts: [{ title: "A", exercises: [{ exerciseId: "treadmill-walk", sets: 1, target: { type: "distance", meters: 100 }, restSec: 0 }] }] };
    expect(diffPrograms(a, b)).toContainEqual(expect.objectContaining({ before: "20 с", after: "100 м" }));
    expect(diffPrograms(a, b)).toContainEqual(expect.objectContaining({ before: '"Спокойно"', after: "Не указана" }));
    expect(() => diffPrograms(a, { ...b, unknown: true })).toThrow();
  });
  it("текст, совпадающий с маркером отсутствия, не скрывает удаление", () => {
    const before = { ...draft, workouts: [draft.workouts[0], { ...draft.workouts[0], title: "Отсутствует" }] };
    expect(diffPrograms(before, { ...before, workouts: [draft.workouts[0]] })).toContainEqual({ path: "Занятие 2 · название", kind: "removed", before: "Отсутствует", after: "Отсутствует" });
  });
});

describe("M4-03 review и версии", () => {
  it.each(["profile", "history", "active", "preview", "snapshot"])("review %s после импорта: отказ без изменений", async (change) => fixture(async (s, raw) => {
    const req = await review(s); const response = await s.coach.importResponse(answer(req));
    if (change === "profile") { const p = await s.profiles.current(); await s.profiles.save({ ...p, revision: 2, goal: "Другая цель" }); }
    if (change === "history") await raw.counters.put({ key: "historyRevision", value: 1 });
    if (change === "active") { const current = await s.programs.active(); await s.sessions.start({ sessionId: crypto.randomUUID(), startedAt: later, expectedCursor: current?.cursor, expectedHistoryRevision: 0 }); }
    if (change === "preview") await s.coach.importResponse({ ...response, summary: "Другой пакет" });
    if (change === "snapshot") { const row = await raw.coachRequests.get(req.requestId); await raw.coachRequests.put({ ...row, requestId: req.requestId, payload: { ...req, program: { ...req.program, title: "Подменённый снимок" } } }); }
    const before = await snapshot(raw); await expect(s.coach.accept(response, later, true)).rejects.toThrow(); expect(await snapshot(raw)).toEqual(before);
  }));
  it("гонка keep/update из двух вкладок: принимается только один актуальный пакет", async () => fixture(async (s, raw, name) => {
    const a = await review(s); const b = await review(s);
    const { proposedProgram: unused, ...base } = answer(a); expect(unused).toBeDefined();
    const keep = await s.coach.importResponse({ ...base, decision: "keep" }); const next = await s.coach.importResponse(answer(b));
    const other = createTrainingStorage(name);
    try { await other.open(); const results = await Promise.allSettled([s.coach.accept(keep, later, true), other.coach.accept(next, later, true)]); expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1); }
    finally { other.close(); }
    expect(await raw.coachAcceptances.count()).toBe(2);
  }));
  it("отказ последней записи analysisBaseline откатывает принятие, версию и курсор", async () => fixture(async (s, raw) => {
    const req = await review(s); const response = await s.coach.importResponse(answer(req)); const before = await snapshot(raw);
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "programState" && typeof value === "object" && value !== null && "key" in value && value.key === "analysisBaseline") throw new DOMException("Quota", "QuotaExceededError");
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
    try { await expect(s.coach.accept(response, later, true)).rejects.toThrow(); } finally { IDBObjectStore.prototype.put = put; }
    expect(await snapshot(raw)).toEqual(before); await s.coach.accept(response, later, true); expect(await s.programs.list()).toHaveLength(2);
  }));
  it("preview/reopen/reject не меняют план; UI показывает реальные отличия и экранирует текст", async () => fixture(async (s, raw) => {
    const before = await snapshot(raw); const request = await review(s);
    const response = await s.coach.importResponse({ ...answer(request), summary: "Отличий нет", proposedProgram: { ...draft, title: "<script>bad()</script>" } });
    s.close(); await s.open(); expect(await s.coach.preview(request.requestId)).toEqual(response); expect(await snapshot(raw)).toEqual(before);
    const html = renderToStaticMarkup(<CoachPreview response={response} before={request.program} />);
    expect(html).toContain("Отличия, вычисленные приложением"); expect(html).toContain("Станет:"); expect(html).not.toContain("Было: программы нет"); expect(html).not.toContain("<script>");
    await s.coach.reject(response); expect(await snapshot(raw)).toEqual(before);
  }));
  it("keep сохраняет cursor/версию, сбрасывает manual/snooze и делает другой ответ устаревшим даже при равном времени", async () => fixture(async (s, raw) => {
    const current = await s.programs.active(); if (!current) throw new Error("No active");
    await raw.programState.put({ key: "activeProgram", payload: { ...current.cursor, nextWorkoutIndex: 1 } });
    await s.analysis.act({ kind: "manual", now: later, expectedToken: (await overview(s)).token });
    await s.analysis.act({ kind: "snooze", now: later, expectedToken: (await overview(s)).token });
    const first = await review(s); const second = await review(s);
    const { proposedProgram: unused, ...base } = answer(first); expect(unused).toBeDefined();
    const keep = await s.coach.importResponse({ ...base, decision: "keep" });
    const stale = await s.coach.importResponse(answer(second)); const before = await s.programs.active();
    await s.coach.accept(keep, later, true);
    expect(await s.programs.active()).toEqual(before); expect(await s.programs.list()).toHaveLength(1);
    const analysis = await overview(s); expect(analysis.baselineKey).toBe(first.requestId); expect(analysis.reasonCodes).not.toContain("manual"); expect(analysis.deferred).toBe(false);
    await expect(s.coach.accept(stale, later, true)).rejects.toThrow("Анализ уже принят");
    await expect(s.coach.accept(keep, later, true)).rejects.toThrow("уже принят");
  }));
  it("update и возврат создают новую цепочку/ID, сохраняют всю историю и current profile baseline", async () => fixture(async (s, raw) => {
    const first = await s.programs.active(); if (!first) throw new Error("No active");
    const session = await s.sessions.start({ sessionId: crypto.randomUUID(), expectedCursor: first.cursor, expectedHistoryRevision: 0, startedAt: time });
    const row = first.workout.exercises[0];
    await s.sessions.recordSet({ expectedSet: null, expectedHistoryRevision: 1, set: { id: crypto.randomUUID(), sessionId: session.id,
      plannedExerciseId: row.id, originalExerciseId: row.exerciseId, actualExerciseId: row.exerciseId, index: 1, status: "done",
      actual: { type: "reps", reps: 7, weightKg: null }, timestamp: time } });
    await s.sessions.finish({ sessionId: session.id, expectedHistoryRevision: 2, endedAt: later });
    const history = await s.sessions.list(); const revision = await s.sessions.historyRevision();
    await update(s); const second = await s.programs.active(); if (!second) throw new Error("No active");
    const profile = await s.profiles.current(); if (!profile) throw new Error("No profile");
    await s.profiles.save({ ...profile, revision: 2, goal: "Другая цель" });
    const command = { sourceId: first.program.id, expectedToken: (await overview(s)).token, createdAt: later, reviewAcknowledged: true };
    const restored = await s.programs.rollback(command);
    expect(restored.revision).toBe(3); expect(restored.previousId).toBe(second.program.id); expect(restored.profileRevision).toBe(2);
    expect(programToDraft(restored)).toEqual(programToDraft(first.program)); expect(restored.workouts[0].id).not.toBe(first.workout.id);
    expect(await s.programs.get(first.program.id)).toEqual(first.program); expect(await s.sessions.list()).toEqual(history); expect(await s.sessions.historyRevision()).toBe(revision);
    expect((await s.programs.active())?.cursor.nextWorkoutIndex).toBe(0); expect((await overview(s)).baselineKey).toBe(restored.id); expect((await overview(s)).baselineProfileRevision).toBe(2);
    await expect(s.programs.rollback(command)).rejects.toThrow("Контекст изменился");
    expect(await raw.coachAcceptances.count()).toBe(2);
  }));
  it.each(["profile", "history", "baseline", "active", "confirmation", "source", "future"])("возврат: %s блокирует запись", async (change) => fixture(async (s, raw) => {
    const first = await s.programs.active(); if (!first) throw new Error("No active"); await update(s);
    const command = { sourceId: first.program.id, expectedToken: (await overview(s)).token, createdAt: later, reviewAcknowledged: true };
    if (change === "profile") { const p = await s.profiles.current(); await s.profiles.save({ ...p, revision: 2 }); }
    if (change === "history") await raw.counters.put({ key: "historyRevision", value: 1 });
    if (change === "active") await raw.sessions.add({ id: crypto.randomUUID(), status: "active", payload: {} });
    if (change === "baseline") { const req = await review(s); const { proposedProgram: unused, ...base } = answer(req); expect(unused).toBeDefined(); await s.coach.accept(await s.coach.importResponse({ ...base, decision: "keep" }), later, true); }
    const before = await snapshot(raw);
    await expect(s.programs.rollback({ ...command, ...(change === "confirmation" ? { reviewAcknowledged: false } : {}), ...(change === "source" ? { sourceId: crypto.randomUUID() } : {}), ...(change === "future" ? { createdAt: "2026-11-24T10:00:00.000Z" } : {}) })).rejects.toThrow();
    expect(await snapshot(raw)).toEqual(before);
  }));
  it.each(["programVersions", "programState"])("ошибка %s откатывает возврат, повтор после reopen успешен", async (table) => fixture(async (s, raw) => {
    const first = await s.programs.active(); if (!first) throw new Error("No active"); await update(s);
    const command = { sourceId: first.program.id, expectedToken: (await overview(s)).token, createdAt: later, reviewAcknowledged: true }; const before = await snapshot(raw);
    const add = IDBObjectStore.prototype.add; const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.add = function (value, key) { if (this.name === table) throw new DOMException("Quota", "QuotaExceededError"); return key === undefined ? add.call(this, value) : add.call(this, value, key); };
    IDBObjectStore.prototype.put = function (value, key) { if (this.name === table) throw new DOMException("Quota", "QuotaExceededError"); return key === undefined ? put.call(this, value) : put.call(this, value, key); };
    try { await expect(s.programs.rollback(command)).rejects.toThrow(); } finally { IDBObjectStore.prototype.add = add; IDBObjectStore.prototype.put = put; }
    expect(await snapshot(raw)).toEqual(before); s.close(); await s.open(); await s.programs.rollback(command); expect(await s.programs.list()).toHaveLength(3);
  }));
  it("две вкладки возвращают план: один commit, UI содержит подтверждение и не применяет при SSR", async () => fixture(async (s, raw, name) => {
    const first = await s.programs.active(); if (!first) throw new Error("No active"); await update(s);
    const current = await s.programs.active(); if (!current) throw new Error("No active");
    const command = { sourceId: first.program.id, expectedToken: (await overview(s)).token, createdAt: later, reviewAcknowledged: true };
    const html = renderToStaticMarkup(<ProgramVersions versions={await s.programs.list()} current={current.program} token={command.expectedToken} busy={false} onApply={async () => false} />);
    expect(html).toContain("Возврат создаёт новую версию"); expect(await s.programs.list()).toHaveLength(2);
    const other = createTrainingStorage(name); try { await other.open(); const results = await Promise.allSettled([s.programs.rollback(command), other.programs.rollback(command)]); expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1); } finally { other.close(); }
    expect(await raw.programVersions.count()).toBe(3);
  }));
  it("старый review без baseline и повреждённая ссылка не применяются; DTO не содержит provenance", async () => fixture(async (s, raw) => {
    const req = await review(s); expect(req).not.toHaveProperty("baselineKey"); const row = await raw.coachRequests.get(req.requestId); if (!row) throw new Error("No request");
    const { baselineKey: unused, ...legacy } = row; expect(unused).toBeDefined(); await raw.coachRequests.put(legacy);
    await expect(s.coach.importResponse(answer(req))).rejects.toThrow("нет baseline");
    await raw.coachRequests.put({ ...row, baselineKey: "broken" }); await expect(s.coach.importResponse(answer(req))).rejects.toThrow();
    expect(await raw.programVersions.count()).toBe(1);
  }));
});
