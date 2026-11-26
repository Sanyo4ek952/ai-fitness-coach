import "fake-indexeddb/auto";
import { Theme } from "@radix-ui/themes";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTrainingStorage, profileSchema, StorageConflictError } from "../src/entities/training";
import { ProfileEditor, ProfileOnboarding } from "../src/features/edit-profile";
import { Accordion } from "../src/shared/ui";
import { mergeProfile, profileFromForm, saveProfileDraft } from "../src/features/edit-profile/model";

function form() {
  const data = new FormData();
  data.set("goal", "Синтетическая цель"); data.set("experience", "Не знаю"); data.set("sessionsPerWeek", "Не знаю");
  return data;
}
const base = profileFromForm(form());

describe("M1-03 профиль", () => {
  it("первый вход не показывает тренировку до чтения сохранённого профиля и не пишет при SSR", () => {
    const created = vi.fn();
    const html = renderToStaticMarkup(<Theme><ProfileOnboarding><p>Сохранённая тренировка</p></ProfileOnboarding><ProfileEditor onCreated={created} /></Theme>);
    expect(html).toContain("Проверяем сохранённый профиль");
    expect(html).not.toContain("Сохранённая тренировка");
    expect(created).not.toHaveBeenCalled();
  });
  it("раскрытые дополнительные поля доступны FormData и после сворачивания", () => {
    const open = renderToStaticMarkup(<Accordion title="Дополнительные сведения" defaultOpen><input name="ageYears" /></Accordion>);
    const closed = renderToStaticMarkup(<Accordion title="Дополнительные сведения"><input name="ageYears" /></Accordion>);
    expect(open).toContain('aria-expanded="true"');
    expect(closed).toContain('aria-expanded="false"');
    expect(open).toContain('name="ageYears"'); expect(closed).toContain('name="ageYears"');
  });
  it("SSR показывает загрузку, не открывая IndexedDB", () => {
    const html = renderToStaticMarkup(<Theme><ProfileEditor /></Theme>);
    expect(html).toContain("Загружаем профиль"); expect(html).not.toContain('<form');
  });
  it("без optional: unknown/null, не выдумывает данные", () => {
    expect(base).toMatchObject({ revision: 1, experience: "unknown", sessionsPerWeek: null, equipment: ["unknown"], details: null, nutritionOptIn: false });
  });
  it("выбранные значения, несколько оборудований и добровольные поля", () => {
    const data = form(); data.set("experience", "Тренируюсь регулярно"); data.set("sessionsPerWeek", "3");
    data.append("equipment", "dumbbells"); data.append("equipment", "bench");
    data.set("weightKg", "72,5"); data.set("nutritionOptIn", "on");
    expect(profileFromForm(data, base)).toMatchObject({ id: base.id, revision: 2, experience: "intermediate", sessionsPerWeek: 3, equipment: ["dumbbells", "bench"], nutritionOptIn: true, details: { weightKg: 72.5 } });
  });
  it.each([["goal", " "], ["experience", "чужое"], ["sessionsPerWeek", "8"], ["ageYears", "17"], ["heightCm", "NaN"], ["weightKg", "0"], ["sessionMinutes", "2.5"], ["constraints", "x".repeat(1001)]])("не пишет невалидное поле %s", (key, value) => {
    const data = form(); data.set(key, value); expect(() => profileFromForm(data)).toThrow();
  });
  it("не принимает неизвестный equipment или unknown вместе с известным", () => {
    const data = form(); data.set("equipment", "other"); expect(() => profileFromForm(data)).toThrow();
    data.set("equipment", "unknown"); data.append("equipment", "bench"); expect(() => profileFromForm(data)).toThrow();
  });
  it("пустые optional удаляют введённые ранее значения", () => {
    const data = form(); data.set("ageYears", "30");
    expect(profileFromForm(form(), profileFromForm(data)).details).toBeNull();
  });
  it("объединяет независимые изменения без перезаписи чужих", () => {
    const draft = profileSchema.parse({ ...base, revision: 2, goal: "Новая синтетическая цель" });
    const latest = profileSchema.parse({ ...base, revision: 2, sessionsPerWeek: 4 });
    const merged = mergeProfile(base, draft, latest);
    expect(merged.conflicts).toEqual([]);
    expect(merged.profile).toMatchObject({ revision: 3, goal: draft.goal, sessionsPerWeek: 4 });
  });
  it("выявляет конфликт и позволяет явно выбрать обе стороны", () => {
    const draft = profileSchema.parse({ ...base, revision: 2, goal: "Черновик" });
    const latest = profileSchema.parse({ ...base, revision: 2, goal: "Другая вкладка" });
    expect(mergeProfile(base, draft, latest).conflicts).toEqual(["goal"]);
    expect(mergeProfile(base, draft, latest).profile.goal).toBe("Черновик");
    expect(mergeProfile(base, draft, latest, ["goal"]).profile.goal).toBe("Другая вкладка");
    expect(draft.goal).toBe("Черновик");
  });
  it("два первых профиля разрешаются в один UUID, без потери ревизии", () => {
    const other = profileFromForm(form());
    expect(mergeProfile(undefined, base, other).profile).toMatchObject({ id: other.id, revision: 2 });
  });
  it.each(["open", "save", "read"] as const)("ошибка %s не возвращает успех и не меняет черновик", async (step) => {
    const failure = new Error("Синтетический отказ");
    const storage = {
      open: vi.fn(async () => { if (step === "open") throw failure; }),
      profiles: {
        save: vi.fn(async () => { if (step === "read") throw new StorageConflictError("stale"); throw failure; }),
        current: vi.fn(async () => { throw failure; }), get: vi.fn(),
      },
    };
    await expect(saveProfileDraft(storage, base)).rejects.toBe(failure);
    expect(base.revision).toBe(1);
    if (step === "open") expect(storage.profiles.save).not.toHaveBeenCalled();
  });
  it("не сообщает успех до commit", async () => {
    let finish: ((profile: typeof base) => void) | undefined;
    const pending = new Promise<typeof base>((resolve) => { finish = resolve; });
    const storage = { open: async () => {}, profiles: { save: () => pending, current: async () => undefined, get: async () => undefined } };
    let done = false;
    const result = saveProfileDraft(storage, base).then((value) => { done = true; return value; });
    await Promise.resolve(); expect(done).toBe(false);
    finish?.(base); expect(await result).toEqual({ status: "saved", profile: base });
  });
  it("форма → commit → повторное открытие → конфликт → объединение, старые ревизии неизменны", async () => {
    const name = `m1-03-test-${crypto.randomUUID()}`;
    const a = createTrainingStorage(name); const b = createTrainingStorage(name);
    try {
      expect(await saveProfileDraft(a, base)).toEqual({ status: "saved", profile: base });
      const snapshot = { id: crypto.randomUUID(), title: "Синтетический шаблон", exercises: [{ id: crypto.randomUUID(), exerciseId: "goblet-squat", sets: 1, target: { type: "reps", min: 8, max: 10, weightKg: null }, restSec: 90 }] };
      const program = await a.programs.append({ id: crypto.randomUUID(), revision: 1, previousId: null, profileRevision: 1, createdAt: "2026-11-24T07:00:00Z", title: "Синтетический план", goalInterpretation: "Тест", workouts: [snapshot], reviewAfterSessions: 2 });
      const session = { id: crypto.randomUUID(), programVersionId: program.id, templateId: snapshot.id, plannedSnapshot: snapshot, startedAt: "2026-11-24T07:00:00Z", endedAt: null, status: "active", sets: [] };
      await a.sessions.save(session, 0);
      a.close(); await b.open(); expect(await b.profiles.current()).toEqual(base);
      const data = form(); data.set("sessionsPerWeek", "4");
      const concurrent = profileFromForm(data, base); await saveProfileDraft(b, concurrent);
      const mine = form(); mine.set("goal", "Синтетическая правка"); const draft = profileFromForm(mine, base);
      const conflict = await saveProfileDraft(a, draft);
      expect(conflict.status).toBe("conflict");
      if (conflict.status !== "conflict") throw new Error("Ожидался конфликт");
      const merged = mergeProfile(base, draft, conflict.latest);
      expect((await saveProfileDraft(a, merged.profile)).status).toBe("saved");
      expect(await a.profiles.current()).toMatchObject({ revision: 3, goal: "Синтетическая правка", sessionsPerWeek: 4 });
      expect(await a.profiles.get(1)).toEqual(base); expect(await a.profiles.get(2)).toEqual(concurrent);
      expect(await a.programs.list()).toEqual([program]); expect(await a.sessions.list()).toEqual([session]);
      expect(await a.sessions.historyRevision()).toBe(1);
    } finally {
      a.close(); b.close();
      await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    }
  });
});
