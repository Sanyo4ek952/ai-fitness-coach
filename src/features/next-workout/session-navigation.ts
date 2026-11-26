import type { WorkoutSession } from "@/entities/training";

export type SessionSlot = Readonly<{ rowId: string; index: number }>;

function pendingSlots(session: WorkoutSession, justRecorded?: SessionSlot): readonly SessionSlot[] {
  return session.plannedSnapshot.exercises.flatMap((row) => Array.from({ length: row.sets }, (_, i) => ({ rowId: row.id, index: i + 1 })))
    .filter((slot) => !(justRecorded?.rowId === slot.rowId && justRecorded.index === slot.index)
      && !session.sets.some((set) => set.plannedExerciseId === slot.rowId && set.index === slot.index));
}

export function firstPendingSlot(session: WorkoutSession): SessionSlot | undefined {
  return pendingSlots(session)[0];
}

// Select only after our successful commit. Remote updates and failed writes must
// not move the editor or discard its original expectedSet baseline.
export function nextSlotAfterRecording(session: WorkoutSession, recorded: SessionSlot): SessionSlot | undefined {
  const pending = pendingSlots(session, recorded);
  const sameExercise = pending.find((slot) => slot.rowId === recorded.rowId && slot.index > recorded.index)
    ?? pending.find((slot) => slot.rowId === recorded.rowId);
  if (sameExercise) return sameExercise;
  const rowIndex = session.plannedSnapshot.exercises.findIndex((row) => row.id === recorded.rowId);
  return pending.find((slot) => session.plannedSnapshot.exercises.findIndex((row) => row.id === slot.rowId) > rowIndex)
    ?? pending[0];
}
