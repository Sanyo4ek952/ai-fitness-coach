import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { workoutSessionSchema } from "@/entities/training";
import { SessionSets } from "@/features/next-workout/set-form";
import { RestTimer } from "@/features/next-workout/session-controls";

const time = "2026-11-24T12:00:00Z";
function fixture() {
  const templateId = crypto.randomUUID(); const rowId = crypto.randomUUID();
  return workoutSessionSchema.parse({ id: crypto.randomUUID(), programVersionId: crypto.randomUUID(), templateId,
    plannedSnapshot: { id: templateId, title: "Тест", exercises: [{ id: rowId, exerciseId: "db-bench-press", sets: 2,
      target: { type: "reps", min: 6, max: 8, weightKg: 30 }, restSec: 60 }] },
    startedAt: time, endedAt: null, status: "active", sets: [], replacements: [{ plannedExerciseId: rowId,
      originalExerciseId: "db-bench-press", actualExerciseId: "push-up", timestamp: time }] });
}
const action = async () => true;
describe("M3-03 формы по фактическому упражнению", () => {
  it.each([
    { exerciseId: "plank", target: { type: "duration", seconds: 30 }, label: "Время, секунды, подход 1" },
    { exerciseId: "treadmill-walk", target: { type: "distance", meters: 500 }, label: "Дистанция, метры, подход 1" },
  ])("UX-05: $exerciseId использует свою единицу без полей веса и RIR", ({ exerciseId, target, label }) => {
    const base = fixture();
    const session = workoutSessionSchema.parse({ ...base, replacements: [], plannedSnapshot: { ...base.plannedSnapshot,
      exercises: [{ ...base.plannedSnapshot.exercises[0], exerciseId, target }] } });
    const html = renderToStaticMarkup(<SessionSets session={session} revision={1} busy={false} onSave={action} onAction={action} onTimer={action} />);
    expect(html).toContain(`aria-label="${label}"`);
    expect(html).not.toContain('aria-label="Вес, кг, подход 1"');
    expect(html).not.toContain('aria-label="RIR, подход 1"');
  });
  it("новая форма замены не переносит плановый вес и поясняет дополнительную нагрузку", () => {
    const session = fixture();
    const html = renderToStaticMarkup(<SessionSets session={session} revision={1} busy={false} onSave={action} onAction={action} onTimer={action} />);
    expect(html).toContain("дополнительный вес, без массы тела");
    expect(html).toContain("Отжимания от пола"); expect(html).not.toContain('value="30"');
  });
  it("исходный выполненный факт сохраняет имя и не становится фактом замены", () => {
    const base = fixture(); const row = base.plannedSnapshot.exercises[0];
    const session = workoutSessionSchema.parse({ ...base, sets: [{ id: crypto.randomUUID(), sessionId: base.id, plannedExerciseId: row.id,
      originalExerciseId: row.exerciseId, actualExerciseId: row.exerciseId, index: 1, timestamp: time, status: "done", actual: { type: "reps", reps: 7, weightKg: 20 } }] });
    const html = renderToStaticMarkup(<SessionSets session={session} revision={1} busy={false} onSave={action} onAction={action} onTimer={action} />);
    expect(html).toContain("Сохранённый факт · Жим гантелей лёжа: 7 повторений · 20 кг");
    expect(html).toContain("Отжимания от пола");
  });
  it("SSR таймера не читает часы браузера и не выдумывает остаток", () => {
    const session = { ...fixture(), restTimer: { id: crypto.randomUUID(), startedAt: time, deadline: "2026-11-24T12:01:00Z" } };
    const html = renderToStaticMarkup(<RestTimer session={session} busy={false} onTimer={action} />);
    expect(html).toContain("Восстанавливаем время"); expect(html).toContain('role="timer"'); expect(html).toContain('aria-live="off"');
  });
});
