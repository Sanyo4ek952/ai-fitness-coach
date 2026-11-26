import { describe, expect, it } from "vitest";
import responseExample from "../examples/coach-response.example.json";
import {
  actualTargetSchema, exerciseCatalog, exerciseCatalogSchema, exerciseSchema,
  exerciseSetSchema, findExercise, plannedTargetSchema, prescriptionSchema,
  profileSchema, programDraftSchema, programVersionSchema, workoutSessionSchema,
} from "@/entities/training";

const ids = Array.from({ length: 8 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
const [profileId, versionId, templateId, rowId, sessionId, setId, nextVersionId] = ids;
const timestamp = "2026-11-24T07:00:00Z";
const profile = { id: profileId, revision: 1, goal: "Развивать силу", experience: "unknown", sessionsPerWeek: null, equipment: ["unknown"], nutritionOptIn: false };
const target = { type: "reps", min: 8, max: 12, weightKg: null };
const prescription = { exerciseId: "goblet-squat", sets: 2, target, restSec: 120, rir: null };
const snapshot = { id: templateId, title: "А", exercises: [{ id: rowId, ...prescription }] };
const program = { id: versionId, revision: 1, previousId: null, profileRevision: 1, createdAt: timestamp, title: "Цикл", goalInterpretation: "Развитие силы", workouts: [snapshot], reviewAfterSessions: 2 };
const set = { id: setId, sessionId, plannedExerciseId: rowId, originalExerciseId: "goblet-squat", actualExerciseId: "goblet-squat", index: 1, timestamp, status: "done", actual: { type: "reps", reps: 7, weightKg: 12.5 }, rir: null };
const session = { id: sessionId, programVersionId: versionId, templateId, plannedSnapshot: snapshot, startedAt: timestamp, endedAt: null, status: "active", sets: [set] };

describe("профиль без обязательных дополнительных сведений", () => {
  it("сохраняет неизвестное, отсутствие и null без подстановки нулей", () => {
    expect(profileSchema.parse(profile)).toEqual(profile);
    expect(profileSchema.parse({ ...profile, details: null }).details).toBeNull();
    expect(profileSchema.parse({ ...profile, details: {} }).details).toEqual({});
    expect(profileSchema.parse({ ...profile, details: { weightKg: null } }).details?.weightKg).toBeNull();
  });
  it.each([
    { goal: " " }, { goal: "а".repeat(501) }, { experience: "expert" }, { sessionsPerWeek: 0 },
    { sessionsPerWeek: 8 }, { sessionsPerWeek: 1.5 }, { revision: 0 }, { revision: Infinity },
    { equipment: [] }, { equipment: ["unknown", "bench"] }, { equipment: ["bench", "bench"] },
    { equipment: ["invented"] }, { extra: true }, { id: "profile" },
    { details: { weightKg: 0 } }, { details: { weightKg: NaN } }, { details: { ageYears: 17 } },
    { details: { heightCm: Infinity } }, { details: { photo: "private" } },
  ])("отклоняет некорректный профиль: %j", (patch) => {
    expect(profileSchema.safeParse({ ...profile, ...patch }).success).toBe(false);
  });
  it("не исполняет текст цели и не изменяет вход", () => {
    const input = { ...profile, goal: '<script>throw new Error("execute")</script>' };
    expect(profileSchema.parse(input).goal).toBe(input.goal);
    expect(Object.isFrozen(input)).toBe(false);
  });
});

describe("каталог и единицы", () => {
  it("имеет стабильные уникальные ID, русские названия и три измерения", () => {
    expect(exerciseCatalogSchema.parse(exerciseCatalog)).toEqual(exerciseCatalog);
    expect(exerciseCatalog.slice(0, 8).map((exercise) => exercise.id)).toEqual([
      "goblet-squat", "db-bench-press", "db-row", "leg-press", "push-up", "assisted-pull-up", "plank", "treadmill-walk",
    ]);
    expect(new Set(exerciseCatalog.map((exercise) => exercise.measurement)).size).toBe(3);
    for (const exercise of exerciseCatalog) expect(exercise.name).toMatch(/[А-Яа-яЁё]/);
    expect(findExercise("invented")).toBeUndefined();
  });
  it("различает помощь, собственный и внешний вес и способ учёта гантелей", () => {
    expect(findExercise("assisted-pull-up")?.load.type).toBe("assistance");
    expect(findExercise("push-up")?.load.type).toBe("bodyweight");
    expect(findExercise("db-bench-press")?.load).toEqual({ type: "external", unit: "kg", basis: "per-dumbbell" });
  });
  it("отклоняет дубли, неопределённое оборудование и противоречие нагрузки", () => {
    expect(exerciseCatalogSchema.safeParse([...exerciseCatalog, exerciseCatalog[0]]).success).toBe(false);
    const exercise = exerciseCatalog[0];
    for (const patch of [{ equipment: ["unknown"] }, { load: { type: "none", unit: "none" } }, { measurement: "distance" }, { load: { type: "external", unit: "lb", basis: "total" } }, { instructions: "invented" }]) {
      expect(exerciseSchema.safeParse({ ...exercise, ...patch }).success).toBe(false);
    }
  });
});

describe("план программы", () => {
  it("проверяет только proposedProgram синтетического примера, не AI-конверт", () => {
    expect(programDraftSchema.safeParse(responseExample.proposedProgram).success).toBe(true);
  });
  it("сохраняет неизвестный вес и необязательный RIR; ноль отличает от неизвестного", () => {
    expect(prescriptionSchema.parse(prescription).target).toEqual(target);
    const { rir, ...withoutRir } = prescription;
    expect(rir).toBeNull();
    expect(prescriptionSchema.parse(withoutRir)).not.toHaveProperty("rir");
    expect(plannedTargetSchema.parse({ ...target, weightKg: 0 })).toHaveProperty("weightKg", 0);
  });
  it.each([
    { min: 13 }, { min: 0 }, { max: 101 }, { min: 1.5 }, { weightKg: -1 },
    { weightKg: 1001 }, { weightKg: Infinity }, { weightKg: NaN }, { weightKg: "20" },
    { weightKg: undefined }, { seconds: 30 }, { extra: true },
  ])("отклоняет неверную цель: %j", (patch) => {
    expect(plannedTargetSchema.safeParse({ ...target, ...patch }).success).toBe(false);
  });
  it.each([
    { sets: 0 }, { sets: 21 }, { sets: 2.5 }, { restSec: -1 }, { restSec: 601 },
    { rir: 11 }, { rir: -1 }, { rir: Infinity }, { exerciseId: "invented" },
    { exerciseId: "plank" }, { note: "а".repeat(241) }, { extra: true },
  ])("отклоняет противоречивое предписание: %j", (patch) => {
    expect(prescriptionSchema.safeParse({ ...prescription, ...patch }).success).toBe(false);
  });
  it.each([
    { exerciseId: "plank", target: { type: "duration", seconds: 30 } },
    { exerciseId: "treadmill-walk", target: { type: "distance", meters: 500, intensity: "Спокойно" } },
  ])("принимает время/дистанцию без веса и RIR: %j", (patch) => {
    const { rir, ...base } = prescription;
    expect(rir).toBeNull();
    expect(prescriptionSchema.safeParse({ ...base, ...patch }).success).toBe(true);
    expect(prescriptionSchema.parse({ ...base, ...patch, rir: null })).toHaveProperty("rir", null);
    expect(prescriptionSchema.safeParse({ ...base, ...patch, rir: 0 }).success).toBe(false);
    expect(plannedTargetSchema.safeParse({ ...patch.target, weightKg: 0 }).success).toBe(false);
  });
  it("отклоняет недопустимые границы времени/дистанции и массивов", () => {
    for (const invalid of [{ type: "duration", seconds: 0 }, { type: "duration", seconds: 7201 }, { type: "distance", meters: 100001 }, { type: "distance", meters: Infinity }]) {
      expect(plannedTargetSchema.safeParse(invalid).success).toBe(false);
    }
    const draft = responseExample.proposedProgram;
    for (const patch of [{ workouts: [] }, { workouts: Array(15).fill(draft.workouts[0]) }, { reviewAfterSessions: 0 }, { workouts: [{ title: "А", exercises: [] }] }, { workouts: [{ title: "А", exercises: Array(21).fill(prescription) }] }]) {
      expect(programDraftSchema.safeParse({ ...draft, ...patch }).success).toBe(false);
    }
  });
  it("проверяет версии и уникальность внутренних идентификаторов", () => {
    expect(programVersionSchema.safeParse(program).success).toBe(true);
    expect(programVersionSchema.safeParse({ ...program, id: nextVersionId, revision: 2, previousId: versionId }).success).toBe(true);
    for (const patch of [{ previousId: versionId }, { revision: 2 }, { id: templateId }, { workouts: [snapshot, snapshot] }, { workouts: [{ ...snapshot, exercises: [snapshot.exercises[0], snapshot.exercises[0]] }] }, { createdAt: "2026-11-24T10:00:00+03:00" }]) {
      expect(programVersionSchema.safeParse({ ...program, ...patch }).success).toBe(false);
    }
  });
});

describe("снимок занятия и факт", () => {
  it("сохраняет факт вне планового диапазона и неизвестный фактический вес/RIR", () => {
    expect(workoutSessionSchema.parse(session).sets[0]).toEqual(set);
    expect(exerciseSetSchema.parse({ ...set, actual: { type: "reps", reps: 5, weightKg: null } })).toHaveProperty("rir", null);
    expect(actualTargetSchema.safeParse(target).success).toBe(false);
    expect(plannedTargetSchema.safeParse(set.actual).success).toBe(false);
  });
  it("замена хранит исходное и фактическое упражнение раздельно", () => {
    expect(exerciseSetSchema.safeParse({ ...set, actualExerciseId: "leg-press" }).success).toBe(true);
    expect(exerciseSetSchema.safeParse({ ...set, actualExerciseId: "plank" }).success).toBe(false);
  });
  it("пропущенный подход не содержит выдуманного факта и RIR", () => {
    const { actual, rir, ...base } = set;
    expect(actual).toEqual(set.actual);
    expect(rir).toBeNull();
    expect(exerciseSetSchema.safeParse({ ...base, status: "skipped" }).success).toBe(true);
    expect(exerciseSetSchema.safeParse({ ...set, status: "skipped" }).success).toBe(false);
    expect(exerciseSetSchema.safeParse(base).success).toBe(false);
  });
  it.each([{ type: "duration", seconds: 12.5 }, { type: "distance", meters: 123.5 }])("факт %j не становится тоннажем", (actual) => {
    const actualExerciseId = actual.type === "duration" ? "plank" : "treadmill-walk";
    const { rir, ...base } = set;
    expect(rir).toBeNull();
    expect(exerciseSetSchema.safeParse({ ...base, originalExerciseId: actualExerciseId, actualExerciseId, actual }).success).toBe(true);
    expect(exerciseSetSchema.safeParse({ ...base, originalExerciseId: actualExerciseId, actualExerciseId, actual, rir: null }).success).toBe(false);
  });
  it.each([
    { type: "reps", reps: 0, weightKg: 10 }, { type: "reps", reps: 101, weightKg: 10 },
    { type: "reps", reps: 1.5, weightKg: 10 }, { type: "duration", seconds: 0 },
    { type: "distance", meters: NaN }, { type: "distance", meters: 5, seconds: 10 },
  ])("отклоняет ошибочный факт: %j", (actual) => expect(actualTargetSchema.safeParse(actual).success).toBe(false));
  it("проверяет связи, время, дубли и статусы сессии", () => {
    for (const patch of [
      { templateId: rowId }, { status: "completed" }, { endedAt: timestamp },
      { status: "partial", endedAt: timestamp, sets: [] },
      { status: "abandoned", endedAt: "2026-11-24T06:00:00Z" },
      { sets: [set, set] }, { sets: [set, { ...set, id: nextVersionId }] },
      ...[{ sessionId: profileId }, { plannedExerciseId: profileId }, { originalExerciseId: "leg-press" }, { index: 3 }, { timestamp: "2026-11-24T06:59:59Z" }, { actualExerciseId: "invented" }].map((change) => ({ sets: [{ ...set, ...change }] })),
    ]) expect(workoutSessionSchema.safeParse({ ...session, ...patch }).success).toBe(false);
    expect(workoutSessionSchema.safeParse({ ...session, status: "partial", endedAt: timestamp }).success).toBe(true);
    expect(workoutSessionSchema.safeParse({ ...session, status: "abandoned", endedAt: timestamp, sets: [] }).success).toBe(true);
    expect(workoutSessionSchema.safeParse({ ...session, status: "completed", endedAt: timestamp, sets: [set, { ...set, id: nextVersionId, index: 2 }] }).success).toBe(true);
  });
  it("выход схемы заморожен в глубину, новая версия не меняет прежний снимок/вход", () => {
    const old = workoutSessionSchema.parse(session);
    const next = programVersionSchema.parse({ ...program, id: nextVersionId, revision: 2, previousId: versionId, workouts: [{ ...snapshot, exercises: [{ ...snapshot.exercises[0], restSec: 180 }] }] });
    expect(next.workouts[0].exercises[0].restSec).toBe(180);
    expect(old.plannedSnapshot.exercises[0].restSec).toBe(120);
    expect(Object.isFrozen(old)).toBe(true);
    expect(Object.isFrozen(old.plannedSnapshot.exercises[0].target)).toBe(true);
    expect(Object.isFrozen(old.sets[0])).toBe(true);
    expect(Object.isFrozen(old.sets)).toBe(true);
    expect(Object.isFrozen(session)).toBe(false);
  });
  it("strict отклоняет опасные ключи JSON, а не удаляет их молча", () => {
    const input: unknown = JSON.parse(JSON.stringify(profile).replace('"revision":1', '"revision":1,"__proto__":{"polluted":true}'));
    expect(profileSchema.safeParse(input).success).toBe(false);
    expect(exerciseSetSchema.safeParse({ ...set, constructor: "payload" }).success).toBe(false);
  });
  it("отклоняет факт после завершения, неверную UTC-дату и полный результат со статусом partial", () => {
    expect(workoutSessionSchema.safeParse({ ...session, status: "partial", endedAt: timestamp, sets: [{ ...set, timestamp: "2026-11-24T07:00:01Z" }] }).success).toBe(false);
    expect(workoutSessionSchema.safeParse({ ...session, startedAt: "2026-02-30T07:00:00Z" }).success).toBe(false);
    expect(workoutSessionSchema.safeParse({ ...session, status: "partial", endedAt: timestamp, sets: [set, { ...set, id: nextVersionId, index: 2 }] }).success).toBe(false);
  });
});

