import { describe, expect, it } from "vitest";
import { workoutSessionSchema, type WorkoutSession } from "@/entities/training";
import { firstPendingSlot, nextSlotAfterRecording } from "@/features/next-workout/session-navigation";

function fixture() {
  const id = crypto.randomUUID(); const templateId = crypto.randomUUID();
  const rows = ["goblet-squat", "db-row", "plank"].map((exerciseId, i) => ({ id: crypto.randomUUID(), exerciseId, sets: i === 2 ? 1 : 3,
    target: i === 2 ? { type: "duration", seconds: 30 } : { type: "reps", min: 10, max: 12, weightKg: 20 }, restSec: 120 }));
  const base = workoutSessionSchema.parse({ id, templateId, programVersionId: crypto.randomUUID(), plannedSnapshot: { id: templateId, title: "Тест", exercises: rows }, status: "active", startedAt: "2026-11-26T10:00:00Z", endedAt: null, sets: [] });
  function fill(slots: readonly [number, number][], skipped = false): WorkoutSession {
    return workoutSessionSchema.parse({ ...base, sets: slots.map(([r, index]) => ({ id: crypto.randomUUID(), sessionId: id, plannedExerciseId: rows[r].id, originalExerciseId: rows[r].exerciseId, actualExerciseId: rows[r].exerciseId, index, timestamp: base.startedAt,
      ...(skipped ? { status: "skipped" } : { status: "done", actual: r === 2 ? { type: "duration", seconds: 30 } : { type: "reps", reps: 10, weightKg: 20 } }) })) });
  }
  return { base, rows, fill };
}

describe("UX-06 переход между упражнениями", () => {
  it("после последнего подхода открывает первое свободное место следующего упражнения", () => {
    const { rows, fill } = fixture(); const session = fill([[0, 1], [0, 2]]); const before = JSON.stringify(session);
    expect(nextSlotAfterRecording(session, { rowId: rows[0].id, index: 3 })).toEqual({ rowId: rows[1].id, index: 1 });
    expect(JSON.stringify(session)).toBe(before);
  });
  it("до конца упражнения остаётся в нём", () => {
    const { base, rows } = fixture(); expect(nextSlotAfterRecording(base, { rowId: rows[0].id, index: 1 })).toEqual({ rowId: rows[0].id, index: 2 });
  });
  it("не возвращается на уже сохранённый в liveQuery подход", () => {
    const { rows, fill } = fixture(); expect(nextSlotAfterRecording(fill([[0, 1], [0, 2], [0, 3], [1, 1]]), { rowId: rows[0].id, index: 3 })).toEqual({ rowId: rows[1].id, index: 2 });
  });
  it("пропущенные слоты не предлагает заново", () => {
    const { rows, fill } = fixture(); expect(nextSlotAfterRecording(fill([[0, 1], [0, 2], [1, 1]], true), { rowId: rows[0].id, index: 3 })).toEqual({ rowId: rows[1].id, index: 2 });
  });
  it("возвращает ранее оставленное упражнение после последнего, если оно не закончено", () => {
    const { rows, fill } = fixture(); expect(nextSlotAfterRecording(fill([[0, 1], [0, 2], [0, 3]]), { rowId: rows[2].id, index: 1 })).toEqual({ rowId: rows[1].id, index: 1 });
  });
  it("после всех подходов не начинает упражнение заново", () => {
    const { rows, fill } = fixture(); const session = fill([[0, 1], [0, 2], [0, 3], [1, 1], [1, 2], [1, 3]]);
    expect(nextSlotAfterRecording(session, { rowId: rows[2].id, index: 1 })).toBeUndefined();
    expect(firstPendingSlot(fill([[0, 1], [0, 2], [0, 3], [1, 1], [1, 2], [1, 3], [2, 1]]))).toBeUndefined();
  });
});
