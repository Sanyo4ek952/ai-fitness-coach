import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { applySessionAction, createTrainingStorage, replacementOptions, restSecondsRemaining, updateRestTimer, workoutSessionSchema, type TrainingStorage } from "@/entities/training";
import { runStorageCase } from "./storage-cases";
import example from "../examples/coach-response.example.json";

const time = "2026-11-24T12:00:00Z";
const later = "2026-11-24T12:01:00Z";
const id = () => crypto.randomUUID();
async function seed(s: TrainingStorage, start = true) {
  await s.profiles.save({ id: id(), revision: 1, goal: "Синтетическая цель", experience: "unknown", sessionsPerWeek: null, equipment: ["dumbbells", "bench"], nutritionOptIn: false });
  const request = await s.coach.createInitialRequest(id(), time);
  const response = await s.coach.importResponse({ ...example, requestId: request.requestId, context: request.context });
  await s.coach.accept(response, time, true);
  const overview = await s.sessions.overview(); if (!overview.active) throw new Error("Нет программы");
  const command = { sessionId: id(), startedAt: time, expectedCursor: overview.active.cursor, expectedHistoryRevision: 0 };
  const session = start ? await s.sessions.start(command) : undefined;
  return { session, command, overview };
}
function actions(sessionInput: unknown) {
  const session = workoutSessionSchema.parse(sessionInput);
  const row = session.plannedSnapshot.exercises[0];
  const replacement = { plannedExerciseId: row.id, originalExerciseId: row.exerciseId, actualExerciseId: "leg-press", timestamp: time };
  const skip = { kind: "skipSets", sessionId: session.id, expectedHistoryRevision: 1, sets: [{ id: id(), sessionId: session.id,
    plannedExerciseId: row.id, originalExerciseId: row.exerciseId, actualExerciseId: row.exerciseId, index: 1, timestamp: time, status: "skipped" }] };
  const replace = { kind: "replace", sessionId: session.id, expectedHistoryRevision: 1, replacement };
  const timer = { sessionId: session.id, expectedTimer: null, timer: { id: id(), startedAt: time, deadline: later } };
  const done = { set: { ...skip.sets[0], status: "done", actual: { type: "reps", reps: 7, weightKg: null } }, expectedSet: null, expectedHistoryRevision: 1 };
  return { skip, replace, timer, done };
}

describe("M3-03 таймер, замены и пропуски", () => {
  it("каталог сужает ручной выбор, не смешивает помощь/отягощение и разные единицы", () => {
    expect(replacementOptions("goblet-squat").map((x) => x.id)).toContain("leg-press");
    expect(replacementOptions("db-row").every((e) => e.measurement === "reps" && e.muscleGroups[0] === "back" && e.load.type !== "assistance")).toBe(true);
    for (const name of ["plank", "treadmill-walk", "unknown", "assisted-pull-up"]) expect(replacementOptions(name)).toEqual([]);
  });
  it.each([[0, 60], [10500, 50], [60000, 0], [90000, 0]])("остаток по deadline при возврате через %s мс", (elapsed, remaining) => {
    expect(restSecondsRemaining(later, Date.parse(time) + elapsed)).toBe(remaining);
  });
  it("замена сохраняет исходный план, provenance, неизвестный вес; старое упражнение в новой форме отклоняется", () => runStorageCase({ name: "replacement", async run({ storage: s }) {
    const { session, overview } = await seed(s); const { replace, done } = actions(session);
    const changed = await s.sessions.action(replace);
    expect(changed.plannedSnapshot).toEqual(session?.plannedSnapshot);
    expect(changed.replacements).toEqual([replace.replacement]);
    await expect(s.sessions.recordSet({ ...done, expectedHistoryRevision: 2 })).rejects.toThrow("Замена");
    const saved = await s.sessions.recordSet({ ...done, expectedHistoryRevision: 2, set: { ...done.set, actualExerciseId: "leg-press" } });
    expect(saved.sets[0]).toMatchObject({ originalExerciseId: "goblet-squat", actualExerciseId: "leg-press", actual: { weightKg: null } });
    expect(await s.programs.active()).toEqual(overview.active);
    s.close(); await s.open(); expect(await s.sessions.get(saved.id)).toEqual(saved);
    const corrected = await s.sessions.recordSet({ ...done, expectedHistoryRevision: 3, expectedSet: saved.sets[0], set: { ...saved.sets[0], status: "done", actual: { type: "reps", reps: 9, weightKg: 20 } } });
    expect(corrected.sets[0]).toMatchObject({ actualExerciseId: "leg-press", originalExerciseId: "goblet-squat" });
  } }));
  it("замена оставшихся подходов сохраняет старый факт и не допускает повторную замену", () => runStorageCase({ name: "remaining", async run({ storage: s }) {
    const { session } = await seed(s); const { replace, done } = actions(session);
    await s.sessions.recordSet(done);
    const changed = await s.sessions.action({ ...replace, expectedHistoryRevision: 2 });
    expect(changed.sets[0]).toEqual(done.set);
    await expect(s.sessions.action({ ...replace, expectedHistoryRevision: 3, replacement: { ...replace.replacement, timestamp: later } })).rejects.toThrow("уже выбрана");
    expect(await s.sessions.historyRevision()).toBe(3);
  } }));
  it("неизвестная/чужая/несовместимая замена и факт без события не принимаются", () => runStorageCase({ name: "invalid", async run({ storage: s }) {
    const { session } = await seed(s); const { replace, done } = actions(session); const before = await s.sessions.overview();
    for (const actualExerciseId of ["db-bench-press", "plank", "assisted-pull-up", "unknown"]) {
      await expect(s.sessions.action({ ...replace, replacement: { ...replace.replacement, actualExerciseId } })).rejects.toThrow();
    }
    await expect(s.sessions.action({ ...replace, replacement: { ...replace.replacement, plannedExerciseId: id() } })).rejects.toThrow();
    await expect(s.sessions.recordSet({ ...done, set: { ...done.set, actualExerciseId: "leg-press" } })).rejects.toThrow();
    expect(await s.sessions.overview()).toEqual(before);
  } }));
  it("пропуск подхода и оставшихся упражнения — отдельные факты без actual/RIR и без сдвига", () => runStorageCase({ name: "skip sets", async run({ storage: s }) {
    const { session, overview } = await seed(s); const { skip, done } = actions(session);
    const one = await s.sessions.action(skip); expect(one.sets[0]).not.toHaveProperty("actual"); expect(one.sets[0]).not.toHaveProperty("rir");
    await expect(s.sessions.recordSet({ ...done, expectedHistoryRevision: 2 })).rejects.toThrow();
    const row = one.plannedSnapshot.exercises[0];
    const remaining = Array.from({ length: row.sets - 1 }, (_, i) => ({ ...skip.sets[0], id: id(), index: i + 2 }));
    const all = await s.sessions.action({ ...skip, expectedHistoryRevision: 2, sets: remaining });
    expect(all.sets).toHaveLength(row.sets); expect(all.sets.every((set) => set.status === "skipped")).toBe(true);
    expect(await s.programs.active()).toEqual(overview.active);
    const final = await s.sessions.finish({ sessionId: all.id, endedAt: later, expectedHistoryRevision: 3 });
    expect(final.status).toBe("abandoned"); expect(await s.programs.active()).toEqual(overview.active);
  } }));
  it("done+skipped завершается partial, сохраняя оба типа фактов", () => runStorageCase({ name: "partial", async run({ storage: s }) {
    const { session } = await seed(s); const { skip, done } = actions(session);
    await s.sessions.recordSet(done);
    await s.sessions.action({ ...skip, expectedHistoryRevision: 2, sets: [{ ...skip.sets[0], id: id(), index: 2 }] });
    const final = await s.sessions.finish({ sessionId: done.set.sessionId, endedAt: later, expectedHistoryRevision: 3 });
    expect(final.status).toBe("partial"); expect(final.sets.map((x) => x.status)).toEqual(["done", "skipped"]);
    expect((await s.programs.active())?.cursor.nextWorkoutIndex).toBe(1);
  } }));
  it("таймер восстанавливается без изменения истории/плана; stale stop не стирает чужой deadline", () => runStorageCase({ name: "timer", async run({ storage: s, name, track }) {
    const { session, overview } = await seed(s); const { timer } = actions(session);
    const saved = await s.sessions.timer(timer); expect(await s.sessions.historyRevision()).toBe(1);
    s.close(); await s.open(); expect((await s.sessions.overview()).session?.restTimer).toEqual(timer.timer);
    const other = track(createTrainingStorage(name)); await other.open();
    const next = { ...timer.timer, id: id(), deadline: "2026-11-24T12:02:00Z" };
    await other.sessions.timer({ ...timer, expectedTimer: timer.timer, timer: next });
    await expect(s.sessions.timer({ ...timer, expectedTimer: timer.timer, timer: null })).rejects.toThrow("Таймер изменился");
    expect((await s.sessions.get(saved.id))?.restTimer).toEqual(next);
    expect(await s.programs.active()).toEqual(overview.active);
    const final = await s.sessions.finish({ sessionId: saved.id, endedAt: later, expectedHistoryRevision: 1 });
    expect(final.restTimer).toBeNull(); await expect(s.sessions.timer(timer)).rejects.toThrow();
  } }));
  it("таймер не перезаписывает новые факты; запись подхода не сбрасывает deadline", () => runStorageCase({ name: "timer+fact", async run({ storage: s }) {
    const { session } = await seed(s); const { timer, done } = actions(session);
    await s.sessions.timer(timer); const saved = await s.sessions.recordSet(done);
    expect(saved.restTimer).toEqual(timer.timer);
    await s.sessions.timer({ ...timer, expectedTimer: timer.timer, timer: null });
    expect((await s.sessions.get(saved.id))?.sets).toEqual([done.set]); expect(await s.sessions.historyRevision()).toBe(2);
    expect(() => updateRestTimer(session, { ...timer, timer: { ...timer.timer, deadline: time } })).toThrow();
  } }));
  for (const kind of ["replace", "skipSets"] as const) it(`повтор ${kind} и две вкладки — одна запись/ревизия`, () => runStorageCase({ name: "action retry", async run({ storage: s, name, track }) {
    const { session } = await seed(s); const { replace, skip } = actions(session); const command = kind === "replace" ? replace : skip;
    const other = track(createTrainingStorage(name)); await other.open();
    const [a, b] = await Promise.all([s.sessions.action(command), other.sessions.action(command)]);
    expect(a).toEqual(b); expect(await s.sessions.historyRevision()).toBe(2);
    await s.sessions.action(command); expect(await s.sessions.historyRevision()).toBe(2);
  } }));
  it("конкурирующий пропуск не затирает done, stale revision отклоняется", () => runStorageCase({ name: "skip race", async run({ storage: s, name, track }) {
    const { session } = await seed(s); const { skip, done } = actions(session);
    const other = track(createTrainingStorage(name)); await other.open();
    const results = await Promise.allSettled([s.sessions.action(skip), other.sessions.recordSet(done)]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await s.sessions.get(skip.sessionId))?.sets).toHaveLength(1);
    await expect(s.sessions.action({ ...skip, expectedHistoryRevision: 0, sets: [{ ...skip.sets[0], id: id() }] })).rejects.toThrow();
  } }));
  it("отдельный skipped двигает курсор exactly once, без active/подходов и с replay после нового старта", () => runStorageCase({ name: "skip workout", async run({ storage: s, name, track }) {
    const { command, overview } = await seed(s, false); const other = track(createTrainingStorage(name)); await other.open();
    const [a, b] = await Promise.all([s.sessions.skipWorkout(command), other.sessions.skipWorkout(command)]);
    expect(a).toEqual(b); expect(a.status).toBe("skipped"); expect(a.sets).toEqual([]);
    expect(await s.sessions.historyRevision()).toBe(1); expect((await s.sessions.overview()).session).toBeUndefined();
    const current = await s.sessions.overview(); if (!current.active) throw new Error("Нет программы");
    expect(current.active.cursor.nextWorkoutIndex).toBe(1);
    const active = await s.sessions.start({ ...command, sessionId: id(), expectedCursor: current.active.cursor, expectedHistoryRevision: 1 });
    await s.sessions.skipWorkout(command); expect((await s.sessions.overview()).session).toEqual(active); expect(await s.sessions.historyRevision()).toBe(2);
    expect(await s.programs.get(a.programVersionId)).toEqual(overview.active?.program);
    await expect(s.sessions.skipWorkout({ ...command, sessionId: id() })).rejects.toThrow();
    await expect(s.sessions.start(command)).rejects.toThrow(); // skip ID cannot reopen as active
  } }));
  it("stale skip/start и ID чужого события не сдвигают позицию", () => runStorageCase({ name: "skip stale", async run({ storage: s }) {
    const { command } = await seed(s, false);
    await expect(s.sessions.skipWorkout({ ...command, expectedHistoryRevision: 1 })).rejects.toThrow();
    await s.sessions.skipWorkout(command);
    await expect(s.sessions.skipWorkout({ ...command, sessionId: id() })).rejects.toThrow();
    await expect(s.sessions.skipWorkout({ ...command, startedAt: later })).rejects.toThrow();
    expect(await s.sessions.historyRevision()).toBe(1);
  } }));
  for (const table of ["sessions", "counters", "programState"]) it(`rollback пропуска занятия / ${table}`, () => runStorageCase({ name: "skip rollback", async run({ storage: s }) {
    const { command } = await seed(s, false); const before = await s.sessions.overview();
    const add = IDBObjectStore.prototype.add; const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.add = function (value, key) { if (this.name === table) throw new DOMException("Synthetic quota", "QuotaExceededError"); return key === undefined ? add.call(this, value) : add.call(this, value, key); };
    IDBObjectStore.prototype.put = function (value, key) { if (this.name === table) throw new DOMException("Synthetic quota", "QuotaExceededError"); return key === undefined ? put.call(this, value) : put.call(this, value, key); };
    try { await expect(s.sessions.skipWorkout(command)).rejects.toThrow(); } finally { IDBObjectStore.prototype.add = add; IDBObjectStore.prototype.put = put; }
    expect(await s.sessions.overview()).toEqual(before); expect(await s.sessions.list()).toEqual([]);
    await s.sessions.skipWorkout(command); expect(await s.sessions.historyRevision()).toBe(1);
  } }));
  for (const kind of ["replace", "skipSets", "timer"] as const) it(`rollback ${kind} при отказе последней записи`, () => runStorageCase({ name: "action rollback", async run({ storage: s }) {
    const { session } = await seed(s); const { replace, skip, timer } = actions(session); const before = await s.sessions.overview();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) { if (this.name === (kind === "timer" ? "sessions" : "counters")) throw new DOMException("Synthetic quota", "QuotaExceededError"); return key === undefined ? put.call(this, value) : put.call(this, value, key); };
    const act = () => kind === "timer" ? s.sessions.timer(timer) : s.sessions.action(kind === "replace" ? replace : skip);
    try { await expect(act()).rejects.toThrow(); } finally { IDBObjectStore.prototype.put = put; }
    expect(await s.sessions.overview()).toEqual(before); await act();
  } }));
  it("схема не допускает поддельное происхождение, время замены и результат у skipped", () => runStorageCase({ name: "schema", async run({ storage: s }) {
    const { session } = await seed(s); const { replace, done, skip } = actions(session);
    expect(() => applySessionAction(session, { ...replace, replacement: { ...replace.replacement, timestamp: "2026-11-23T00:00:00Z" } })).toThrow();
    expect(workoutSessionSchema.safeParse({ ...session, sets: [{ ...done.set, actualExerciseId: "leg-press" }] }).success).toBe(false);
    await expect(s.sessions.action({ ...skip, sets: [{ ...skip.sets[0], actual: done.set.actual }] })).rejects.toThrow();
    await expect(s.sessions.action({ ...replace, extra: true })).rejects.toThrow();
  } }));
});
