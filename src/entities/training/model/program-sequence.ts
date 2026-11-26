import { z } from "zod";
import { idSchema, revisionSchema, timestampSchema } from "./primitives";
import { programDraftSchema, programVersionSchema, type ProgramVersion } from "./program";

// A position in the ordered templates, never a date or a completed workout count.
export const programCursorSchema = z.strictObject({
  programVersionId: idSchema,
  nextWorkoutIndex: z.int().min(0).max(13),
  phaseIndex: z.int().min(0).max(99).optional(),
  phaseSessions: z.int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}).readonly();

const versionMetadataSchema = z.strictObject({
  id: idSchema,
  revision: revisionSchema,
  previousId: idSchema.nullable(),
  profileRevision: revisionSchema,
  createdAt: timestampSchema,
}).readonly();

export type ProgramCursor = z.infer<typeof programCursorSchema>;

export function createProgramVersionFromDraft(
  draftInput: unknown,
  metadataInput: unknown,
  createId: () => string,
): ProgramVersion {
  const draft = programDraftSchema.parse(draftInput);
  const metadata = versionMetadataSchema.parse(metadataInput);
  return programVersionSchema.parse({
    ...metadata,
    ...draft,
    workouts: draft.workouts.map((workout) => ({
      id: createId(),
      title: workout.title,
      exercises: workout.exercises.map((row) => ({ ...row, id: createId() })),
    })),
  });
}

export function createInitialProgramCursor(programInput: unknown): ProgramCursor {
  const program = programVersionSchema.parse(programInput);
  return programCursorSchema.parse({ programVersionId: program.id, nextWorkoutIndex: 0,
    ...(program.phases ? { phaseIndex: 0, phaseSessions: 0 } : {}) });
}

export function phaseSessionTarget(phase: NonNullable<ProgramVersion["phases"]>[number]): number {
  return phase.duration.count * (phase.duration.unit === "weeks" ? phase.duration.sessionsPerWeek : 1);
}

export function workoutForPhase(program: ProgramVersion | undefined, templateId: string, phaseIndex?: number) {
  if (!program) return undefined;
  const index = program.workouts.findIndex((w) => w.id === templateId);
  const workout = program.workouts[index];
  if (!workout) return undefined;
  if (!program.phases) {
    if (phaseIndex !== undefined) throw new Error("В программе нет этапов");
    return workout;
  }
  if (phaseIndex === undefined) throw new Error("Не указан этап снимка занятия");
  const phase = program.phases[phaseIndex];
  if (!phase) throw new Error("Этап отсутствует в программе");
  return { ...workout, exercises: workout.exercises.map((row, exerciseIndex) => {
    const override = phase.overrides.find((o) => o.workoutIndex === index && o.exerciseIndex === exerciseIndex);
    return override ? { id: row.id, ...override.prescription } : row;
  }) };
}

export function advanceProgramPhase(programInput: unknown, cursorInput: unknown): ProgramCursor {
  const program = programVersionSchema.parse(programInput);
  const cursor = programCursorSchema.parse(cursorInput);
  selectNextWorkout(program, cursor);
  const index = cursor.phaseIndex ?? 0;
  const phase = program.phases?.[index];
  if (!phase || !program.phases?.[index + 1]) throw new Error("Следующего этапа нет");
  if (phase.transition === "after_sessions" && (cursor.phaseSessions ?? 0) < phaseSessionTarget(phase)) throw new Error("Ещё не выполнено нужное число занятий этапа");
  return programCursorSchema.parse({ ...cursor, phaseIndex: index + 1, phaseSessions: 0 });
}

export function selectNextWorkout(programInput: unknown, cursorInput: unknown) {
  const program = programVersionSchema.parse(programInput);
  const cursor = programCursorSchema.parse(cursorInput);
  if (cursor.programVersionId !== program.id) throw new Error("Курсор относится к другой версии программы");
  if (program.phases ? cursor.phaseIndex === undefined || cursor.phaseSessions === undefined : cursor.phaseIndex !== undefined || cursor.phaseSessions !== undefined) throw new Error("Курсор этапа не соответствует программе");
  const workout = program.workouts[cursor.nextWorkoutIndex];
  if (!workout) throw new Error("Позиция следующего занятия отсутствует в программе");
  return workoutForPhase(program, workout.id, cursor.phaseIndex)!;
}
