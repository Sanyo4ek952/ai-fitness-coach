import { z } from "zod";
import { profileSchema } from "./profile";
import { programVersionSchema } from "./program";
import { workoutSessionSchema, type WorkoutSession } from "./session";
import { coachAcceptanceSchema } from "./coach-acceptance";
import { coachReasonSchema } from "./coach-request";
import { idSchema, revisionSchema, timestampSchema, unique } from "./primitives";

const analysisReasonSchema = coachReasonSchema.exclude(["initial"]);
export const analysisSnapshotSchema = z.strictObject({
  baselineKey: idSchema,
  profileRevision: revisionSchema.optional(),
  baselineProfileRevision: revisionSchema.optional(),
  reasonCodes: z.array(analysisReasonSchema).readonly(),
  facts: z.array(z.strictObject({ sessionId: idSchema, setIds: z.array(idSchema).readonly() }).readonly()).readonly(),
}).readonly();

export const analysisControlSchema = z.strictObject({
  baselineKey: idSchema,
  manual: z.boolean(),
  snooze: z.strictObject({
    sessionIds: z.array(idSchema).readonly(),
    signalKeys: z.array(z.string()).readonly(),
  }).readonly().nullable(),
}).readonly();

const inputSchema = z.strictObject({
  now: timestampSchema,
  profile: profileSchema,
  baselineProfile: profileSchema,
  program: programVersionSchema,
  acceptance: coachAcceptanceSchema.optional(),
  sessions: z.array(workoutSessionSchema).refine((items) => unique(items.map((session) => session.id)), "Занятия повторяются").readonly(),
  control: analysisControlSchema.optional(),
});
type Reason = z.infer<typeof analysisReasonSchema>;
type Evidence = Readonly<{ sessionId: string; setIds: readonly string[] }>;
export type AnalysisSignal = Readonly<{ reason: Reason; key: string; message: string; evidence: readonly Evidence[] }>;

// Product heuristics from AI_COACH, not a prescription or a diagnosis.
// Only complete comparable rows of reps can establish a performance signal.
function observations(session: WorkoutSession) {
  return session.plannedSnapshot.exercises.flatMap((row) => {
    if (row.target.type !== "reps" || row.target.weightKg === null) return [];
    const target = row.target;
    const sets = session.sets.filter((set) => set.plannedExerciseId === row.id);
    if (sets.length !== row.sets || !sets.every((set) => set.status === "done"
      && set.actualExerciseId === row.exerciseId && set.actual.type === "reps"
      && set.actual.weightKg !== null && set.actual.weightKg === target.weightKg)) return [];
    const below = sets.every((set) => set.status === "done" && set.actual.type === "reps" && set.actual.reps < target.min);
    const targetRir = row.rir;
    const above = targetRir != null && sets.every((set) => set.status === "done" && set.actual.type === "reps"
      && set.actual.reps > target.max && set.rir != null && set.rir >= targetRir);
    return [{ key: JSON.stringify([session.templateId, row.id, row.exerciseId, target, row.rir ?? null, row.sets]),
      direction: below ? "below" : above ? "above" : "within", evidence: { sessionId: session.id, setIds: sets.map((set) => set.id) } }];
  });
}

/** Pure: all time, baseline and facts supplied by the caller; no writes or clocks. */
export function evaluateAnalysis(input: unknown) {
  const { now, profile, baselineProfile, program, acceptance, sessions, control } = inputSchema.parse(input);
  if (acceptance && acceptance.programVersionId !== program.id) throw new Error("Baseline другой программы");
  const baselineKey = acceptance?.requestId ?? program.id;
  const since = Date.parse(acceptance?.acceptedAt ?? program.createdAt);
  const time = Date.parse(now);
  const scoped = sessions.filter((session) => session.programVersionId === program.id
    && Date.parse(session.startedAt) >= since && Date.parse(session.startedAt) <= time);
  const finished = scoped.filter((session) => (session.status === "completed" || session.status === "partial")
    && session.endedAt !== null && Date.parse(session.endedAt) > since && Date.parse(session.endedAt) <= time && session.sets.some((set) => set.status === "done"))
    .sort((a, b) => Date.parse(a.endedAt ?? "") - Date.parse(b.endedAt ?? "") || a.id.localeCompare(b.id));
  const signals: AnalysisSignal[] = [];
  const pain = scoped.flatMap((session) => {
    const setIds = session.sets.filter((set) => set.pain === true && Date.parse(set.timestamp) <= time).map((set) => set.id);
    return setIds.length ? [{ sessionId: session.id, setIds }] : [];
  });
  if (pain.length) signals.push({ reason: "safety", key: "safety", message: "В фактах отмечена боль. Остановите соответствующее упражнение; при острых или необычных симптомах обратитесь за помощью по ситуации. Не ждите ответа ИИ.", evidence: pain });
  const context = (p: typeof profile) => JSON.stringify([p.goal, p.sessionsPerWeek, [...p.equipment].sort()]);
  if (context(profile) !== context(baselineProfile)) signals.push({ reason: "changed_context", key: `context:${context(profile)}`,
    message: "Изменились цель, частота или оборудование относительно принятого анализа.", evidence: [] });
  // Adjacent occurrences of the same template. A missing/skipped/replaced row
  // breaks the pair; never jump over it to manufacture a trend.
  for (const template of program.workouts) {
    const pair = finished.filter((session) => session.templateId === template.id).slice(-2);
    if (pair.length !== 2) continue;
    const previous = observations(pair[0]);
    for (const current of observations(pair[1])) {
      const earlier = previous.find((item) => item.key === current.key);
      if (current.direction === "within" || earlier?.direction !== current.direction) continue;
      signals.push({ reason: "performance", key: `performance:${current.key}:${current.direction}`,
        message: current.direction === "below" ? "Два сопоставимых занятия ниже диапазона повторений." : "Два сопоставимых занятия выше диапазона повторений с известным достаточным запасом.",
        evidence: [earlier.evidence, current.evidence] });
    }
  }
  // A cycle needs actual results from every template, at least two sessions;
  // skips and cursor wrap alone cannot complete an analysis cycle.
  const cycle = finished.length >= 2 && program.workouts.every((template) => finished.some((session) => session.templateId === template.id));
  if (cycle || (time - since >= 7 * 86400000 && finished.length >= 2)) signals.push({ reason: "periodic", key: "periodic",
    message: cycle ? "Завершён цикл занятий с тренировочными результатами." : "С принятого анализа прошли минимум 7 дней и два занятия с результатами.",
    evidence: finished.map((session) => ({ sessionId: session.id, setIds: session.sets.filter((set) => set.status === "done").map((set) => set.id) })) });
  const saved = control?.baselineKey === baselineKey ? control : undefined;
  if (saved?.manual) signals.push({ reason: "manual", key: "manual", message: "Анализ запрошен вами.", evidence: [] });
  const snooze = saved?.snooze;
  const remaining = snooze ? Math.max(0, 2 - finished.filter((session) => !snooze.sessionIds.includes(session.id)).length) : 0;
  const significant = signals.filter((signal) => signal.reason !== "periodic");
  const deferred = remaining > 0 && !signals.some((signal) => signal.reason === "safety")
    && significant.every((signal) => snooze?.signalKeys.includes(signal.key));
  return Object.freeze({ baselineKey, signals: Object.freeze(signals), reasonCodes: Object.freeze([...new Set(signals.map((signal) => signal.reason))]),
    sessionIds: Object.freeze(finished.map((session) => session.id)), deferred, remaining: deferred ? remaining : 0,
    needsAnalysis: signals.length > 0 && !deferred });
}

export type AnalysisResult = ReturnType<typeof evaluateAnalysis>;
