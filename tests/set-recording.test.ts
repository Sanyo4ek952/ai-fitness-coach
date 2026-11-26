import { describe, expect, it } from "vitest";
import { recordSetSchema, recordWorkoutSet } from "../src/entities/training/model/set-recording";
import { workoutSessionSchema } from "@/entities/training";

const id = () => crypto.randomUUID();
const time = "2026-11-24T12:00:00Z";
function fixture() {
  const row = { id: id(), exerciseId: "goblet-squat", sets: 2, target: { type: "reps", min: 6, max: 8, weightKg: null }, restSec: 60 };
  const templateId = id();
  const session = workoutSessionSchema.parse({ id: id(), programVersionId: id(), templateId,
    plannedSnapshot: { id: templateId, title: "Тест", exercises: [row] }, startedAt: time, endedAt: null, status: "active", sets: [] });
  const set = { id: id(), sessionId: session.id, plannedExerciseId: row.id, originalExerciseId: row.exerciseId, actualExerciseId: row.exerciseId,
    index: 1, timestamp: time, status: "done", actual: { type: "reps", reps: 7, weightKg: null }, rir: null };
  return { session, command: { set, expectedSet: null, expectedHistoryRevision: 1 } };
}
describe("M3-02 запись факта", () => {
  it("UX-05 сохраняет подход и автоотдых одним чистым преобразованием", () => {
    const { session, command } = fixture();
    const timer = { id: id(), startedAt: time, deadline: "2026-11-24T12:01:00Z" };
    const before = JSON.stringify(session);
    const result = recordWorkoutSet(session, { ...command, autoRest: { expectedTimer: null, timer } });
    expect(result.sets).toHaveLength(1); expect(result.restTimer).toEqual(timer);
    expect(JSON.stringify(session)).toBe(before);
  });
  it("UX-05 конфликт отдыха не создаёт частично сохранённый подход", () => {
    const { session, command } = fixture();
    const timer = { id: id(), startedAt: time, deadline: "2026-11-24T12:01:00Z" };
    expect(() => recordWorkoutSet({ ...session, restTimer: timer }, { ...command, autoRest: { expectedTimer: null, timer } })).toThrow("Таймер изменился");
    expect(session.sets).toHaveLength(0);
  });
  it("UX-05 исправление не перезапускает отдых, невалидный таймер отвергается", () => {
    const { session, command } = fixture(); const saved = recordWorkoutSet(session, command);
    const timer = { id: id(), startedAt: time, deadline: "2026-11-24T12:01:00Z" };
    expect(() => recordWorkoutSet(saved, { ...command, expectedSet: saved.sets[0], autoRest: { expectedTimer: null, timer } })).toThrow("Исправление");
    expect(() => recordWorkoutSet(session, { ...command, autoRest: { expectedTimer: null, timer: { ...timer, deadline: time } } })).toThrow();
  });
  it.each([{ type: "duration", seconds: 20.5 }, { type: "distance", meters: 100.5 }])("сохраняет соответствующие единицы $type без RIR", (actual) => {
    const { session, command } = fixture();
    const exerciseId = actual.type === "duration" ? "plank" : "treadmill-walk";
    const row = session.plannedSnapshot.exercises[0];
    const timed = { ...session, plannedSnapshot: { ...session.plannedSnapshot, exercises: [{ ...row, exerciseId, target: actual }] } };
    const { rir: omitted, ...set } = command.set;
    expect(omitted).toBeNull();
    const result = recordWorkoutSet(timed, { ...command, set: { ...set, originalExerciseId: exerciseId, actualExerciseId: exerciseId, actual } });
    expect(result.sets[0]).toMatchObject({ actual });
    expect(result.sets[0]).not.toHaveProperty("rir");
  });
  it("сохраняет null веса/RIR, не меняя план и вход", () => {
    const { session, command } = fixture(); const before = JSON.stringify(session);
    const result = recordWorkoutSet(session, command);
    expect(result.sets[0]).toEqual(command.set); expect(result.plannedSnapshot).toEqual(session.plannedSnapshot);
    expect(JSON.stringify(session)).toBe(before); expect(Object.isFrozen(result.sets)).toBe(true);
  });
  it("исправляет факт и сохраняет нулевой вес и RIR", () => {
    const { session, command } = fixture(); const saved = recordWorkoutSet(session, command);
    const result = recordWorkoutSet(saved, { ...command, expectedSet: saved.sets[0], set: { ...command.set, actual: { type: "reps", reps: 8, weightKg: 0 }, rir: 0 } });
    expect(result.sets[0]).toMatchObject({ actual: { weightKg: 0, reps: 8 }, rir: 0 });
  });
  it("запрещает дубль слота и дубль ID", () => {
    const { session, command } = fixture(); const saved = recordWorkoutSet(session, command);
    expect(() => recordWorkoutSet(saved, command)).toThrow();
    expect(() => recordWorkoutSet(saved, { ...command, set: { ...command.set, id: id() } })).toThrow("Этот подход уже сохранён в другой вкладке");
  });
  it("не затирает несовпавший исходный факт", () => {
    const { session, command } = fixture(); const saved = recordWorkoutSet(session, command);
    expect(() => recordWorkoutSet(saved, { ...command, expectedSet: { ...command.set, rir: 1 } })).toThrow();
  });
  it.each(["sessionId", "plannedExerciseId", "timestamp", "index"])("сохраняет происхождение: %s", (field) => {
    const { session, command } = fixture(); const saved = recordWorkoutSet(session, command);
    const value = field === "timestamp" ? "2026-11-24T12:01:00Z" : field === "index" ? 2 : id();
    expect(() => recordWorkoutSet(saved, { ...command, expectedSet: saved.sets[0], set: { ...command.set, [field]: value } })).toThrow();
  });
  it("исправление конечного занятия сохраняет статус/endedAt, новый факт запрещён", () => {
    const { session, command } = fixture(); const saved = recordWorkoutSet(session, command);
    const final = { ...saved, status: "partial", endedAt: time };
    const corrected = recordWorkoutSet(final, { ...command, expectedSet: saved.sets[0], set: { ...command.set, rir: 0 } });
    expect(corrected.status).toBe("partial"); expect(corrected.endedAt).toBe(time);
    expect(() => recordWorkoutSet(final, { ...command, set: { ...command.set, id: id(), index: 2 } })).toThrow();
  });
  it.each([0, null, 1.5, 101])("недопустимые повторы %s", (reps) => {
    const { session, command } = fixture();
    expect(() => recordWorkoutSet(session, { ...command, set: { ...command.set, actual: { type: "reps", reps, weightKg: null } } })).toThrow();
  });
  it("строгая команда и неверный тип/индекс не принимаются", () => {
    const { session, command } = fixture();
    expect(recordSetSchema.safeParse({ ...command, extra: true }).success).toBe(false);
    expect(() => recordWorkoutSet(session, { ...command, set: { ...command.set, actual: { type: "duration", seconds: 10 } } })).toThrow();
    expect(() => recordWorkoutSet(session, { ...command, set: { ...command.set, index: 3 } })).toThrow();
  });
});
