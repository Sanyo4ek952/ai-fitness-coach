import { createTrainingStorage, type TrainingStorage, type WorkoutSession } from "@/entities/training";
import type { StorageCase } from "./storage-cases";
import example from "../examples/coach-response.example.json";

const time = "2026-11-24T12:00:00.000Z";
const later = "2026-11-24T12:01:00.000Z";
const end = "2026-11-24T12:02:00.000Z";
function assert(value: unknown, message = "Проверка не выполнена"): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown) { assert(JSON.stringify(actual) === JSON.stringify(expected), "Значения различаются"); }
async function rejects(action: () => Promise<unknown>) { try { await action(); } catch { return; } throw new Error("Операция ошибочно разрешена"); }
async function seed(s: TrainingStorage) {
  await s.profiles.save({ id: crypto.randomUUID(), revision: 1, goal: "Синтетическая цель", experience: "unknown", sessionsPerWeek: null, equipment: ["dumbbells", "bench"], nutritionOptIn: false });
  const request = await s.coach.createInitialRequest(crypto.randomUUID(), time);
  const response = await s.coach.importResponse({ ...example, requestId: request.requestId, context: request.context });
  await s.coach.accept(response, time, true);
  const overview = await s.sessions.overview(); assert(overview.active);
  const command = { sessionId: crypto.randomUUID(), startedAt: later, expectedCursor: overview.active.cursor, expectedHistoryRevision: overview.historyRevision };
  return { command, overview, response };
}
function doneSets(session: WorkoutSession, all: boolean) {
  const rows = all ? session.plannedSnapshot.exercises : session.plannedSnapshot.exercises.slice(0, 1);
  return rows.flatMap((row) => Array.from({ length: all ? row.sets : 1 }, (_, index) => ({
    id: crypto.randomUUID(), sessionId: session.id, plannedExerciseId: row.id, originalExerciseId: row.exerciseId, actualExerciseId: row.exerciseId,
    index: index + 1, timestamp: later, status: "done", actual: { type: "reps", reps: 7, weightKg: null }, rir: null,
  })));
}

export const sessionLifecycleCases: readonly StorageCase[] = [
  { name: "UX-05 автоотдых: атомарный commit, reopen и повтор не перезапускает таймер", async run({ storage: s }) {
    const { command } = await seed(s); const session = await s.sessions.start(command);
    const timer = { id: crypto.randomUUID(), startedAt: later, deadline: end };
    const record = { set: doneSets(session, false)[0], expectedSet: null, expectedHistoryRevision: 1, autoRest: { expectedTimer: null, timer } };
    await s.sessions.recordSet(record); s.close(); await s.open();
    equal((await s.sessions.overview()).session?.restTimer, timer); equal(await s.sessions.historyRevision(), 2);
    await s.sessions.timer({ sessionId: session.id, expectedTimer: timer, timer: null });
    await s.sessions.recordSet(record); equal((await s.sessions.overview()).session?.restTimer, null);
    equal((await s.sessions.overview()).session?.sets.length, 1); equal(await s.sessions.historyRevision(), 2);
  } },
  ...["sessions", "counters"].map((table): StorageCase => ({ name: `UX-05 отказ записи ${table} откатывает и подход, и автоотдых`, async run({ storage: s }) {
    const { command } = await seed(s); const session = await s.sessions.start(command); const before = await s.sessions.overview();
    const timer = { id: crypto.randomUUID(), startedAt: later, deadline: end };
    const record = { set: doneSets(session, false)[0], expectedSet: null, expectedHistoryRevision: 1, autoRest: { expectedTimer: null, timer } };
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) { if (this.name === table) throw new DOMException("Synthetic quota", "QuotaExceededError"); return key === undefined ? original.call(this, value) : original.call(this, value, key); };
    try { await rejects(() => s.sessions.recordSet(record)); } finally { IDBObjectStore.prototype.put = original; }
    equal(await s.sessions.overview(), before); await s.sessions.recordSet(record);
    equal((await s.sessions.overview()).session?.restTimer, timer);
  } })),
  { name: "M3 старт → reload → resume: снимок/пустой факт/курсор неизменны", async run({ storage: s }) {
    const { command, overview } = await seed(s); const session = await s.sessions.start(command);
    equal(session.sets, []); equal(session.plannedSnapshot, overview.active?.workout); equal(session.status, "active");
    s.close(); await s.open(); const restored = await s.sessions.overview(); equal(restored.session, session); equal(restored.active, overview.active); equal(restored.historyRevision, 1);
    equal(await s.sessions.start(command), session); equal(await s.sessions.historyRevision(), 1);
  } },
  { name: "M3 старт без программы или с неверным курсором запрещён", async run({ storage: s }) {
    const missing = { sessionId: crypto.randomUUID(), startedAt: later, expectedCursor: { programVersionId: crypto.randomUUID(), nextWorkoutIndex: 0 }, expectedHistoryRevision: 0 };
    await rejects(() => s.sessions.start(missing)); equal(await s.sessions.list(), []);
    const { command } = await seed(s); await rejects(() => s.sessions.start({ ...command, expectedCursor: { ...command.expectedCursor, nextWorkoutIndex: 1 } }));
    await rejects(() => s.sessions.start({ ...command, startedAt: "2020-01-01T00:00:00Z" })); equal(await s.sessions.list(), []);
  } },
  { name: "M3 две связи стартуют одну сессию без второго historyRevision", async run({ storage: s, name, track }) {
    const { command } = await seed(s); const other = track(createTrainingStorage(name)); await other.open();
    const [a, b] = await Promise.all([s.sessions.start(command), other.sessions.start({ ...command, sessionId: crypto.randomUUID() })]);
    equal(a.id, b.id); equal((await s.sessions.list()).length, 1); equal(await s.sessions.historyRevision(), 1);
  } },
  { name: "M3 повтор старого ID после завершения не создаёт новое занятие", async run({ storage: s }) {
    const { command } = await seed(s); await s.sessions.start(command);
    await s.sessions.finish({ sessionId: command.sessionId, endedAt: end, expectedHistoryRevision: 1 });
    const result = await s.sessions.start(command); equal(result.status, "abandoned"); equal((await s.sessions.list()).length, 1); equal(await s.sessions.historyRevision(), 2);
    await rejects(() => s.sessions.start({ ...command, startedAt: end }));
  } },
  { name: "M3 пустое завершение сохраняет abandoned и прежнюю позицию", async run({ storage: s }) {
    const { command, overview } = await seed(s); await s.sessions.start(command);
    const session = await s.sessions.finish({ sessionId: command.sessionId, endedAt: end, expectedHistoryRevision: 1 });
    equal(session.status, "abandoned"); equal(session.sets, []); equal((await s.sessions.overview()).session, undefined); equal(await s.programs.active(), overview.active);
    await rejects(() => s.sessions.start({ ...command, sessionId: crypto.randomUUID() })); // Same position, stale history: no ABA start.
  } },
  ...[false, true].map((all): StorageCase => ({ name: `M3 ${all ? "полное" : "частичное"} завершение: факты/статус/курсор атомарны`, async run({ storage: s }) {
    const { command, overview } = await seed(s); const session = await s.sessions.start(command); const sets = doneSets(session, all);
    await s.sessions.save({ ...session, sets }, 1); // Fact entry UI is M3-02; repository fixture only.
    const result = await s.sessions.finish({ sessionId: session.id, endedAt: end, expectedHistoryRevision: 2 });
    equal(result.status, all ? "completed" : "partial"); equal(result.sets, sets); equal(result.plannedSnapshot, session.plannedSnapshot);
    equal((await s.programs.active())?.cursor.nextWorkoutIndex, 1); equal(await s.sessions.historyRevision(), 3); equal(await s.programs.get(session.programVersionId), overview.active?.program);
    equal(await s.sessions.finish({ sessionId: session.id, endedAt: end, expectedHistoryRevision: 2 }), result); equal(await s.sessions.historyRevision(), 3);
  } })),
  { name: "M3 конец A/B возвращает A ровно один раз", async run({ storage: s }) {
    const { command } = await seed(s);
    for (let index = 0; index < 2; index++) {
      const overview = await s.sessions.overview(); assert(overview.active);
      const session = await s.sessions.start({ ...command, sessionId: crypto.randomUUID(), expectedCursor: overview.active.cursor, expectedHistoryRevision: overview.historyRevision });
      const revision = await s.sessions.save({ ...session, sets: doneSets(session, false) }, overview.historyRevision + 1);
      await s.sessions.finish({ sessionId: session.id, endedAt: end, expectedHistoryRevision: revision });
    }
    equal((await s.programs.active())?.cursor.nextWorkoutIndex, 0); equal((await s.sessions.list()).length, 2);
    await rejects(() => s.sessions.start({ ...command, sessionId: crypto.randomUUID() }));
  } },
  { name: "M3 одновременные finish двигают курсор и ревизию один раз", async run({ storage: s, name, track }) {
    const { command } = await seed(s); const session = await s.sessions.start(command); await s.sessions.save({ ...session, sets: doneSets(session, false) }, 1);
    const other = track(createTrainingStorage(name)); await other.open(); const finish = { sessionId: session.id, endedAt: end, expectedHistoryRevision: 2 };
    const [a, b] = await Promise.all([s.sessions.finish(finish), other.sessions.finish(finish)]); equal(a, b);
    equal((await s.programs.active())?.cursor.nextWorkoutIndex, 1); equal(await s.sessions.historyRevision(), 3);
    const current = await s.sessions.overview(); assert(current.active);
    const next = await s.sessions.start({ ...command, sessionId: crypto.randomUUID(), expectedCursor: current.active.cursor, expectedHistoryRevision: current.historyRevision });
    await s.sessions.finish(finish); equal((await s.sessions.overview()).session, next); equal(await s.sessions.historyRevision(), 4);
  } },
  { name: "M3 устаревшее подтверждение после факта/неверное время запрещены", async run({ storage: s }) {
    const { command } = await seed(s); const session = await s.sessions.start(command); await s.sessions.save({ ...session, sets: doneSets(session, false) }, 1);
    await rejects(() => s.sessions.finish({ sessionId: session.id, endedAt: end, expectedHistoryRevision: 1 }));
    await rejects(() => s.sessions.finish({ sessionId: session.id, endedAt: time, expectedHistoryRevision: 2 }));
    equal((await s.sessions.overview()).session?.status, "active"); equal((await s.programs.active())?.cursor.nextWorkoutIndex, 0);
    await rejects(() => s.sessions.save({ ...session, endedAt: end, status: "abandoned" }, 2)); // Cannot bypass cursor transaction.
  } },
  ...["sessions", "counters"].map((table): StorageCase => ({ name: `M3 отказ start/${table} откатывает сессию и счётчик`, async run({ storage: s }) {
    const { command } = await seed(s); const originalAdd = IDBObjectStore.prototype.add; const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.add = function (value, key) { if (this.name === table) throw new DOMException("Synthetic quota", "QuotaExceededError"); return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key); };
    IDBObjectStore.prototype.put = function (value, key) { if (this.name === table) throw new DOMException("Synthetic quota", "QuotaExceededError"); return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key); };
    try { await rejects(() => s.sessions.start(command)); } finally { IDBObjectStore.prototype.add = originalAdd; IDBObjectStore.prototype.put = originalPut; }
    equal(await s.sessions.list(), []); equal(await s.sessions.historyRevision(), 0); await s.sessions.start(command);
  } })),
  ...["sessions", "programState", "counters"].map((table): StorageCase => ({ name: `M3 отказ finish/${table} откатывает статус/курсор/ревизию`, async run({ storage: s }) {
    const { command } = await seed(s); const session = await s.sessions.start(command); await s.sessions.save({ ...session, sets: doneSets(session, false) }, 1);
    const before = await s.sessions.overview(); const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) { if (this.name === table) throw new DOMException("Synthetic quota", "QuotaExceededError"); return key === undefined ? original.call(this, value) : original.call(this, value, key); };
    const finish = { sessionId: session.id, endedAt: end, expectedHistoryRevision: 2 };
    try { await rejects(() => s.sessions.finish(finish)); } finally { IDBObjectStore.prototype.put = original; }
    equal(await s.sessions.overview(), before); await s.sessions.finish(finish); equal((await s.programs.active())?.cursor.nextWorkoutIndex, 1);
  } })),
  { name: "M3 смена даты/профиля не двигает курсор и не меняет снимок", async run({ storage: s }) {
    const { command } = await seed(s); const session = await s.sessions.start(command); const profile = await s.profiles.current(); assert(profile);
    await s.profiles.save({ ...profile, revision: 2, goal: "Изменённая цель" });
    s.close(); await s.open(); equal((await s.sessions.overview()).session, session); equal((await s.programs.active())?.cursor.nextWorkoutIndex, 0);
  } },
  { name: "M3 повреждённая active-сессия не скрывается и не заменяется новым стартом", async run({ storage: s, raw }) {
    const { command } = await seed(s); await raw.sessions.add({ id: crypto.randomUUID(), status: "active", payload: {} });
    await rejects(() => s.sessions.overview()); await rejects(() => s.sessions.start(command)); equal(await raw.sessions.count(), 1);
  } },
];
