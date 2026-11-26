import { z } from "zod";
import { exerciseIdSchema, exerciseSchema, findExercise, replacementOptions, validExerciseDefinition } from "./exercise";
import { idSchema, rirSchema, text, timestampSchema, unique, weightSchema } from "./primitives";
import { workoutTemplateSchema } from "./program";

// Фактические повторы — одно число, а не диапазон из плана.
export const actualTargetSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("reps"), reps: z.int().min(1).max(100), weightKg: weightSchema }),
  z.strictObject({ type: z.literal("duration"), seconds: z.number().positive().max(7200) }),
  z.strictObject({ type: z.literal("distance"), meters: z.number().positive().max(100000) }),
]).readonly();

const setShape = {
  id: idSchema,
  sessionId: idSchema,
  plannedExerciseId: idSchema,
  originalExerciseId: exerciseIdSchema,
  actualExerciseId: exerciseIdSchema,
  definition: exerciseSchema.optional(),
  index: z.int().min(1).max(20),
  timestamp: timestampSchema,
  note: text(240).optional(),
  pain: z.boolean().optional(),
};

export const exerciseSetSchema = z.discriminatedUnion("status", [
  z.strictObject({ ...setShape, status: z.literal("done"), actual: actualTargetSchema, rir: rirSchema.optional() }),
  z.strictObject({ ...setShape, status: z.literal("skipped") }),
]).superRefine((set, ctx) => {
  const original = findExercise(set.originalExerciseId, set.definition);
  const actual = findExercise(set.actualExerciseId, set.definition);
  if (!validExerciseDefinition(set.originalExerciseId, set.definition) || !original || !actual || original.measurement !== actual.measurement) {
    ctx.addIssue({ code: "custom", message: "Несовместимые упражнения" });
  }
  if (set.status === "done" && (actual?.measurement !== set.actual.type || (set.actual.type !== "reps" && set.rir !== undefined))) {
    ctx.addIssue({ code: "custom", path: ["actual"], message: "Неверная единица факта или RIR" });
  }
}).readonly();

export const replacementSchema = z.strictObject({
  plannedExerciseId: idSchema, originalExerciseId: exerciseIdSchema,
  actualExerciseId: exerciseIdSchema, timestamp: timestampSchema,
}).readonly();
export const restTimerSchema = z.strictObject({
  id: idSchema, startedAt: timestampSchema, deadline: timestampSchema,
}).refine((timer) => Date.parse(timer.deadline) > Date.parse(timer.startedAt)
  && Date.parse(timer.deadline) - Date.parse(timer.startedAt) <= 600000, "Отдых — до 600 секунд").readonly();

export const workoutSessionSchema = z.strictObject({
  id: idSchema,
  programVersionId: idSchema,
  templateId: idSchema,
  phaseIndex: z.int().min(0).max(99).optional(),
  plannedSnapshot: workoutTemplateSchema,
  startedAt: timestampSchema,
  endedAt: timestampSchema.nullable(),
  status: z.enum(["active", "completed", "partial", "abandoned", "skipped"]),
  sets: z.array(exerciseSetSchema).max(400).readonly(),
  replacements: z.array(replacementSchema).max(20).readonly().optional(),
  restTimer: restTimerSchema.nullable().optional(),
}).superRefine((session, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (session.templateId !== session.plannedSnapshot.id) issue("Снимок другого шаблона");
  if ((session.status === "active") !== (session.endedAt === null)) issue("Статус не соответствует времени завершения");
  const start = Date.parse(session.startedAt);
  const end = session.endedAt === null ? null : Date.parse(session.endedAt);
  if (end !== null && end < start) issue("Завершение раньше начала");
  if (!unique(session.sets.map((set) => set.id)) || !unique(session.sets.map((set) => `${set.plannedExerciseId}:${set.index}`))) issue("Подход повторяется");
  const replacements = session.replacements ?? [];
  if (!unique(replacements.map((item) => item.plannedExerciseId))) issue("Замена строки повторяется");
  for (const replacement of replacements) {
    const row = session.plannedSnapshot.exercises.find((item) => item.id === replacement.plannedExerciseId);
    const time = Date.parse(replacement.timestamp);
    if (!row || row.exerciseId !== replacement.originalExerciseId
      || !replacementOptions(replacement.originalExerciseId).some((item) => item.id === replacement.actualExerciseId)
      || time < start || (end !== null && time > end)) issue("Замена не соответствует снимку или каталогу");
  }
  if (session.restTimer && (session.status !== "active" || Date.parse(session.restTimer.startedAt) < start)) issue("Таймер вне активного занятия");
  if (session.status === "skipped" && (session.sets.length !== 0 || replacements.length !== 0)) issue("Пропуск занятия не содержит тренировочных фактов");
  for (const set of session.sets) {
    const row = session.plannedSnapshot.exercises.find((item) => item.id === set.plannedExerciseId);
    if (set.sessionId !== session.id || !row || row.exerciseId !== set.originalExerciseId || set.index > row.sets
      || JSON.stringify(set.definition) !== JSON.stringify(row.definition)) issue("Подход не соответствует снимку занятия");
    const time = Date.parse(set.timestamp);
    if (time < start || (end !== null && time > end)) issue("Время подхода вне занятия");
    if (set.actualExerciseId !== set.originalExerciseId) {
      const replacement = replacements.find((item) => item.plannedExerciseId === set.plannedExerciseId);
      if (!replacement || replacement.actualExerciseId !== set.actualExerciseId || time < Date.parse(replacement.timestamp)) issue("Нет подтверждённого происхождения замены");
    }
  }
  const done = session.sets.filter((set) => set.status === "done").length;
  const planned = session.plannedSnapshot.exercises.reduce((sum, row) => sum + row.sets, 0);
  if (session.status === "completed" && done !== planned) issue("Выполнены не все подходы");
  if (session.status === "partial" && (done === 0 || done === planned)) issue("Частичное занятие должно содержать часть выполненных подходов");
}).readonly();

export type ActualTarget = z.infer<typeof actualTargetSchema>;
export type ExerciseSet = z.infer<typeof exerciseSetSchema>;
export type WorkoutSession = z.infer<typeof workoutSessionSchema>;
