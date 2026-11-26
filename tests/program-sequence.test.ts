import { describe, expect, it } from "vitest";
import response from "../examples/coach-response.example.json";
import {
  createInitialProgramCursor, createProgramVersionFromDraft, programCursorSchema, selectNextWorkout,
} from "../src/entities/training/model/program-sequence";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const metadata = { id: uuid(1), revision: 1, previousId: null, profileRevision: 1, createdAt: "2026-11-24T10:00:00Z" };
function version() {
  let id = 2;
  return createProgramVersionFromDraft(response.proposedProgram, metadata, () => uuid(id++));
}

describe("последовательность программы M2-03", () => {
  it("присваивает внутренние ID и сохраняет весь план и порядок без изменения входа", () => {
    const original = structuredClone(response);
    const program = version();
    expect(program.workouts.map(({ title }) => title)).toEqual(response.proposedProgram.workouts.map(({ title }) => title));
    expect(program.workouts.map(({ exercises }) => exercises.map(({ id, ...row }) => { expect(id).toMatch(/^[\da-f-]{36}$/); return row; })))
      .toEqual(response.proposedProgram.workouts.map(({ exercises }) => exercises));
    expect(response).toEqual(original);
    expect(Object.isFrozen(program.workouts[0].exercises[0])).toBe(true);
  });
  it("новая версия всегда начинает с первого шаблона, без даты и частоты", () => {
    const program = version();
    const cursor = createInitialProgramCursor(program);
    expect(cursor).toEqual({ programVersionId: program.id, nextWorkoutIndex: 0 });
    expect(selectNextWorkout(program, cursor)).toEqual(program.workouts[0]);
    expect(selectNextWorkout(JSON.parse(JSON.stringify(program)), JSON.parse(JSON.stringify(cursor))))
      .toEqual(program.workouts[0]);
  });
  it("выбирает по позиции массива, даже если названия одинаковые", () => {
    const program = version();
    const workouts = [program.workouts[0], { ...program.workouts[0], id: uuid(99), exercises: program.workouts[0].exercises.map((row, index) => ({ ...row, id: uuid(100 + index) })) }];
    expect(selectNextWorkout({ ...program, workouts }, { programVersionId: program.id, nextWorkoutIndex: 1 }).id).toBe(uuid(99));
  });
  it("новая версия получает собственные ID и начальную позицию, прежняя не меняется", () => {
    const previous = version();
    const before = JSON.stringify(previous);
    let id = 50;
    const next = createProgramVersionFromDraft(response.proposedProgram, {
      ...metadata, id: uuid(40), revision: 2, previousId: previous.id,
    }, () => uuid(id++));
    expect(createInitialProgramCursor(next)).toEqual({ programVersionId: next.id, nextWorkoutIndex: 0 });
    expect(next.workouts[0].id).not.toBe(previous.workouts[0].id);
    expect(JSON.stringify(previous)).toBe(before);
  });
  it("сохраняет секунды/метры и необязательную интенсивность без преобразования в повторы", () => {
    const draft = {
      title: "Последовательность", goalInterpretation: "Смешанные занятия", reviewAfterSessions: 2,
      workouts: [{ title: "А", exercises: [
        { exerciseId: "plank", sets: 1, target: { type: "duration", seconds: 30, intensity: "Комфортно" }, restSec: 30 },
        { exerciseId: "treadmill-walk", sets: 1, target: { type: "distance", meters: 500 }, restSec: 0 },
      ] }],
    };
    let id = 2;
    const program = createProgramVersionFromDraft(draft, metadata, () => uuid(id++));
    expect(program.workouts[0].exercises.map((row) => row.target)).toEqual(draft.workouts[0].exercises.map((row) => row.target));
  });
  it("не сбрасывает повреждённый или чужой курсор на первое занятие", () => {
    const program = version();
    expect(() => selectNextWorkout(program, { programVersionId: uuid(99), nextWorkoutIndex: 0 })).toThrow("другой версии");
    expect(() => selectNextWorkout(program, { programVersionId: program.id, nextWorkoutIndex: 13 })).toThrow("отсутствует");
    for (const value of [-1, 0.5, 14, Infinity]) {
      expect(programCursorSchema.safeParse({ programVersionId: program.id, nextWorkoutIndex: value }).success).toBe(false);
    }
  });
  it("отклоняет лишние поля, невалидные ID и повторяющиеся ID снимка", () => {
    expect(() => createProgramVersionFromDraft(response.proposedProgram, metadata, () => metadata.id)).toThrow();
    expect(() => createProgramVersionFromDraft(response.proposedProgram, { ...metadata, id: "external-title" }, () => uuid(2))).toThrow();
    expect(programCursorSchema.safeParse({ ...createInitialProgramCursor(version()), date: "2026-11-25" }).success).toBe(false);
  });
});
