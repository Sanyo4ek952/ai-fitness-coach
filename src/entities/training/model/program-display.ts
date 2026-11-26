import type { Exercise } from "./exercise";

export const recommendationLabels = { technique: "Техника", warmup: "Разминка", recovery: "Восстановление", cardio: "Кардио", nutrition: "Питание", safety: "Безопасность", other: "Дополнительно" };
export const conditionLabels = { upper_reps: "Верхняя граница повторов", below_reps: "Ниже нижней границы повторов", plateau: "Без изменения сопоставимых результатов", excessive_load: "Чрезмерная нагрузка", manual: "Оценка спортсменом / тренером" };
const equipmentLabels = { dumbbells: "гантели", bench: "скамья", barbell: "штанга", rack: "стойка", cable: "блочные тренажёры", "leg-press": "жим ногами", "assisted-pull-up": "гравитрон", machine: "силовой тренажёр", treadmill: "дорожка", bodyweight: "собственный вес", unknown: "неизвестно" };
const muscleLabels = { legs: "ноги", glutes: "ягодицы", chest: "грудь", back: "спина", shoulders: "плечи", arms: "руки", core: "корпус", cardio: "кардио" };

export function exerciseMetadataText(exercise: Exercise): string {
  const load = exercise.load;
  const loadText = load.type === "none" ? "без учёта веса" : load.type === "assistance" ? "килограммы помощи"
    : load.type === "bodyweight" ? "собственный вес; килограммы — дополнительное отягощение"
      : load.basis === "per-dumbbell" ? "килограммы одной гантели" : load.basis === "machine-stack" ? "килограммы тренажёра" : "общий вес в килограммах";
  return `${exercise.equipment.map((e) => equipmentLabels[e]).join(", ")} · ${exercise.muscleGroups.map((m) => muscleLabels[m]).join(", ")} · ${exercise.measurement === "reps" ? "повторения" : exercise.measurement === "duration" ? "время" : "дистанция"} · ${loadText}`;
}
