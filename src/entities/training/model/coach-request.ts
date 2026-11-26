import { z } from "zod";
import { bodyMeasurementSchema, MAX_MEASUREMENTS } from "./body-progress";
import { exerciseCatalogSchema, exerciseSchema, exerciseIdSchema, findExercise, validExerciseDefinition, mergeExerciseCatalog } from "./exercise";
import legacyResponseSchema from "./legacy-response-schema.json";
import { profileSchema } from "./profile";
import { idSchema, timestampSchema, unique } from "./primitives";
import { programVersionSchema, programDefinitions } from "./program";
import { workoutSessionSchema } from "./session";
import { coachContextSchema, coachResponseSchema, createCoachResponseJsonSchema } from "./coach-response";
import { COACH_INSTRUCTIONS } from "./coach-instructions";

export const coachProfileSchema = profileSchema.unwrap().omit({ id: true, revision: true }).readonly();
export const coachReasonSchema = z.enum(["initial", "safety", "changed_context", "performance", "periodic", "manual"]);

// Долгосрочные агрегаты по фактическому упражнению и единице, без ошибочного суммирования весов.
export const coachHistorySummarySchema = z.strictObject({
  exerciseId: exerciseIdSchema,
  definition: exerciseSchema.optional(),
  measurement: z.enum(["reps", "duration", "distance"]),
  unit: z.enum(["reps", "seconds", "meters"]),
  sessionCount: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
  doneSetCount: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
  total: z.number().positive().max(Number.MAX_SAFE_INTEGER),
  firstPerformedAt: timestampSchema,
  lastPerformedAt: timestampSchema,
}).refine((item) => validExerciseDefinition(item.exerciseId, item.definition) && findExercise(item.exerciseId, item.definition)?.measurement === item.measurement
  && item.unit === ({ reps: "reps", duration: "seconds", distance: "meters" }[item.measurement])
  && item.sessionCount <= item.doneSetCount
  && (item.measurement !== "reps" || Number.isSafeInteger(item.total))
  && Date.parse(item.firstPerformedAt) <= Date.parse(item.lastPerformedAt), "Несогласованный агрегат истории").readonly();

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

const requestShape = {
  schemaVersion: z.literal(1),
  kind: z.literal("coach_request"),
  requestId: idSchema,
  createdAt: timestampSchema,
  mode: z.enum(["initial", "review"]),
  context: coachContextSchema,
  profile: coachProfileSchema,
  program: programVersionSchema.nullable(),
  recentSessions: z.array(workoutSessionSchema.refine((session) => session.status === "completed" || session.status === "partial",
    "В запросе допустимы только завершённые и частичные занятия")).max(20).readonly(),
  measurements: z.array(bodyMeasurementSchema).max(MAX_MEASUREMENTS).readonly().optional(),
  historySummary: z.array(coachHistorySummarySchema).readonly(),
  reasonCodes: z.array(coachReasonSchema).min(1).max(6).refine(unique, "Причины повторяются").readonly(),
  exerciseCatalog: exerciseCatalogSchema,
  programInstructions: z.string().max(6000).optional(),
  programPosition: z.strictObject({ phaseIndex: z.int().min(0).max(99), phaseSessions: z.int().min(0) }).optional(),
  instructions: z.literal(COACH_INSTRUCTIONS),
  responseSchema: z.json().refine((value) => canonicalJson(value) === canonicalJson(createCoachResponseJsonSchema()) || canonicalJson(value) === canonicalJson(legacyResponseSchema),
    "Требуется полная актуальная JSON Schema ответа")
    .transform((value) => freezeJson(canonicalJson(value) === canonicalJson(legacyResponseSchema) ? structuredClone(legacyResponseSchema) : createCoachResponseJsonSchema())),
};

export const coachRequestSchema = z.strictObject(requestShape).superRefine((request, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const initial = request.mode === "initial";
  if (initial !== (request.program === null) || request.context.programVersionId !== (request.program?.id ?? null)) issue("Режим и активная программа не совпадают с контекстом");
  if (request.program && (request.program.profileRevision > request.context.profileRevision
    || Date.parse(request.program.createdAt) > Date.parse(request.createdAt))) issue("Программа из будущего контекста");
  if (initial !== request.reasonCodes.includes("initial")) issue("Причина initial не соответствует режиму");
  if (request.recentSessions.length > request.context.historyRevision) issue("История не соответствует ревизии");
  if (!unique(request.recentSessions.map((session) => session.id))) issue("Занятия повторяются");
  if (!unique(request.historySummary.map((item) => item.exerciseId))) issue("Агрегаты повторяются");
  const created = Date.parse(request.createdAt);
  if (request.measurements) {
    if (!unique(request.measurements.map((item) => item.id))) issue("Замеры повторяются");
    let previous = Infinity;
    for (const item of request.measurements) {
      const measured = Date.parse(item.measuredAt);
      if (measured > created || measured < created - 90 * 86400000 || measured > previous) issue("Замеры вне окна 90 дней или порядка");
      previous = measured;
    }
  }
  let previousEnd = Infinity;
  for (const session of request.recentSessions) {
    const end = Date.parse(session.endedAt ?? "");
    if (end > created || end > previousEnd) issue("История должна идти от новых занятий к старым и не содержать будущих");
    previousEnd = end;
  }
  for (const item of request.historySummary) {
    if (Date.parse(item.lastPerformedAt) > created || item.sessionCount > request.context.historyRevision) issue("Агрегат из будущего контекста");
  }
  for (const exercise of request.exerciseCatalog) {
    if (!validExerciseDefinition(exercise.id, exercise)) issue("Каталог отличается от каталога приложения");
  }
  if (Boolean(request.program?.phases) !== Boolean(request.programPosition)) issue("Программе с этапами требуется programPosition");
  if (request.programPosition && !request.program?.phases?.[request.programPosition.phaseIndex]) issue("Позиция этапа отсутствует в программе");
}).readonly();

export type CoachRequest = z.infer<typeof coachRequestSchema>;
export type CoachHistorySummary = z.infer<typeof coachHistorySummarySchema>;

/** Подготовка контракта в памяти; не читает БД, не скачивает и не отправляет данные. */
export function createCoachRequest(input: unknown): CoachRequest {
  const payload = z.strictObject(requestShape).omit({ instructions: true, responseSchema: true }).parse(input);
  return coachRequestSchema.parse({ ...payload, instructions: COACH_INSTRUCTIONS, responseSchema: createCoachResponseJsonSchema() });
}

/** Проверяет ответ относительно сохранённого запроса; актуальность БД проверяет будущая транзакция импорта. */
export function parseCoachResponseForRequest(input: unknown, requestInput: unknown) {
  const request = coachRequestSchema.parse(requestInput);
  return coachResponseSchema.superRefine((response, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message });
    if (response.requestId !== request.requestId || canonicalJson(response.context) !== canonicalJson(request.context)) issue("Ответ относится к другому запросу или контексту");
    if (!request.profile.nutritionOptIn && response.nutritionTips.length > 0) issue("Нет согласия на советы по питанию");
    if (response.decision === "propose_program") {
      try { mergeExerciseCatalog([...request.exerciseCatalog, ...programDefinitions(response.proposedProgram)]); }
      catch (cause) { issue(cause instanceof Error ? cause.message : "Конфликт каталога"); }
      if (!request.profile.nutritionOptIn && response.proposedProgram.recommendations?.some((r) => r.category === "nutrition")) issue("Нет согласия на рекомендации по питанию");
      for (const workout of response.proposedProgram.workouts) for (const row of workout.exercises) {
        const exercise = request.exerciseCatalog.find((item) => item.id === row.exerciseId) ?? row.definition;
        const previous = request.exerciseCatalog.find((item) => item.id === row.exerciseId);
        if (previous && row.definition && canonicalJson(previous) !== canonicalJson(row.definition)) issue("Нельзя изменить определение существующего упражнения");
        if (!exercise) issue("Упражнение отсутствует в каталоге запроса");
        else if (!exercise.equipment.every((equipment) => request.profile.equipment.includes(equipment))) issue("Оборудование упражнения не подтверждено профилем");
      }
    }
  }).parse(input);
}

export const PROGRAM_INSTRUCTIONS = "Дополнение к формату программы: разрешено новое упражнение с уникальным стабильным exerciseId и полным definition (id/name/equipment/measurement/load/muscleGroups). Не подменяй неизвестное упражнение похожим и не создавай дубликаты. Добавление требует подтверждения пользователя. phases задают последовательные этапы с длительностью sessions либо weeks с явным sessionsPerWeek; недели — объём сессий, не календарь. overrides содержат полное предписание строки, сохраняя ID упражнения и definition. Переход этапа требует подтверждения. progressionRules задают условия и предлагаемые действия; они не применяются автоматически. recommendations сохраняют технику, разминку, восстановление, кардио, безопасность и прочие рекомендации; nutrition — только при согласии профиля, без медицинских назначений и дневника калорий. setPlans содержат каждый разминочный/рабочий подход; длина равна sets. Неизвестный вес null. Числовые rir/rirMax применяются только к повторениям; для времени/дистанции rir можно не указывать или задать null, rirMax не указывай. seconds/maxSeconds задают диапазон времени. Факты и plannedSnapshot в recentSessions позволяют сравнивать план и результат; programPosition — текущий этап и число пройденных занятий. Сохраняй все значимые данные программы при предложении новой версии.";
