import { profileSchema, StorageConflictError, type Profile, type TrainingStorage } from "@/entities/training";

export const experienceOptions = { unknown: "Не знаю", beginner: "Начинаю", intermediate: "Тренируюсь регулярно", advanced: "Опытный" } as const;
export const equipmentOptions = { dumbbells: "Гантели", bench: "Скамья", barbell: "Штанга", rack: "Стойка", cable: "Блочные тренажёры", "leg-press": "Жим ногами", "assisted-pull-up": "Гравитрон", machine: "Другие силовые тренажёры", treadmill: "Беговая дорожка", bodyweight: "Собственный вес" } as const;
export const detailFields = [
  ["ageYears", "Возраст, лет", 18, 120], ["heightCm", "Рост, см", 50, 250],
  ["weightKg", "Вес, кг", 0, 500], ["sessionMinutes", "Длительность занятия, минут", 1, 480],
] as const;
export const detailTexts = [["availableWeights", "Доступные веса", 500], ["constraints", "Ограничения", 1000], ["sleep", "Сон", 500], ["nutrition", "Питание", 500]] as const;

export function profileFromForm(data: FormData, previous?: Profile): Profile {
  const text = (name: string) => String(data.get(name) ?? "").trim();
  const number = (name: string) => text(name) === "" ? null : Number(text(name).replace(",", "."));
  const details = Object.fromEntries([
    ...detailFields.map(([key]) => [key, number(key)]),
    ...detailTexts.map(([key]) => [key, text(key) || null]),
  ]);
  const equipment = data.getAll("equipment");
  return profileSchema.parse({
    id: previous?.id ?? crypto.randomUUID(), revision: (previous?.revision ?? 0) + 1,
    goal: text("goal"), experience: Object.entries(experienceOptions).find(([, label]) => label === text("experience"))?.[0], sessionsPerWeek: text("sessionsPerWeek") === "Не знаю" ? null : number("sessionsPerWeek"),
    equipment: equipment.length ? equipment : ["unknown"],
    nutritionOptIn: data.get("nutritionOptIn") === "on",
    details: Object.values(details).every((value) => value === null) ? null : details,
  });
}

export const editableFields = ["goal", "experience", "sessionsPerWeek", "equipment", "nutritionOptIn", "details"] as const;
export type EditableField = typeof editableFields[number];
export const fieldLabels: Record<EditableField, string> = { goal: "Цель", experience: "Опыт", sessionsPerWeek: "Занятий в неделю", equipment: "Оборудование", nutritionOptIn: "Советы по питанию", details: "Дополнительные сведения" };
const equal = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Three-way merge keeps changes to independent fields. Conflicting fields require
// an explicit choice; neither draft nor saved revision is discarded on failure.
export function mergeProfile(base: Profile | undefined, draft: Profile, latest: Profile, useLatest: readonly EditableField[] = []) {
  const conflicts = editableFields.filter((key) => !equal(draft[key], base?.[key]) && !equal(latest[key], base?.[key]) && !equal(draft[key], latest[key]));
  const fields = Object.fromEntries(editableFields.map((key) => [key,
    useLatest.includes(key) || equal(draft[key], base?.[key]) ? latest[key] : draft[key],
  ]));
  return { conflicts, profile: profileSchema.parse({ ...fields, id: latest.id, revision: latest.revision + 1 }) };
}

export async function saveProfileDraft(storage: Pick<TrainingStorage, "open" | "profiles">, draft: Profile) {
  await storage.open();
  try { return { status: "saved", profile: await storage.profiles.save(draft) } as const; }
  catch (cause) {
    if (!(cause instanceof StorageConflictError)) throw cause;
    const latest = await storage.profiles.current();
    if (!latest) throw cause;
    return { status: "conflict", latest } as const;
  }
}
