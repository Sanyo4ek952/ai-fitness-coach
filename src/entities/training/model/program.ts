import { z } from "zod";
import { exerciseIdSchema, exerciseSchema, findExercise, validExerciseDefinition, mergeExerciseCatalog, type Exercise } from "./exercise";
import { idSchema, revisionSchema, rirSchema, text, timestampSchema, unique, weightSchema } from "./primitives";

export const plannedTargetSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("reps"), min: z.int().min(1).max(100), max: z.int().min(1).max(100), weightKg: weightSchema })
    .refine((target) => target.min <= target.max, "Минимум повторений больше максимума"),
  z.strictObject({ type: z.literal("duration"), seconds: z.number().min(1).max(7200), maxSeconds: z.number().min(1).max(7200).optional(), intensity: text(240).optional() })
    .refine((t) => t.maxSeconds === undefined || t.seconds <= t.maxSeconds, "Минимум времени больше максимума"),
  z.strictObject({ type: z.literal("distance"), meters: z.number().min(1).max(100000), intensity: text(240).optional() }),
]).readonly();

const setPlanSchema = z.strictObject({
  kind: z.enum(["warmup", "working"]), target: plannedTargetSchema,
  restSec: z.int().min(0).max(600), rir: rirSchema.optional(),
  rirMax: z.number().min(0).max(10).optional(), note: text(1000).optional(),
}).superRefine(validatePlannedRir).readonly();

// Null is an explicit absence, including on timed/distance prescriptions.
// Preserve it for round trips; never discard a numeric RIR on another measurement.
function validatePlannedRir(value: { target: { type: string }; rir?: number | null; rirMax?: number }, ctx: z.RefinementCtx) {
  if (value.target.type !== "reps") {
    if (value.rir != null) ctx.addIssue({ code: "custom", path: ["rir"], message: `RIR=${value.rir}: числовой RIR допустим только для повторений. Для времени/дистанции оставьте null или не указывайте rir; описание интенсивности задаётся в target.intensity.` });
    if (value.rirMax !== undefined) ctx.addIssue({ code: "custom", path: ["rirMax"], message: "Диапазон RIR допустим только для повторений; для времени/дистанции не указывайте rirMax" });
  }
  if (value.rirMax !== undefined && (value.rir == null || value.rir > value.rirMax)) ctx.addIssue({ code: "custom", path: ["rirMax"], message: "Для диапазона RIR нужен минимум не выше максимума" });
}

const prescriptionShape = {
  exerciseId: exerciseIdSchema,
  definition: exerciseSchema.optional(),
  sets: z.int().min(1).max(20),
  target: plannedTargetSchema,
  restSec: z.int().min(0).max(600),
  rir: rirSchema.optional(),
  rirMax: z.number().min(0).max(10).optional(),
  note: text(240).optional(),
  setPlans: z.array(setPlanSchema).min(1).max(20).readonly().optional(),
};

function validatePrescription(value: z.infer<z.ZodObject<typeof prescriptionShape>>, ctx: z.RefinementCtx) {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  if (!validExerciseDefinition(value.exerciseId, value.definition)) issue([value.definition ? "definition" : "exerciseId"], "Неизвестному упражнению нужно полное definition; ID и название должны быть уникальны, существующее определение нельзя менять");
  if (findExercise(value.exerciseId, value.definition)?.measurement !== value.target.type) issue(["target", "type"], "Измерение не соответствует упражнению");
  validatePlannedRir(value, ctx);
  if (value.setPlans) {
    if (value.setPlans.length !== value.sets) issue(["setPlans"], "Число индивидуальных подходов должно совпадать с sets");
    value.setPlans.forEach((s, i) => { if (s.target.type !== value.target.type) issue(["setPlans", i, "target", "type"], "Измерение подхода не соответствует упражнению"); });
  }
}

export const prescriptionSchema = z.strictObject(prescriptionShape)
  .superRefine(validatePrescription).readonly();
export const plannedExerciseSchema = z.strictObject({ id: idSchema, ...prescriptionShape })
  .superRefine(validatePrescription).readonly();

const phaseSchema = z.strictObject({
  id: exerciseIdSchema, title: text(100), goal: text(1000),
  duration: z.discriminatedUnion("unit", [
    z.strictObject({ unit: z.literal("sessions"), count: z.int().min(1).max(10000) }),
    z.strictObject({ unit: z.literal("weeks"), count: z.int().min(1).max(520), sessionsPerWeek: z.int().min(1).max(14) }),
  ]),
  transition: z.enum(["after_sessions", "manual"]), transitionNote: text(1000).optional(),
  overrides: z.array(z.strictObject({ workoutIndex: z.int().min(0).max(13), exerciseIndex: z.int().min(0).max(19), prescription: prescriptionSchema }).readonly()).max(280).readonly(),
}).readonly();

export const progressionRuleSchema = z.strictObject({
  id: exerciseIdSchema, exerciseId: exerciseIdSchema.optional(), description: text(1000),
  condition: z.strictObject({
    type: z.enum(["upper_reps", "below_reps", "plateau", "excessive_load", "manual"]),
    sessions: z.int().min(1).max(100), minRir: z.number().min(0).max(10).optional(), maxRir: z.number().min(0).max(10).optional(),
  }).refine((c) => c.minRir === undefined || c.maxRir === undefined || c.minRir <= c.maxRir, "Неверный диапазон RIR"),
  action: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("weight"), change: z.number().min(-1000).max(1000).refine((n) => n !== 0), unit: z.enum(["kg", "percent"]) }),
    z.strictObject({ type: z.enum(["reps", "sets"]), change: z.int().min(-20).max(20).refine((n) => n !== 0) }),
    z.strictObject({ type: z.literal("review"), instruction: text(1000) }),
  ]),
}).readonly();

export const programDetailsShape = {
  phases: z.array(phaseSchema).min(1).max(100).readonly().optional(),
  progressionRules: z.array(progressionRuleSchema).max(200).readonly().optional(),
  recommendations: z.array(z.strictObject({
    category: z.enum(["technique", "warmup", "recovery", "cardio", "nutrition", "safety", "other"]),
    text: text(4000), exerciseId: exerciseIdSchema.optional(), phaseId: exerciseIdSchema.optional(),
  }).readonly()).max(200).readonly().optional(),
};

const draftObject = z.strictObject({
  title: text(100),
  goalInterpretation: text(240),
  workouts: z.array(z.strictObject({
    title: text(100),
    exercises: z.array(prescriptionSchema).min(1).max(20).readonly(),
  }).readonly()).min(1).max(14).readonly(),
  reviewAfterSessions: z.int().min(1).max(10000),
  ...programDetailsShape,
});

function validateProgram(program: z.infer<typeof draftObject>, ctx: z.RefinementCtx) {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  const rows = program.workouts.flatMap((w) => w.exercises);
  try { mergeExerciseCatalog(rows.flatMap((r) => r.definition ? [r.definition] : [])); }
  catch (error) { issue(["workouts"], error instanceof Error ? error.message : "Конфликт каталога"); }
  const ids = new Set(rows.map((r) => r.exerciseId));
  if (!unique(program.phases?.map((p) => p.id) ?? [])) issue(["phases"], "ID этапов повторяются");
  program.phases?.forEach((phase, i) => {
    if (!unique(phase.overrides.map((o) => `${o.workoutIndex}:${o.exerciseIndex}`))) issue(["phases", i, "overrides"], "Строка этапа повторяется");
    phase.overrides.forEach((o, j) => {
      const row = program.workouts[o.workoutIndex]?.exercises[o.exerciseIndex];
      if (!row || row.exerciseId !== o.prescription.exerciseId || JSON.stringify(row.definition) !== JSON.stringify(o.prescription.definition)) issue(["phases", i, "overrides", j], "Этап должен менять параметры существующего упражнения, сохраняя его ID и определение");
    });
  });
  if (!unique(program.progressionRules?.map((r) => r.id) ?? [])) issue(["progressionRules"], "ID правил повторяются");
  program.progressionRules?.forEach((r, i) => { if (r.exerciseId && !ids.has(r.exerciseId)) issue(["progressionRules", i, "exerciseId"], "Упражнения нет в программе"); });
  program.recommendations?.forEach((r, i) => {
    if (r.exerciseId && !ids.has(r.exerciseId)) issue(["recommendations", i, "exerciseId"], "Упражнения нет в программе");
    if (r.phaseId && !program.phases?.some((p) => p.id === r.phaseId)) issue(["recommendations", i, "phaseId"], "Неизвестный этап");
  });
}

export const programDraftSchema = draftObject.superRefine(validateProgram).readonly();

export const workoutTemplateSchema = z.strictObject({
  id: idSchema,
  title: text(100),
  exercises: z.array(plannedExerciseSchema).min(1).max(20)
    .refine((items) => unique(items.map((item) => item.id)), "ID строк повторяются").readonly(),
}).readonly();

export const programVersionSchema = z.strictObject({
  id: idSchema,
  revision: revisionSchema,
  previousId: idSchema.nullable(),
  profileRevision: revisionSchema,
  createdAt: timestampSchema,
  title: text(100),
  goalInterpretation: text(240),
  workouts: z.array(workoutTemplateSchema).min(1).max(14).readonly(),
  reviewAfterSessions: z.int().min(1).max(10000),
  notes: text(1000).optional(),
  ...programDetailsShape,
}).superRefine((program, ctx) => {
  validateProgram(program, ctx);
  if ((program.revision === 1) !== (program.previousId === null) || program.previousId === program.id) {
    ctx.addIssue({ code: "custom", path: ["previousId"], message: "Некорректная связь версий" });
  }
  const ids = program.workouts.flatMap((workout) => [workout.id, ...workout.exercises.map((row) => row.id)]);
  if (!unique([program.id, ...ids])) ctx.addIssue({ code: "custom", path: ["workouts"], message: "Внутренние ID повторяются" });
}).readonly();

export type PlannedTarget = z.infer<typeof plannedTargetSchema>;
export type Prescription = z.infer<typeof prescriptionSchema>;
export type PlannedExercise = z.infer<typeof plannedExerciseSchema>;
export type ProgramDraft = z.infer<typeof programDraftSchema>;
export type WorkoutTemplate = z.infer<typeof workoutTemplateSchema>;
export type ProgramVersion = z.infer<typeof programVersionSchema>;

export function programDefinitions(program: ProgramDraft | ProgramVersion): readonly Exercise[] {
  return program.workouts.flatMap((w) => w.exercises.flatMap((r) => r.definition ? [r.definition] : []));
}

export function plannedSet<T extends Prescription>(row: T, index: number): T {
  const set = row.setPlans?.[index - 1];
  if (!set) return row;
  return { ...row, target: set.target, restSec: set.restSec, rir: set.rir, rirMax: set.rirMax, note: set.note ?? row.note };
}
