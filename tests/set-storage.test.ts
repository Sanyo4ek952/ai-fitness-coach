import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createTrainingStorage, type TrainingStorage } from "@/entities/training";
import { runStorageCase } from "./storage-cases";
import example from "../examples/coach-response.example.json";

const time = "2026-11-24T12:00:00Z";
async function seed(s: TrainingStorage) {
  await s.profiles.save({ id: crypto.randomUUID(), revision: 1, goal: "Синтетическая цель", experience: "unknown", sessionsPerWeek: null, equipment: ["dumbbells", "bench"], nutritionOptIn: false });
  const request = await s.coach.createInitialRequest(crypto.randomUUID(), time);
  const response = await s.coach.importResponse({ ...example, requestId: request.requestId, context: request.context });
  await s.coach.accept(response, time, true);
  const overview = await s.sessions.overview(); if (!overview.active) throw new Error("Нет программы");
  const session = await s.sessions.start({ sessionId: crypto.randomUUID(), startedAt: time, expectedCursor: overview.active.cursor, expectedHistoryRevision: 0 });
  const row = session.plannedSnapshot.exercises[0];
  const command = { set: { id: crypto.randomUUID(), sessionId: session.id, plannedExerciseId: row.id, originalExerciseId: row.exerciseId, actualExerciseId: row.exerciseId,
    index: 1, status: "done", timestamp: time, actual: { type: "reps", reps: 7, weightKg: null }, rir: null }, expectedSet: null, expectedHistoryRevision: 1 };
  return { session, command, overview };
}
describe("M3-02 атомарная запись подходов", () => {
  it("все подходы через recordSet → completed и один сдвиг", () => runStorageCase({ name: "completed", async run({ storage: s }) {
    const { session, command } = await seed(s);
    let revision = 1;
    for (const row of session.plannedSnapshot.exercises) for (let index = 1; index <= row.sets; index++) {
      await s.sessions.recordSet({ ...command, expectedHistoryRevision: revision++, set: { ...command.set, id: crypto.randomUUID(), plannedExerciseId: row.id,
        originalExerciseId: row.exerciseId, actualExerciseId: row.exerciseId, index } });
    }
    const final = await s.sessions.finish({ sessionId: session.id, endedAt: time, expectedHistoryRevision: revision });
    expect(final.status).toBe("completed"); expect((await s.programs.active())?.cursor.nextWorkoutIndex).toBe(1);
    expect(final.plannedSnapshot).toEqual(session.plannedSnapshot);
  } }));
  it("start → save → reopen → edit → finish, план/версия/курсор отделены от факта", () => runStorageCase({ name: "log", async run({ storage: s }) {
    const { session, command, overview } = await seed(s); const saved = await s.sessions.recordSet(command);
    expect(saved.sets).toEqual([command.set]); expect(await s.sessions.historyRevision()).toBe(2);
    expect(await s.programs.active()).toEqual(overview.active); s.close(); await s.open(); expect(await s.sessions.get(session.id)).toEqual(saved);
    const correction = { ...command, expectedSet: saved.sets[0], expectedHistoryRevision: 2, set: { ...command.set, actual: { type: "reps", reps: 9, weightKg: 12.5 }, rir: 0 } };
    const edited = await s.sessions.recordSet(correction); expect(await s.sessions.historyRevision()).toBe(3);
    expect(edited.plannedSnapshot).toEqual(session.plannedSnapshot); expect(await s.programs.get(session.programVersionId)).toEqual(overview.active?.program);
    const final = await s.sessions.finish({ sessionId: session.id, endedAt: time, expectedHistoryRevision: 3 });
    expect(final.status).toBe("partial"); expect(final.sets[0]).toEqual(correction.set); expect((await s.programs.active())?.cursor.nextWorkoutIndex).toBe(1);
    await s.sessions.finish({ sessionId: session.id, endedAt: time, expectedHistoryRevision: 3 }); expect(await s.sessions.historyRevision()).toBe(4);
  } }));
  it("повтор/двойной вызов одной команды идемпотентен", () => runStorageCase({ name: "retry", async run({ storage: s, name, track }) {
    const { command } = await seed(s); const other = track(createTrainingStorage(name)); await other.open();
    const [a, b] = await Promise.all([s.sessions.recordSet(command), other.sessions.recordSet(command)]); expect(a).toEqual(b);
    expect(a.sets).toHaveLength(1); expect(await s.sessions.historyRevision()).toBe(2);
    await s.sessions.recordSet(command); expect(await s.sessions.historyRevision()).toBe(2);
  } }));
  it("два разных ID на один слот и устаревшие команды не дублируют факт", () => runStorageCase({ name: "race", async run({ storage: s, name, track }) {
    const { command } = await seed(s); const other = track(createTrainingStorage(name)); await other.open();
    const results = await Promise.allSettled([s.sessions.recordSet(command), other.sessions.recordSet({ ...command, set: { ...command.set, id: crypto.randomUUID() } })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1); expect(await s.sessions.historyRevision()).toBe(2);
    const saved = await s.sessions.get(command.set.sessionId); expect(saved?.sets).toHaveLength(1);
    await expect(s.sessions.recordSet({ ...command, expectedHistoryRevision: 2, set: { ...command.set, id: crypto.randomUUID() } })).rejects.toThrow();
    expect(await s.sessions.get(command.set.sessionId)).toEqual(saved);
  } }));
  it("конкурирующие исправления и прежний baseline не затирают результат", () => runStorageCase({ name: "edit race", async run({ storage: s, name, track }) {
    const { command } = await seed(s); const saved = await s.sessions.recordSet(command); const other = track(createTrainingStorage(name)); await other.open();
    const edit = { ...command, expectedSet: saved.sets[0], expectedHistoryRevision: 2, set: { ...command.set, rir: 0 } };
    const results = await Promise.allSettled([s.sessions.recordSet(edit), other.sessions.recordSet({ ...edit, set: { ...edit.set, rir: 1 } })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1); expect(await s.sessions.historyRevision()).toBe(3);
    const current = await s.sessions.get(command.set.sessionId);
    await expect(s.sessions.recordSet({ ...edit, expectedHistoryRevision: 3, set: { ...edit.set, rir: 2 } })).rejects.toThrow();
    expect(await s.sessions.get(command.set.sessionId)).toEqual(current);
  } }));
  for (const table of ["sessions", "counters"]) for (const edit of [false, true]) it(`rollback ${table}, edit=${edit}`, () => runStorageCase({ name: "rollback", async run({ storage: s }) {
    const { command } = await seed(s); const saved = edit ? await s.sessions.recordSet(command) : undefined;
    const attempt = edit ? { ...command, expectedSet: saved?.sets[0], expectedHistoryRevision: 2, set: { ...command.set, rir: 0 } } : command;
    const before = await s.sessions.overview(); const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) { if (this.name === table) throw new DOMException("Synthetic quota", "QuotaExceededError"); return key === undefined ? original.call(this, value) : original.call(this, value, key); };
    try { await expect(s.sessions.recordSet(attempt)).rejects.toThrow(); } finally { IDBObjectStore.prototype.put = original; }
    expect(await s.sessions.overview()).toEqual(before); await s.sessions.recordSet(attempt);
    expect(await s.sessions.historyRevision()).toBe(before.historyRevision + 1);
  } }));
  it("после finish можно исправить прежний факт, без смены статуса/курсора; новый факт запрещён", () => runStorageCase({ name: "terminal", async run({ storage: s }) {
    const { command } = await seed(s); const saved = await s.sessions.recordSet(command);
    const final = await s.sessions.finish({ sessionId: command.set.sessionId, endedAt: time, expectedHistoryRevision: 2 }); const active = await s.programs.active();
    const corrected = await s.sessions.recordSet({ ...command, expectedSet: saved.sets[0], expectedHistoryRevision: 3, set: { ...command.set, rir: 0 } });
    expect(corrected.status).toBe(final.status); expect(corrected.endedAt).toBe(final.endedAt); expect(await s.programs.active()).toEqual(active);
    await expect(s.sessions.recordSet({ ...command, expectedHistoryRevision: 4, set: { ...command.set, id: crypto.randomUUID(), index: 2 } })).rejects.toThrow();
    await expect(s.sessions.recordSet(command)).rejects.toThrow(); // old replay cannot undo the correction
    expect(await s.sessions.historyRevision()).toBe(4);
  } }));
  it("чужая сессия/строка/тип/индекс/ревизия не меняют DB", () => runStorageCase({ name: "boundaries", async run({ storage: s }) {
    const { command } = await seed(s); const before = await s.sessions.overview();
    for (const patch of [{ sessionId: crypto.randomUUID() }, { plannedExerciseId: crypto.randomUUID() }, { index: 20 }, { actual: { type: "distance", meters: 2 } }]) {
      await expect(s.sessions.recordSet({ ...command, set: { ...command.set, ...patch } })).rejects.toThrow();
    }
    await expect(s.sessions.recordSet({ ...command, expectedHistoryRevision: 0 })).rejects.toThrow(); expect(await s.sessions.overview()).toEqual(before);
  } }));
});
