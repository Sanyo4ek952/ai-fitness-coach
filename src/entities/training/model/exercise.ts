import { z } from "zod";
import { equipmentListSchema, text, unique } from "./primitives";

export const exerciseIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(80);
export const loadSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("external"), unit: z.literal("kg"), basis: z.enum(["total", "per-dumbbell", "machine-stack"]) }),
  z.strictObject({ type: z.literal("bodyweight"), unit: z.literal("kg"), basis: z.literal("added-weight") }),
  z.strictObject({ type: z.literal("assistance"), unit: z.literal("kg"), basis: z.literal("machine-assistance") }),
  z.strictObject({ type: z.literal("none"), unit: z.literal("none") }),
]).readonly();

export const exerciseSchema = z.strictObject({
  id: exerciseIdSchema,
  name: text(100),
  equipment: equipmentListSchema.refine((items) => !items.includes("unknown"), "У каталога должно быть известное оборудование"),
  measurement: z.enum(["reps", "duration", "distance"]),
  load: loadSchema,
  muscleGroups: z.array(z.enum(["legs", "glutes", "chest", "back", "shoulders", "arms", "core", "cardio"])).min(1).max(8).refine(unique).readonly(),
}).refine((exercise) => (exercise.measurement === "reps") === (exercise.load.type !== "none"), "Тип нагрузки несовместим с измерением").readonly();

export const exerciseCatalogSchema = z.array(exerciseSchema).min(1)
  .refine((items) => unique(items.map((item) => item.id)), "ID упражнений повторяются")
  .refine((items) => unique(items.map((item) => exerciseNameKey(item.name))), "Названия упражнений повторяются").readonly();
export type Exercise = z.infer<typeof exerciseSchema>;

export function exerciseNameKey(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/[\s\p{P}]+/gu, " ").trim();
}

// Авторские метаданные проекта, без заимствованных инструкций или изображений.
// Это каталог возможностей, а не готовая тренировочная рекомендация.
export const exerciseCatalog = exerciseCatalogSchema.parse([
  { id: "goblet-squat", name: "Присед с гантелью", equipment: ["dumbbells"], measurement: "reps", load: { type: "external", unit: "kg", basis: "total" }, muscleGroups: ["legs", "glutes"] },
  { id: "db-bench-press", name: "Жим гантелей лёжа", equipment: ["dumbbells", "bench"], measurement: "reps", load: { type: "external", unit: "kg", basis: "per-dumbbell" }, muscleGroups: ["chest", "arms"] },
  { id: "db-row", name: "Тяга гантели с опорой на скамью", equipment: ["dumbbells", "bench"], measurement: "reps", load: { type: "external", unit: "kg", basis: "per-dumbbell" }, muscleGroups: ["back", "arms"] },
  { id: "leg-press", name: "Жим ногами в тренажёре", equipment: ["leg-press"], measurement: "reps", load: { type: "external", unit: "kg", basis: "machine-stack" }, muscleGroups: ["legs", "glutes"] },
  { id: "push-up", name: "Отжимания от пола", equipment: ["bodyweight"], measurement: "reps", load: { type: "bodyweight", unit: "kg", basis: "added-weight" }, muscleGroups: ["chest", "arms", "core"] },
  { id: "assisted-pull-up", name: "Подтягивания с помощью тренажёра", equipment: ["assisted-pull-up"], measurement: "reps", load: { type: "assistance", unit: "kg", basis: "machine-assistance" }, muscleGroups: ["back", "arms"] },
  { id: "plank", name: "Планка", equipment: ["bodyweight"], measurement: "duration", load: { type: "none", unit: "none" }, muscleGroups: ["core"] },
  { id: "treadmill-walk", name: "Ходьба на дорожке по дистанции", equipment: ["treadmill"], measurement: "distance", load: { type: "none", unit: "none" }, muscleGroups: ["cardio", "legs"] },
  {"id": "barbell-squat", "name": "Присед со штангой", "equipment": ["barbell", "rack"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "total"}, "muscleGroups": ["legs", "glutes"]},
  {"id": "barbell-bench-press", "name": "Жим штанги лёжа", "equipment": ["barbell", "bench"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "total"}, "muscleGroups": ["chest", "arms"]},
  {"id": "deadlift", "name": "Становая тяга", "equipment": ["barbell"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "total"}, "muscleGroups": ["back", "legs", "glutes"]},
  {"id": "romanian-deadlift", "name": "Румынская тяга", "equipment": ["barbell"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "total"}, "muscleGroups": ["glutes", "legs", "back"]},
  {"id": "barbell-row", "name": "Тяга штанги в наклоне", "equipment": ["barbell"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "total"}, "muscleGroups": ["back", "arms"]},
  {"id": "overhead-press", "name": "Жим штанги стоя", "equipment": ["barbell"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "total"}, "muscleGroups": ["shoulders", "arms"]},
  {"id": "db-overhead-press", "name": "Жим гантелей сидя", "equipment": ["dumbbells", "bench"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "per-dumbbell"}, "muscleGroups": ["shoulders", "arms"]},
  {"id": "db-lateral-raise", "name": "Разведение гантелей в стороны", "equipment": ["dumbbells"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "per-dumbbell"}, "muscleGroups": ["shoulders"]},
  {"id": "db-curl", "name": "Сгибание рук с гантелями", "equipment": ["dumbbells"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "per-dumbbell"}, "muscleGroups": ["arms"]},
  {"id": "db-lunge", "name": "Выпады с гантелями", "equipment": ["dumbbells"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "per-dumbbell"}, "muscleGroups": ["legs", "glutes"]},
  {"id": "bulgarian-split-squat", "name": "Болгарский сплит-присед", "equipment": ["dumbbells", "bench"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "per-dumbbell"}, "muscleGroups": ["legs", "glutes"]},
  {"id": "hip-thrust", "name": "Ягодичный мост со штангой", "equipment": ["barbell", "bench"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "total"}, "muscleGroups": ["glutes"]},
  {"id": "lat-pulldown", "name": "Тяга верхнего блока", "equipment": ["cable"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "machine-stack"}, "muscleGroups": ["back", "arms"]},
  {"id": "cable-row", "name": "Тяга горизонтального блока", "equipment": ["cable"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "machine-stack"}, "muscleGroups": ["back", "arms"]},
  {"id": "face-pull", "name": "Тяга блока к лицу", "equipment": ["cable"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "machine-stack"}, "muscleGroups": ["shoulders", "back"]},
  {"id": "triceps-pushdown", "name": "Разгибание рук на блоке", "equipment": ["cable"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "machine-stack"}, "muscleGroups": ["arms"]},
  {"id": "cable-fly", "name": "Сведение рук на блоках", "equipment": ["cable"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "machine-stack"}, "muscleGroups": ["chest"]},
  {"id": "cable-curl", "name": "Сгибание рук на блоке", "equipment": ["cable"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "machine-stack"}, "muscleGroups": ["arms"]},
  {"id": "calf-raise", "name": "Подъём на носки с гантелями", "equipment": ["dumbbells"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "per-dumbbell"}, "muscleGroups": ["legs"]},
  {"id": "incline-db-press", "name": "Жим гантелей на наклонной скамье", "equipment": ["dumbbells", "bench"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "per-dumbbell"}, "muscleGroups": ["chest", "shoulders"]},
  {"id": "pull-up", "name": "Подтягивания", "equipment": ["bodyweight"], "measurement": "reps", "load": {"type": "bodyweight", "unit": "kg", "basis": "added-weight"}, "muscleGroups": ["back", "arms"]},
  {"id": "dip", "name": "Отжимания на брусьях", "equipment": ["bodyweight"], "measurement": "reps", "load": {"type": "bodyweight", "unit": "kg", "basis": "added-weight"}, "muscleGroups": ["chest", "arms"]},
  {"id": "bodyweight-squat", "name": "Приседания с собственным весом", "equipment": ["bodyweight"], "measurement": "reps", "load": {"type": "bodyweight", "unit": "kg", "basis": "added-weight"}, "muscleGroups": ["legs", "glutes"]},
  {"id": "crunch", "name": "Скручивания", "equipment": ["bodyweight"], "measurement": "reps", "load": {"type": "bodyweight", "unit": "kg", "basis": "added-weight"}, "muscleGroups": ["core"]},
  {"id": "leg-extension", "name": "Разгибание ног в тренажёре", "equipment": ["machine"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "machine-stack"}, "muscleGroups": ["legs"]},
  {"id": "leg-curl", "name": "Сгибание ног в тренажёре", "equipment": ["machine"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "machine-stack"}, "muscleGroups": ["legs"]},
  {"id": "chest-press-machine", "name": "Жим от груди в тренажёре", "equipment": ["machine"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "machine-stack"}, "muscleGroups": ["chest", "arms"]},
  {"id": "pec-deck", "name": "Сведение рук в тренажёре", "equipment": ["machine"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "machine-stack"}, "muscleGroups": ["chest"]},
  {"id": "reverse-pec-deck", "name": "Обратное разведение в тренажёре", "equipment": ["machine"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "machine-stack"}, "muscleGroups": ["shoulders", "back"]},
  {"id": "hack-squat", "name": "Гакк-присед", "equipment": ["machine"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "machine-stack"}, "muscleGroups": ["legs", "glutes"]},
  {"id": "smith-squat", "name": "Присед в машине Смита", "equipment": ["machine"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "machine-stack"}, "muscleGroups": ["legs", "glutes"]},
  {"id": "hip-abduction", "name": "Отведение бёдер в тренажёре", "equipment": ["machine"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "machine-stack"}, "muscleGroups": ["glutes"]},
  {"id": "hip-adduction", "name": "Приведение бёдер в тренажёре", "equipment": ["machine"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "machine-stack"}, "muscleGroups": ["legs"]},
  {"id": "seated-calf-raise", "name": "Подъём на носки сидя в тренажёре", "equipment": ["machine"], "measurement": "reps", "load": {"type": "external", "unit": "kg", "basis": "machine-stack"}, "muscleGroups": ["legs"]},
]);

export function findExercise(id: string, definition?: Exercise): Exercise | undefined {
  return exerciseCatalog.find((exercise) => exercise.id === id) ?? (definition?.id === id ? definition : undefined);
}

// Definitions travel with immutable versions/snapshots, never in a mutable global registry.
export function validExerciseDefinition(id: string, definition?: Exercise): boolean {
  const known = findExercise(id);
  if (!definition) return known !== undefined;
  if (definition.id !== id) return false;
  if (known) return JSON.stringify(known) === JSON.stringify(definition);
  return !exerciseCatalog.some((item) => exerciseNameKey(item.name) === exerciseNameKey(definition.name));
}

export function mergeExerciseCatalog(definitions: readonly Exercise[]): readonly Exercise[] {
  const byId = new Map(exerciseCatalog.map((item) => [item.id, item]));
  for (const definition of definitions) {
    const previous = byId.get(definition.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(definition)) throw new Error(`Конфликт определения упражнения: ${definition.id}`);
    byId.set(definition.id, definition);
  }
  return exerciseCatalogSchema.parse([...byId.values()]);
}

// Catalog metadata narrows a manual choice; it is not a safety assessment.
// Assistance and added/external weight must never be treated as equivalent.
export function replacementOptions(id: string): readonly Exercise[] {
  const original = findExercise(id);
  if (!original) return [];
  return exerciseCatalog.filter((item) => item.id !== id && item.measurement === original.measurement
    && item.muscleGroups[0] === original.muscleGroups[0]
    && (item.load.type === "assistance") === (original.load.type === "assistance"));
}
