import { z } from "zod";
import { findExercise, type Exercise } from "./exercise";
import { workoutSessionSchema, type ExerciseSet } from "./session";

type DoneSet = Extract<ExerciseSet, { status: "done" }>;
export type ProgressPoint = Readonly<{
  sessionId: string; programVersionId: string; endedAt: string;
  status: "completed" | "partial"; total: number; sets: readonly DoneSet[];
}>;
export type ExerciseProgress = Readonly<{
  exercise: Exercise; unit: "повт." | "с" | "м";
  total: number; doneSetCount: number; points: readonly ProgressPoint[];
}>;

/** Work recorded, not strength, physiological change or attainment of a free-text goal. */
export function buildProgress(input: unknown) {
  const sessions = z.array(workoutSessionSchema).parse(input);
  if (new Set(sessions.map((session) => session.id)).size !== sessions.length) {
    throw new Error("Занятие повторяется в истории");
  }
  const counts = { completed: 0, partial: 0, skipped: 0, abandoned: 0, active: 0 };
  const groups = new Map<string, { exercise: Exercise; unit: ExerciseProgress["unit"];
    total: number; doneSetCount: number; points: ProgressPoint[] }>();
  const finished = sessions.filter((session) => {
    counts[session.status] += 1;
    return session.status === "completed" || session.status === "partial";
  }).sort((a, b) => Date.parse(a.endedAt ?? "") - Date.parse(b.endedAt ?? "") || a.id.localeCompare(b.id));
  for (const session of finished) {
    if (session.endedAt === null || (session.status !== "completed" && session.status !== "partial")) continue;
    const sets = new Map<string, DoneSet[]>();
    for (const set of session.sets) {
      if (set.status !== "done") continue;
      const group = sets.get(set.actualExerciseId) ?? [];
      group.push(set);
      sets.set(set.actualExerciseId, group);
    }
    for (const [exerciseId, facts] of sets) {
      const exercise = findExercise(exerciseId, facts[0]?.definition);
      if (!exercise) throw new Error("Упражнение отсутствует в каталоге");
      facts.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id));
      const total = facts.reduce((sum, set) => sum + (set.actual.type === "reps" ? set.actual.reps
        : set.actual.type === "duration" ? set.actual.seconds : set.actual.meters), 0);
      const group = groups.get(exerciseId) ?? { exercise,
        unit: exercise.measurement === "reps" ? "повт." : exercise.measurement === "duration" ? "с" : "м",
        total: 0, doneSetCount: 0, points: [] };
      group.total += total;
      group.doneSetCount += facts.length;
      group.points.push({ sessionId: session.id, programVersionId: session.programVersionId,
        endedAt: session.endedAt, status: session.status, total, sets: facts });
      groups.set(exerciseId, group);
    }
  }
  return { counts, exercises: [...groups.values()].sort((a, b) => a.exercise.id.localeCompare(b.exercise.id)) };
}

export type Progress = ReturnType<typeof buildProgress>;
