import { conditionLabels, recommendationLabels, exerciseMetadataText } from "./program-display";
import { ruleActionText, setPlanLabel } from "./progression";
import { findExercise } from "./exercise";
import { programDraftSchema, programVersionSchema, type ProgramDraft, type Prescription } from "./program";

// External drafts have no stable row/template IDs. Compare ordered positions,
// never guess identity from a title (duplicates and renamed templates are valid).
export function programToDraft(input: unknown): ProgramDraft {
  const program = programVersionSchema.parse(input);
  return programDraftSchema.parse({ title: program.title, goalInterpretation: program.goalInterpretation,
    ...(program.phases !== undefined ? { phases: program.phases } : {}),
    ...(program.progressionRules !== undefined ? { progressionRules: program.progressionRules } : {}),
    ...(program.recommendations !== undefined ? { recommendations: program.recommendations } : {}),
    reviewAfterSessions: program.reviewAfterSessions,
    workouts: program.workouts.map((workout) => ({ title: workout.title,
      exercises: workout.exercises.map(({ id: _id, ...row }) => { void _id; return row; }) })) });
}

export type ProgramChange = Readonly<{ path: string; kind: "added" | "removed" | "changed"; before: string; after: string }>;

function prescriptionFields(result: Map<string, string>, key: string, row: Prescription) {
  result.set(`${key} · упражнение`, `${findExercise(row.exerciseId, row.definition)?.name} (${row.exerciseId})`);
  if (row.definition) result.set(`${key} · описание упражнения`, exerciseMetadataText(row.definition));
  if (row.rirMax !== undefined) result.set(`${key} · максимум RIR`, String(row.rirMax));
  row.setPlans?.forEach((_, index) => result.set(`${key} · подход ${index + 1}`, setPlanLabel(row, index + 1)));
  result.set(`${key} · подходы`, String(row.sets));
  const target = row.target;
  result.set(`${key} · измерение`, target.type === "reps" ? "Повторы" : target.type === "duration" ? "Секунды" : "Метры");
  if (target.type === "reps") {
    result.set(`${key} · минимум повторов`, String(target.min));
    result.set(`${key} · максимум повторов`, String(target.max));
    result.set(`${key} · вес, кг`, target.weightKg === null ? "Подобрать вес" : String(target.weightKg));
    result.set(`${key} · RIR`, row.rir == null ? "Неизвестен" : String(row.rir));
  } else {
    result.set(`${key} · цель`, target.type === "duration" ? `${target.seconds}${target.maxSeconds === undefined ? "" : `–${target.maxSeconds}`} с` : `${target.meters} м`);
    result.set(`${key} · интенсивность`, target.intensity === undefined ? "Не указана" : JSON.stringify(target.intensity));
  }
  result.set(`${key} · отдых, с`, String(row.restSec));
  result.set(`${key} · заметка`, row.note === undefined ? "Не указана" : JSON.stringify(row.note));
}

function fields(draft: ProgramDraft): Map<string, string> {
  const result = new Map<string, string>([["Название программы", draft.title], ["Интерпретация цели", draft.goalInterpretation],
    ["До анализа, занятий", String(draft.reviewAfterSessions)], ["Занятий в последовательности", String(draft.workouts.length)]]);
  draft.workouts.forEach((workout, i) => {
    const prefix = `Занятие ${i + 1}`;
    result.set(`${prefix} · название`, workout.title);
    result.set(`${prefix} · упражнений`, String(workout.exercises.length));
    workout.exercises.forEach((row, j) => prescriptionFields(result, `${prefix} · позиция ${j + 1}`, row));
  });
  draft.phases?.forEach((phase, i) => {
    const key = `Этап ${i + 1}`;
    result.set(`${key} · идентификатор`, phase.id);
    result.set(`${key} · название`, phase.title);
    result.set(`${key} · цель`, JSON.stringify(phase.goal));
    result.set(`${key} · длительность`, phase.duration.unit === "weeks" ? `${phase.duration.count} нед. × ${phase.duration.sessionsPerWeek} занятий` : `${phase.duration.count} занятий`);
    result.set(`${key} · переход`, phase.transition === "manual" ? "По вашей оценке с подтверждением" : "После объёма занятий с подтверждением");
    if (phase.transitionNote) result.set(`${key} · условие перехода`, JSON.stringify(phase.transitionNote));
    phase.overrides.forEach((o, j) => {
      const prefix = `${key} · изменение ${j + 1}`;
      result.set(`${prefix} · позиция`, `Занятие ${o.workoutIndex + 1}, упражнение ${o.exerciseIndex + 1}`);
      prescriptionFields(result, prefix, o.prescription);
    });
  });
  draft.progressionRules?.forEach((rule, i) => {
    const key = `Правило прогрессии ${i + 1}`;
    result.set(`${key} · идентификатор`, rule.id);
    result.set(`${key} · область`, rule.exerciseId ?? "Вся программа");
    result.set(`${key} · описание`, JSON.stringify(rule.description));
    result.set(`${key} · условие`, conditionLabels[rule.condition.type]);
    result.set(`${key} · занятий`, String(rule.condition.sessions));
    if (rule.condition.minRir !== undefined) result.set(`${key} · минимум RIR`, String(rule.condition.minRir));
    if (rule.condition.maxRir !== undefined) result.set(`${key} · максимум RIR`, String(rule.condition.maxRir));
    result.set(`${key} · действие`, `${rule.action.type === "weight" ? "Вес" : rule.action.type === "reps" ? "Повторы" : rule.action.type === "sets" ? "Подходы" : "Анализ"}: ${JSON.stringify(ruleActionText(rule.action))}`);
  });
  draft.recommendations?.forEach((r, i) => {
    const key = `Рекомендация ${i + 1}`;
    result.set(`${key} · категория`, recommendationLabels[r.category]);
    result.set(`${key} · текст`, JSON.stringify(r.text));
    if (r.exerciseId) result.set(`${key} · упражнение`, r.exerciseId);
    if (r.phaseId) result.set(`${key} · этап`, r.phaseId);
  });
  return result;
}

export function diffPrograms(beforeInput: unknown, afterInput: unknown): readonly ProgramChange[] {
  const before = fields(programDraftSchema.parse(beforeInput));
  const after = fields(programDraftSchema.parse(afterInput));
  return Object.freeze([...new Set([...before.keys(), ...after.keys()])].flatMap((path) => {
    const old = before.get(path); const next = after.get(path);
    return old === next ? [] : [Object.freeze({ path, kind: old === undefined ? "added" as const : next === undefined ? "removed" as const : "changed" as const,
      before: old ?? "Отсутствует", after: next ?? "Отсутствует" })];
  }));
}
