import { z } from "zod";
import { exerciseSetSchema, restTimerSchema, workoutSessionSchema } from "./session";
import { updateRestTimer } from "./session-actions";
import { historyRevisionSchema } from "./session-lifecycle";

export const recordSetSchema = z.strictObject({
  set: exerciseSetSchema.refine((set) => set.status === "done", "Здесь сохраняется выполненный подход"),
  expectedSet: exerciseSetSchema.nullable(),
  expectedHistoryRevision: historyRevisionSchema,
  autoRest: z.strictObject({ expectedTimer: restTimerSchema.nullable(), timer: restTimerSchema }).readonly().optional(),
}).readonly();

// Only facts change. Creation requires an active session; a correction keeps
// provenance, slot and original time, including in a finished session.
export function recordWorkoutSet(sessionInput: unknown, commandInput: unknown) {
  const session = workoutSessionSchema.parse(sessionInput);
  const { set, expectedSet, autoRest } = recordSetSchema.parse(commandInput);
  if (autoRest && expectedSet !== null) throw new Error("Исправление факта не запускает отдых заново");
  const previous = session.sets.find((item) => item.id === set.id);
  if (set.sessionId !== session.id) throw new Error("Подход другого занятия");
  if (expectedSet === null) {
    if (session.status !== "active" || previous) throw new Error("Добавление возможно только в активное занятие без дубля");
    const occupied = session.sets.find((item) => item.plannedExerciseId === set.plannedExerciseId && item.index === set.index);
    if (occupied?.status === "skipped") throw new Error("Этот подход уже пропущен. Ваш ввод остаётся на экране. Закройте черновик без сохранения.");
    if (occupied) {
      throw new Error("Этот подход уже сохранён в другой вкладке. Ваш ввод остаётся на экране. Отмените ввод и откройте исправление сохранённого факта.");
    }
    const selected = session.replacements?.find((item) => item.plannedExerciseId === set.plannedExerciseId);
    if (set.actualExerciseId !== (selected?.actualExerciseId ?? set.originalExerciseId)) throw new Error("Замена упражнения — отдельное действие. Откройте форму заново после выбора замены.");
  } else {
    if (!previous || JSON.stringify(previous) !== JSON.stringify(expectedSet)) throw new Error("Подход изменился. Посмотрите сохранённый факт перед исправлением.");
    if (previous.status !== "done" || set.plannedExerciseId !== previous.plannedExerciseId || set.index !== previous.index
      || set.originalExerciseId !== previous.originalExerciseId || set.actualExerciseId !== previous.actualExerciseId
      || set.timestamp !== previous.timestamp) throw new Error("Нельзя менять происхождение, время или позицию факта");
  }
  const recorded = workoutSessionSchema.parse({ ...session, sets: previous
    ? session.sets.map((item) => item.id === set.id ? set : item)
    : [...session.sets, set] });
  return autoRest ? updateRestTimer(recorded, { sessionId: session.id, ...autoRest }) : recorded;
}
