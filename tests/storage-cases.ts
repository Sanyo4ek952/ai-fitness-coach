import { Dexie } from "dexie";
import { createTrainingStorage, workoutSessionSchema, type TrainingStorage } from "@/entities/training";
import { TrainingDatabase, storageSchemaV4, type StoredRevision, type StoredVersion, type StoredSession, type StoredCounter } from "@/shared/infrastructure/db";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const time = "2026-11-24T07:00:00Z";
const profile = { id: id(1), revision: 1, goal: "Синтетический тест", experience: "unknown", sessionsPerWeek: null, equipment: ["unknown"], nutritionOptIn: false };
const snapshot = { id: id(3), title: "А", exercises: [{ id: id(4), exerciseId: "goblet-squat", sets: 2, target: { type: "reps", min: 8, max: 12, weightKg: null }, restSec: 90 }] };
const program = { id: id(2), revision: 1, previousId: null, profileRevision: 1, createdAt: time, title: "Тест", goalInterpretation: "Сила", workouts: [snapshot], reviewAfterSessions: 2 };
const session = { id: id(5), programVersionId: id(2), templateId: id(3), plannedSnapshot: snapshot, startedAt: time, endedAt: null, status: "active", sets: [] };
const set = { id: id(6), sessionId: id(5), plannedExerciseId: id(4), originalExerciseId: "goblet-squat", actualExerciseId: "goblet-squat", index: 1, timestamp: time, status: "done", actual: { type: "reps", reps: 7, weightKg: null } };

function assert(value: unknown, message = "Проверка не выполнена"): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), "Значения различаются");
}
async function rejects(action: () => Promise<unknown>, name?: string) {
  try { await action(); } catch (error) {
    if (name) assert(error instanceof Error && error.name === name, `Ожидалась ошибка ${name}, получена ${String(error)}`);
    return;
  }
  throw new Error("Операция ошибочно завершилась успешно");
}

interface Context {
  storage: TrainingStorage;
  raw: TrainingDatabase;
  name: string;
  track: <T extends { close(): void }>(connection: T) => T;
}
export interface StorageCase { name: string; run(context: Context): Promise<void> }
async function seed(storage: TrainingStorage) {
  await storage.profiles.save(profile);
  await storage.programs.append(program);
}

// Same checks run in Vitest's emulator and in the native browser harness.
export const storageCases: readonly StorageCase[] = [
  { name: "пустая БД без демоданных", async run({ storage }) {
    equal(await storage.profiles.current(), undefined);
    equal(await storage.programs.list(), []);
    equal(await storage.sessions.list(), []);
    equal(await storage.sessions.historyRevision(), 0);
  } },
  { name: "профиль без optional, повторное открытие и заморозка", async run({ storage, name, track }) {
    await storage.profiles.save(profile);
    storage.close();
    const reopened = track(createTrainingStorage(name)); await reopened.open();
    const saved = await reopened.profiles.current(); equal(saved, profile);
    assert(Object.isFrozen(saved) && Object.isFrozen(saved?.equipment));
  } },
  { name: "ревизии профиля сохраняются, ID неизменен", async run({ storage }) {
    await storage.profiles.save(profile);
    await storage.profiles.save({ ...profile, revision: 2, goal: "Другая цель" });
    equal(await storage.profiles.get(1), profile);
    assert((await storage.profiles.current())?.revision === 2);
    await rejects(() => storage.profiles.save({ ...profile, id: id(9), revision: 3 }), "StorageConflictError");
  } },
  { name: "невалидная запись не меняет БД", async run({ storage }) {
    await rejects(() => storage.profiles.save({ ...profile, extra: true }), "ZodError");
    equal(await storage.profiles.current(), undefined);
    await rejects(() => storage.programs.append({ ...program, title: "" }), "ZodError");
    await rejects(() => storage.sessions.save({ ...session, extra: true }, 0), "ZodError");
    equal(await storage.sessions.historyRevision(), 0);
  } },
  { name: "две связи профиля конкурируют без потери изменений", async run({ storage, name, track }) {
    await storage.profiles.save(profile);
    const other = track(createTrainingStorage(name)); await other.open();
    const results = await Promise.allSettled([
      storage.profiles.save({ ...profile, revision: 2, goal: "А" }),
      other.profiles.save({ ...profile, revision: 2, goal: "Б" }),
    ]);
    equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert((await storage.profiles.current())?.revision === 2);
  } },
  { name: "нет программы без сохранённого профиля", async run({ storage }) {
    await rejects(() => storage.programs.append(program), "StorageConflictError");
    equal(await storage.programs.list(), []);
  } },
  { name: "устаревшая ревизия профиля отклонена", async run({ storage }) {
    await storage.profiles.save(profile);
    await storage.profiles.save({ ...profile, revision: 2 });
    await rejects(() => storage.programs.append(program), "StorageConflictError");
  } },
  { name: "цепочка программ, старые версии и снимки неизменны", async run({ storage, name, track }) {
    await seed(storage);
    await storage.sessions.save(session, 0);
    await storage.programs.append({ ...program, id: id(7), revision: 2, previousId: program.id, workouts: [{ ...snapshot, title: "Б" }] });
    storage.close(); const reopened = track(createTrainingStorage(name)); await reopened.open();
    equal(await reopened.programs.get(program.id), program);
    equal((await reopened.sessions.get(session.id))?.plannedSnapshot, snapshot);
    assert((await reopened.programs.list()).length === 2);
    assert(Object.isFrozen((await reopened.programs.get(program.id))?.workouts[0].exercises[0].target));
  } },
  { name: "разрыв цепочки и повторный ID не перезаписывают версии", async run({ storage }) {
    await seed(storage);
    await rejects(() => storage.programs.append(program), "StorageConflictError");
    await rejects(() => storage.programs.append({ ...program, id: id(7), revision: 3, previousId: program.id }), "StorageConflictError");
    await rejects(() => storage.programs.append({ ...program, id: id(7), revision: 2, previousId: id(9) }), "StorageConflictError");
    await rejects(() => storage.programs.append({ ...program, revision: 2, previousId: id(9) }));
    equal(await storage.programs.list(), [program]);
  } },
  { name: "две связи не создают ветку программ", async run({ storage, name, track }) {
    await seed(storage); const other = track(createTrainingStorage(name)); await other.open();
    const next = { ...program, revision: 2, previousId: program.id };
    const results = await Promise.allSettled([storage.programs.append({ ...next, id: id(7) }), other.programs.append({ ...next, id: id(8) })]);
    equal(results.filter((r) => r.status === "fulfilled").length, 1);
    equal((await storage.programs.list()).length, 2);
  } },
  { name: "сессия и historyRevision сохраняются вместе", async run({ storage, name, track }) {
    await seed(storage);
    equal(await storage.sessions.save(session, 0), 1);
    equal(await storage.sessions.save({ ...session, sets: [set] }, 1), 2);
    storage.close(); const reopened = track(createTrainingStorage(name)); await reopened.open();
    equal(await reopened.sessions.historyRevision(), 2);
    equal((await reopened.sessions.get(session.id))?.sets, [set]);
    assert(Object.isFrozen((await reopened.sessions.get(session.id))?.sets[0]));
  } },
  { name: "нет сессии с чужой программой или изменённым снимком", async run({ storage }) {
    await seed(storage);
    await rejects(() => storage.sessions.save({ ...session, programVersionId: id(9) }, 0), "StorageConflictError");
    await rejects(() => storage.sessions.save({ ...session, plannedSnapshot: { ...snapshot, title: "Подмена" } }, 0), "StorageConflictError");
    equal(await storage.sessions.list(), []); equal(await storage.sessions.historyRevision(), 0);
  } },
  { name: "конкурентная правка истории и повторный вызов отклонены", async run({ storage, name, track }) {
    await seed(storage); await storage.sessions.save(session, 0);
    const other = track(createTrainingStorage(name)); await other.open();
    const results = await Promise.allSettled([storage.sessions.save({ ...session, sets: [set] }, 1), other.sessions.save(session, 1)]);
    equal(results.filter((r) => r.status === "fulfilled").length, 1);
    equal(await storage.sessions.historyRevision(), 2);
    await rejects(() => storage.sessions.save(session, 1), "StorageConflictError");
  } },
  { name: "вторая активная сессия отклонена", async run({ storage }) {
    await seed(storage); await storage.sessions.save(session, 0);
    await rejects(() => storage.sessions.save({ ...session, id: id(9) }, 1), "StorageConflictError");
    equal((await storage.sessions.list()).length, 1); equal(await storage.sessions.historyRevision(), 1);
  } },
  { name: "источник истории нельзя подменить или открыть заново", async run({ storage }) {
    await seed(storage);
    const ended = { ...session, status: "partial", endedAt: time, sets: [set] };
    await storage.sessions.save(ended, 0);
    await rejects(() => storage.sessions.save(session, 1), "StorageConflictError");
    await rejects(() => storage.sessions.save({ ...ended, startedAt: "2026-11-24T06:59:00Z" }, 1), "StorageConflictError");
    equal(await storage.sessions.get(session.id), ended);
  } },
  { name: "ошибка записи счётчика откатывает записанную сессию", async run({ storage, raw }) {
    await seed(storage); await storage.sessions.save(session, 0);
    const fail = () => { throw new DOMException("Injected quota failure", "QuotaExceededError"); };
    raw.close();
    // Fail the second write after the session put has already succeeded.
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === "counters") return fail();
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
    try { await rejects(() => storage.sessions.save({ ...session, sets: [set] }, 1), "QuotaExceededError"); }
    finally { IDBObjectStore.prototype.put = original; }
    equal(await storage.sessions.get(session.id), session); equal(await storage.sessions.historyRevision(), 1);
  } },
  { name: "повреждённые payload и ключ не скрываются", async run({ storage, raw }) {
    await raw.profileRevisions.add({ revision: 1, payload: { ...profile, goal: 42 } });
    await rejects(() => storage.profiles.current(), "ZodError");
    await raw.profileRevisions.put({ revision: 1, payload: { ...profile, revision: 2 } });
    await rejects(() => storage.profiles.current(), "StorageConflictError");
    equal(await raw.profileRevisions.count(), 1);
  } },
  { name: "повреждённые версия/сессия/счётчик отклонены при чтении", async run({ storage, raw }) {
    await seed(storage); await storage.sessions.save(session, 0);
    await raw.programVersions.put({ id: program.id, revision: 2, payload: program });
    await rejects(() => storage.programs.get(program.id), "StorageConflictError");
    await raw.sessions.put({ id: session.id, status: "completed", payload: session });
    await rejects(() => storage.sessions.list(), "StorageConflictError");
    await raw.counters.put({ key: "historyRevision", value: -1 });
    await rejects(() => storage.sessions.historyRevision(), "ZodError");
  } },
  { name: "закрытая БД не даёт ложный успех, явное открытие восстанавливает доступ", async run({ storage }) {
    await storage.profiles.save(profile); storage.close();
    await rejects(() => storage.profiles.save({ ...profile, revision: 2 }), "DatabaseClosedError");
    await storage.open(); equal(await storage.profiles.current(), profile);
  } },
  { name: "потерянный счётчик непустой истории не превращается в ноль", async run({ storage, raw }) {
    await seed(storage); await storage.sessions.save(session, 0);
    await raw.counters.delete("historyRevision");
    await rejects(() => storage.sessions.historyRevision(), "StorageConflictError");
    await rejects(() => storage.sessions.save({ ...session, sets: [set] }, 0), "StorageConflictError");
    equal(await storage.sessions.get(session.id), session);
  } },
  { name: "миграция v4→тестовая v5 сохраняет все записи", async run({ storage, raw, name, track }) {
    await seed(storage); await storage.sessions.save({ ...session, sets: [set] }, 0);
    storage.close(); raw.close();
    const next = track(new Dexie(name)); next.version(4).stores(storageSchemaV4);
    next.version(5).stores({ ...storageSchemaV4, migrationProbe: "key" }).upgrade(async (tx) => {
      await tx.table("migrationProbe").add({ key: "ok" });
    });
    await next.open();
    equal((await next.table<StoredRevision, number>("profileRevisions").get(1))?.payload, profile);
    equal((await next.table<StoredVersion, string>("programVersions").get(program.id))?.payload, program);
    equal(workoutSessionSchema.parse((await next.table<StoredSession, string>("sessions").get(session.id))?.payload).sets, [set]);
    equal((await next.table<StoredCounter, string>("counters").get("historyRevision"))?.value, 1);
  } },
  { name: "ошибка миграции откатывает данные и новую таблицу", async run({ storage, raw, name, track }) {
    await seed(storage); await storage.sessions.save(session, 0); storage.close(); raw.close();
    const next = track(new Dexie(name)); next.version(4).stores(storageSchemaV4);
    next.version(5).stores({ ...storageSchemaV4, migrationProbe: "key" }).upgrade(async (tx) => {
      await tx.table("profileRevisions").clear();
      await tx.table("programVersions").clear();
      await tx.table("sessions").clear();
      await tx.table("counters").put({ key: "historyRevision", value: 999 });
      throw new Error("Injected migration failure");
    });
    await rejects(() => next.open()); next.close(); await storage.open(); await raw.open();
    equal(await storage.profiles.current(), profile); equal(await storage.programs.get(program.id), program);
    equal(await storage.sessions.get(session.id), session); equal(await storage.sessions.historyRevision(), 1);
    assert(raw.verno === 4 && !raw.tables.some((table) => table.name === "migrationProbe"));
  } },
  { name: "versionchange закрывает старую связь без потери данных", async run({ storage, raw, name, track }) {
    await seed(storage);
    const next = track(new Dexie(name)); next.version(5).stores({ ...storageSchemaV4, migrationProbe: "key" });
    await next.open(); assert(!raw.isOpen());
    await rejects(() => storage.profiles.current(), "DatabaseClosedError");
    equal((await next.table<StoredVersion, string>("programVersions").get(program.id))?.payload, program);
  } },
  { name: "старое приложение отвергает более новую БД без очистки", async run({ storage, raw, name, track }) {
    await seed(storage); storage.close(); raw.close();
    const next = track(new Dexie(name)); next.version(5).stores(storageSchemaV4);
    await next.open(); next.close();
    await rejects(() => storage.open(), "VersionError");
    await next.open();
    equal((await next.table<StoredVersion, string>("programVersions").get(program.id))?.payload, program);
  } },
  { name: "duplicate ID в add не заменяет старую программу", async run({ storage }) {
    await seed(storage);
    await storage.programs.append({ ...program, id: id(7), revision: 2, previousId: program.id });
    await rejects(() => storage.programs.append({ ...program, revision: 3, previousId: id(7) }), "ConstraintError");
    equal(await storage.programs.get(program.id), program);
    equal((await storage.programs.list()).length, 2);
  } },
];

export async function runStorageCase(test: StorageCase): Promise<void> {
  const name = `m1-02-test-${crypto.randomUUID()}`;
  const connections: { close(): void }[] = [];
  const track = <T extends { close(): void }>(connection: T): T => { connections.push(connection); return connection; };
  const storage = track(createTrainingStorage(name)); const raw = track(new TrainingDatabase(name));
  try { await storage.open(); await raw.open(); await test.run({ storage, raw, name, track }); }
  finally {
    connections.forEach((connection) => connection.close());
    // Only the uniquely named synthetic test database is deleted.
    await Dexie.delete(name);
  }
}


