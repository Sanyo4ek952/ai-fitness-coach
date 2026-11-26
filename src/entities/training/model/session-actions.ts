import { z } from "zod";
import { replacementOptions } from "./exercise";
import { idSchema } from "./primitives";
import { historyRevisionSchema, startSessionSchema, createWorkoutSession } from "./session-lifecycle";
import { exerciseSetSchema, replacementSchema, restTimerSchema, workoutSessionSchema } from "./session";
import { programCursorSchema } from "./program-sequence";
import { programVersionSchema } from "./program";

export const sessionActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("replace"), sessionId: idSchema, replacement: replacementSchema, expectedHistoryRevision: historyRevisionSchema }),
  z.strictObject({ kind: z.literal("skipSets"), sessionId: idSchema,
    sets: z.array(exerciseSetSchema.refine((set) => set.status === "skipped", "Только пропуски")).min(1).max(20),
    expectedHistoryRevision: historyRevisionSchema }),
]).readonly();

export function applySessionAction(sessionInput: unknown, commandInput: unknown) {
  const session = workoutSessionSchema.parse(sessionInput);
  const command = sessionActionSchema.parse(commandInput);
  if (session.id !== command.sessionId || session.status !== "active") throw new Error("Действие доступно только в текущем активном занятии");
  if (command.kind === "replace") {
    const replacement = command.replacement;
    const row = session.plannedSnapshot.exercises.find((item) => item.id === replacement.plannedExerciseId);
    if (!row || row.exerciseId !== replacement.originalExerciseId
      || !replacementOptions(row.exerciseId).some((item) => item.id === replacement.actualExerciseId)) throw new Error("Нет совместимого варианта в каталоге. Можно пропустить упражнение.");
    if (session.replacements?.some((item) => item.plannedExerciseId === row.id)) throw new Error("Для этой строки замена уже выбрана. Программа не изменена.");
    if (session.sets.filter((set) => set.plannedExerciseId === row.id).length === row.sets) throw new Error("Все подходы этой строки уже записаны");
    return workoutSessionSchema.parse({ ...session, replacements: [...(session.replacements ?? []), replacement] });
  }
  for (const set of command.sets) {
    if (session.sets.some((item) => item.id === set.id || (item.plannedExerciseId === set.plannedExerciseId && item.index === set.index))) throw new Error("Подход уже записан. Пропуск не заменяет сохранённый факт.");
    const selected = session.replacements?.find((item) => item.plannedExerciseId === set.plannedExerciseId);
    if (set.actualExerciseId !== (selected?.actualExerciseId ?? set.originalExerciseId)) throw new Error("Выбранное упражнение изменилось. Посмотрите его перед пропуском.");
  }
  return workoutSessionSchema.parse({ ...session, sets: [...session.sets, ...command.sets] });
}

export const timerCommandSchema = z.strictObject({
  sessionId: idSchema, expectedTimer: restTimerSchema.nullable(), timer: restTimerSchema.nullable(),
}).readonly();

export function updateRestTimer(sessionInput: unknown, commandInput: unknown) {
  const session = workoutSessionSchema.parse(sessionInput);
  const command = timerCommandSchema.parse(commandInput);
  if (session.id !== command.sessionId || session.status !== "active") throw new Error("Отдых доступен только в активном занятии");
  if (JSON.stringify(session.restTimer ?? null) !== JSON.stringify(command.expectedTimer)) throw new Error("Таймер изменился в другой вкладке. Посмотрите текущее время и повторите.");
  return workoutSessionSchema.parse({ ...session, restTimer: command.timer });
}

export function restSecondsRemaining(deadline: string, nowMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(deadline) - nowMs) / 1000));
}

// Separate skipped event in session history, with no performed sets.
export const skipWorkoutSchema = startSessionSchema;
export function skipWorkout(programInput: unknown, commandInput: unknown) {
  const program = programVersionSchema.parse(programInput);
  const command = skipWorkoutSchema.parse(commandInput);
  const base = createWorkoutSession(program, command);
  return Object.freeze({
    session: workoutSessionSchema.parse({ ...base, endedAt: command.startedAt, status: "skipped" }),
    cursor: programCursorSchema.parse({ ...command.expectedCursor, nextWorkoutIndex: (command.expectedCursor.nextWorkoutIndex + 1) % program.workouts.length }),
  });
}

