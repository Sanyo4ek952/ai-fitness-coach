import { z } from "zod";
import { coachHistorySummarySchema } from "./coach-request";
import { workoutSessionSchema } from "./session";

/** Counts work performed, never tonnage, load progression or physiological improvement. */
export function buildReviewHistory(input: unknown) {
  const sessions = z.array(workoutSessionSchema).parse(input)
    .filter((session) => session.status === "completed" || session.status === "partial")
    .sort((a, b) => Date.parse(b.endedAt ?? "") - Date.parse(a.endedAt ?? "") || a.id.localeCompare(b.id));
  const groups = new Map<string, { exerciseId: string; measurement: "reps" | "duration" | "distance";
    unit: "reps" | "seconds" | "meters"; sessionIds: Set<string>; values: number[]; timestamps: string[] }>();
  for (const session of sessions) {
    for (const set of [...session.sets].sort((a, b) => a.id.localeCompare(b.id))) {
      if (set.status !== "done") continue;
    const actual = set.actual;
      const group = groups.get(set.actualExerciseId) ?? { exerciseId: set.actualExerciseId, measurement: actual.type,
        unit: actual.type === "reps" ? "reps" : actual.type === "duration" ? "seconds" : "meters",
        sessionIds: new Set<string>(), values: [], timestamps: [] };
      group.sessionIds.add(session.id);
      group.values.push(actual.type === "reps" ? actual.reps : actual.type === "duration" ? actual.seconds : actual.meters);
      group.timestamps.push(set.timestamp);
      groups.set(set.actualExerciseId, group);
    }
  }
  const historySummary = [...groups.values()].sort((a, b) => a.exerciseId.localeCompare(b.exerciseId)).map((group) => {
    const times = group.timestamps.sort((a, b) => Date.parse(a) - Date.parse(b) || a.localeCompare(b));
    const definition = sessions.flatMap((s) => s.sets).find((s) => s.actualExerciseId === group.exerciseId)?.definition;
    return coachHistorySummarySchema.parse({ exerciseId: group.exerciseId, ...(definition ? { definition } : {}), measurement: group.measurement, unit: group.unit,
      sessionCount: group.sessionIds.size, doneSetCount: group.values.length,
      total: group.values.reduce((sum, value) => sum + value, 0), firstPerformedAt: times[0], lastPerformedAt: times[times.length - 1] });
  });
  return { recentSessions: sessions.slice(0, 20), historySummary };
}
