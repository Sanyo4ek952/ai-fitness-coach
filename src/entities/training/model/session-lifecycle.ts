import { z } from "zod";
import { idSchema, timestampSchema } from "./primitives";
import { programVersionSchema } from "./program";
import { programCursorSchema, selectNextWorkout } from "./program-sequence";
import { workoutSessionSchema } from "./session";

export const historyRevisionSchema = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
export const startSessionSchema = z.strictObject({
  sessionId: idSchema,
  startedAt: timestampSchema,
  expectedCursor: programCursorSchema,
  expectedHistoryRevision: historyRevisionSchema,
}).readonly();
export const finishSessionSchema = z.strictObject({
  sessionId: idSchema,
  endedAt: timestampSchema,
  expectedHistoryRevision: historyRevisionSchema,
}).readonly();

export function createWorkoutSession(programInput: unknown, commandInput: unknown) {
  const program = programVersionSchema.parse(programInput);
  const command = startSessionSchema.parse(commandInput);
  if (Date.parse(command.startedAt) < Date.parse(program.createdAt)) throw new Error("Начало занятия раньше создания программы. Проверьте часы устройства.");
  const template = selectNextWorkout(program, command.expectedCursor);
  return workoutSessionSchema.parse({
    id: command.sessionId, programVersionId: program.id, templateId: template.id,
    plannedSnapshot: template, startedAt: command.startedAt, endedAt: null, status: "active", sets: [],
    ...(command.expectedCursor.phaseIndex !== undefined ? { phaseIndex: command.expectedCursor.phaseIndex } : {}),
  });
}

export function finishWorkoutSession(programInput: unknown, cursorInput: unknown, sessionInput: unknown, endedAt: unknown) {
  const program = programVersionSchema.parse(programInput);
  const cursor = programCursorSchema.parse(cursorInput);
  const session = workoutSessionSchema.parse(sessionInput);
  const template = selectNextWorkout(program, cursor);
  if (session.status !== "active" || session.programVersionId !== program.id || session.templateId !== template.id
    || JSON.stringify(session.plannedSnapshot) !== JSON.stringify(template)) {
    throw new Error("Сессия не соответствует текущей позиции программы");
  }
  const done = session.sets.filter((set) => set.status === "done").length;
  const total = template.exercises.reduce((sum, row) => sum + row.sets, 0);
  const finished = workoutSessionSchema.parse({ ...session, ...(session.restTimer !== undefined ? { restTimer: null } : {}), endedAt, status: done === 0 ? "abandoned" : done === total ? "completed" : "partial" });
  const nextCursor = programCursorSchema.parse({ ...cursor, nextWorkoutIndex: done === 0 ? cursor.nextWorkoutIndex : (cursor.nextWorkoutIndex + 1) % program.workouts.length,
    ...(cursor.phaseSessions !== undefined ? { phaseSessions: cursor.phaseSessions + (done === 0 ? 0 : 1) } : {}) });
  return Object.freeze({ session: finished, cursor: nextCursor });
}
