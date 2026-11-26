import { programVersionSchema, plannedSet, type Prescription } from "./program";
import { workoutSessionSchema } from "./session";
import { z } from "zod";

// Suggestions only. No plan/cursor/fact writes; assistance direction stays explicit in the rule.
export function evaluateProgression(programInput: unknown, sessionsInput: unknown, phaseIndex?: number) {
  const program = programVersionSchema.parse(programInput);
  const sessions = z.array(workoutSessionSchema).parse(sessionsInput)
    .filter((s) => s.programVersionId === program.id && s.phaseIndex === phaseIndex
      && (s.status === "completed" || s.status === "partial"))
    .sort((a, b) => Date.parse(b.endedAt ?? "") - Date.parse(a.endedAt ?? "") || a.id.localeCompare(b.id));
  return (program.progressionRules ?? []).flatMap((rule) => {
    if (rule.condition.type === "manual") return [];
    const ids = rule.exerciseId ? [rule.exerciseId] : [...new Set(program.workouts.flatMap((w) => w.exercises.map((r) => r.exerciseId)))];
    return ids.flatMap((exerciseId) => {
      if (!rule.exerciseId && program.progressionRules?.some((r) => r.exerciseId === exerciseId && r.action.type === rule.action.type && r.condition.type === rule.condition.type)) return [];
      const relevant = sessions.filter((s) => s.plannedSnapshot.exercises.some((r) => r.exerciseId === exerciseId)).slice(0, rule.condition.sessions);
      if (relevant.length < rule.condition.sessions) return [];
      const samples = relevant.map((s) => {
        const rows = s.plannedSnapshot.exercises.filter((r) => r.exerciseId === exerciseId);
        return rows.flatMap((row) => Array.from({ length: row.sets }, (_, i) => ({ row: plannedSet(row, i + 1), kind: row.setPlans?.[i]?.kind ?? "working",
          fact: s.sets.find((set) => set.plannedExerciseId === row.id && set.index === i + 1 && set.actualExerciseId === exerciseId) })))
          .filter((v) => v.kind === "working");
      });
      if (samples.some((list) => list.length === 0 || list.some((v) => v.fact?.status !== "done"))) return [];
      const eligible = samples.every((list) => list.every(({ row, fact }) => {
        if (fact?.status !== "done" || fact.actual.type !== "reps" || row.target.type !== "reps") return false;
        const c = rule.condition;
        if ((c.minRir !== undefined && (fact.rir == null || fact.rir < c.minRir))
          || (c.maxRir !== undefined && (fact.rir == null || fact.rir > c.maxRir))) return false;
        if (fact.actual.weightKg === null || row.target.weightKg === null || fact.actual.weightKg !== row.target.weightKg) return false;
        return c.type === "upper_reps" ? fact.actual.reps >= row.target.max
          : c.type === "below_reps" ? fact.actual.reps < row.target.min
            : c.type === "excessive_load" ? fact.actual.reps < row.target.min || (fact.rir != null && row.rir != null && fact.rir < row.rir) : true;
      }));
      if (!eligible) return [];
      // Plateau means identical comparable working sets over the explicitly requested window.
      if (rule.condition.type === "plateau") {
        if (samples.length < 2) return [];
        const key = (list: typeof samples[number]) => JSON.stringify(list.map(({ row, fact }) => ({ target: row.target, actual: fact?.status === "done" ? fact.actual : null })));
        if (!samples.every((list) => key(list) === key(samples[0]))) return [];
      }
      return [{ exerciseId, rule }];
    });
  });
}

export function ruleActionText(action: NonNullable<z.infer<typeof programVersionSchema>["progressionRules"]>[number]["action"]): string {
  return action.type === "review" ? action.instruction : `${action.change > 0 ? "+" : ""}${action.change} ${action.type === "weight" ? action.unit === "kg" ? "кг" : "%" : action.type === "reps" ? "повт." : "подх."}`;
}

export function setPlanLabel(row: Prescription, index: number): string {
  const plan = plannedSet(row, index);
  const t = plan.target;
  return `${row.setPlans?.[index - 1]?.kind === "warmup" ? "Разминочный" : "Рабочий"}: ${t.type === "reps" ? `${t.min}–${t.max} повт. · ${t.weightKg === null ? "вес подобрать" : `${t.weightKg} кг`}` : t.type === "duration" ? `${t.seconds}${t.maxSeconds === undefined ? "" : `–${t.maxSeconds}`} с` : `${t.meters} м`} · отдых ${plan.restSec} с${t.type === "reps" ? ` · RIR ${plan.rir ?? "неизвестен"}${plan.rirMax === undefined ? "" : `–${plan.rirMax}`}` : ""}${t.type !== "reps" && t.intensity ? ` · ${t.intensity}` : ""}${plan.note ? ` · ${plan.note}` : ""}`;
}
