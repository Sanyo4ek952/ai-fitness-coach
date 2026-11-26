import "fake-indexeddb/auto";
import { Dexie } from "dexie";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTrainingStorage, profileSchema, programDraftSchema, type CoachRequest, type TrainingStorage } from "@/entities/training";
import { TrainingDatabase, storageSchemaV1 } from "@/shared/infrastructure/db";
import { CoachExchange } from "@/features/coach-exchange";
import { CoachPreview, ProgramPlan } from "@/features/coach-exchange/coach-preview";
import { copyRequest, downloadRequest, MAX_RESPONSE_BYTES, readCoachFile, serializeRequest } from "@/features/coach-exchange/model";
import example from "../examples/coach-response.example.json";

const time = "2026-11-24T12:00:00.000Z";
const profile = profileSchema.parse({ id: crypto.randomUUID(), revision: 1, goal: "Синтетическая цель", experience: "unknown", sessionsPerWeek: null, equipment: ["dumbbells", "bench"], nutritionOptIn: false });
function answer(request: CoachRequest) { return { ...example, requestId: request.requestId, context: request.context }; }
async function withDb(action: (storage: TrainingStorage, raw: TrainingDatabase, name: string) => Promise<void>) {
  const name = `m2-02-test-${crypto.randomUUID()}`;
  const storage = createTrainingStorage(name); const raw = new TrainingDatabase(name);
  try { await storage.open(); await raw.open(); await storage.profiles.save(profile); await action(storage, raw, name); }
  finally { storage.close(); raw.close(); await Dexie.delete(name); }
}
async function request(storage: TrainingStorage) { return storage.coach.createInitialRequest(crypto.randomUUID(), time); }
async function unchanged(storage: TrainingStorage) {
  expect(await storage.programs.list()).toEqual([]); expect(await storage.sessions.list()).toEqual([]);
  expect(await storage.sessions.historyRevision()).toBe(0); expect(await storage.profiles.current()).toEqual(profile);
}

describe("M2-02 локальный AI-обмен", () => {
  it("unknown оборудования и отсутствие optional не блокируют экспорт", async () => withDb(async (storage) => {
    await storage.profiles.save({ ...profile, revision: 2, equipment: ["unknown"] });
    const saved = await request(storage); expect(saved.profile.equipment).toEqual(["unknown"]); expect(saved.profile.details).toBeUndefined();
  }));
  it("ошибка скачивания передаётся вызывающему коду, DOM и URL освобождаются", async () => withDb(async (storage) => {
    const saved = await request(storage); const remove = vi.fn(); const revoke = vi.fn();
    vi.useFakeTimers();
    vi.stubGlobal("document", { body: { append: vi.fn() }, createElement: () => ({ remove, click: () => { throw new Error("Download denied"); } }) });
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const cleanup = vi.spyOn(URL, "revokeObjectURL").mockImplementation(revoke);
    try {
      expect(() => downloadRequest(saved)).toThrow("Download denied"); expect(remove).toHaveBeenCalledOnce();
      expect(revoke).not.toHaveBeenCalled(); vi.runAllTimers(); expect(revoke).toHaveBeenCalledWith("blob:test");
    } finally { create.mockRestore(); cleanup.mockRestore(); vi.unstubAllGlobals(); vi.useRealTimers(); }
  }));
  it("SSR без открытия базы и без экспорта", () => {
    const html = renderToStaticMarkup(<CoachExchange />);
    expect(html).toContain("Загружаем локальный обмен"); expect(html).not.toContain(profile.goal);
    expect(html).not.toContain("Скачать запрос для ИИ");
    expect(html).not.toContain("Скопировать запрос с инструкцией");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Отправить<\/button>/);
  });
  it("полная анкета сохраняется в первом запросе и после повторного открытия", async () => withDb(async (storage) => {
    const details = { ageYears: 35, heightCm: 178, weightKg: 76.5, sessionMinutes: 55,
      availableWeights: "Гантели 2–20 кг, жим 12 кг × 10, перерыв 3 месяца", constraints: "Неудобны выпады", sleep: "7 часов, сменный график", nutrition: "Без молока" };
    await storage.profiles.save({ ...profile, revision: 2, experience: "intermediate", sessionsPerWeek: 3, details, nutritionOptIn: true });
    storage.close(); await storage.open();
    const saved = await request(storage);
    expect(saved.context.profileRevision).toBe(2);
    expect(saved.profile).toMatchObject({ experience: "intermediate", sessionsPerWeek: 3, details, nutritionOptIn: true });
    expect(JSON.parse(serializeRequest(saved)).profile.details).toEqual(details);
  }));
  it("сохраняет DTO без внутренних ключей/фото, полную инструкцию и optional unknown", async () => withDb(async (storage, raw, name) => {
    const saved = await request(storage);
    expect(saved.profile).not.toHaveProperty("id"); expect(saved.profile).not.toHaveProperty("revision");
    expect(saved.profile.details).toBeUndefined(); expect(saved.profile.sessionsPerWeek).toBeNull();
    expect(saved.instructions.length).toBeGreaterThan(1000); expect(saved.responseSchema).toHaveProperty("$schema");
    expect(serializeRequest(saved)).not.toMatch(/"(?:photos|EXIF|contacts)"/);
    storage.close(); await storage.open(); expect(await storage.coach.getRequest(saved.requestId)).toEqual(saved);
    expect((await storage.coach.latestRequest())?.requestId).toBe(saved.requestId);
    expect(raw.verno).toBe(4); expect(name).toContain("m2-02-test"); await unchanged(storage);
  }));
  it("импорт → сохранённый preview → reload; повтор не создаёт версии или историю", async () => withDb(async (storage, raw) => {
    const saved = await request(storage); const response = await storage.coach.importResponse(answer(saved));
    storage.close(); await storage.open(); expect(await storage.coach.preview(saved.requestId)).toEqual(response);
    await storage.coach.importResponse(answer(saved)); expect(await raw.coachResponses.count()).toBe(1); await unchanged(storage);
    const html = renderToStaticMarkup(<CoachPreview response={response} />);
    expect(html).toContain("Не применено"); expect(html).toContain("вес подобрать"); expect(html).toContain("Интерпретация цели");
    expect(html).toContain('aria-expanded="true"'); expect(html).not.toContain("Применить весь пакет");
  }));
  it.each([1, 5, 14])("показывает все %i дней, первый раскрыт, параметры сохранены", (count) => {
    const source = example.proposedProgram.workouts[0];
    const program = programDraftSchema.parse({ ...example.proposedProgram, workouts: Array.from({ length: count }, (_, i) => ({ ...source, title: `День ${i + 1}` })) });
    const html = renderToStaticMarkup(<ProgramPlan program={program} />);
    expect(html.match(/class="accordion coach-day"/g)).toHaveLength(count);
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(html).toContain(`${count}. День ${count}`);
    expect(html).toContain("Отдых"); expect(html).toContain("RIR"); expect(html).not.toContain("<img");
  });
  it.each(["needs_input", "unsupported"] as const)("принимает решение %s без программы", async (decision) => withDb(async (storage) => {
    const saved = await request(storage);
    const { proposedProgram: _program, ...base } = answer(saved);
    expect(_program.workouts.length).toBeGreaterThan(0);
    const response = await storage.coach.importResponse({ ...base, decision, ...(decision === "needs_input" ? { question: "Какое оборудование доступно?" } : {}) });
    expect(response.decision).toBe(decision); await unchanged(storage);
  }));
  it.each(["id", "revision", "equipment", "nutrition", "version", "extra"])("отклоняет %s без частичной записи", async (field) => withDb(async (storage, raw) => {
    const saved = await request(storage); const base = answer(saved);
    const input = field === "id" ? { ...base, requestId: crypto.randomUUID() } : field === "revision" ? { ...base, context: { ...base.context, historyRevision: 1 } }
      : field === "equipment" ? { ...base, proposedProgram: { ...base.proposedProgram, workouts: [{ title: "А", exercises: [{ ...base.proposedProgram.workouts[0].exercises[0], exerciseId: "leg-press" }] }] } }
        : field === "nutrition" ? { ...base, nutritionTips: ["Совет"] } : field === "version" ? { ...base, schemaVersion: 2 } : { ...base, html: "<script>throw 1</script>" };
    await expect(storage.coach.importResponse(input)).rejects.toThrow(); expect(await raw.coachResponses.count()).toBe(0); await unchanged(storage);
  }));
  it("профиль изменился в другой вкладке — импорт и повторное открытие preview запрещены", async () => withDb(async (storage, _raw, name) => {
    const saved = await request(storage); await storage.coach.importResponse(answer(saved));
    const other = createTrainingStorage(name);
    try { await other.open(); await other.profiles.save({ ...profile, revision: 2, goal: "Изменённая цель" }); }
    finally { other.close(); }
    await expect(storage.coach.importResponse(answer(saved))).rejects.toThrow("Профиль изменился");
    await expect(storage.coach.preview(saved.requestId)).rejects.toThrow("Профиль изменился");
    expect(await storage.programs.list()).toEqual([]);
  }));
  it.each(["history", "active", "program"])("изменение %s блокирует старый ответ", async (change) => withDb(async (storage, raw) => {
    const saved = await request(storage);
    if (change === "history") await raw.counters.put({ key: "historyRevision", value: 1 });
    if (change === "active") await raw.sessions.add({ id: crypto.randomUUID(), status: "active", payload: {} });
    if (change === "program") await raw.programVersions.add({ id: crypto.randomUUID(), revision: 1, payload: {} });
    await expect(storage.coach.importResponse(answer(saved))).rejects.toThrow(); expect(await raw.coachResponses.count()).toBe(0);
  }));
  it("две вкладки импортируют один запрос без дублей и изменения истории", async () => withDb(async (storage, raw, name) => {
    const saved = await request(storage); const other = createTrainingStorage(name);
    try { await other.open(); await Promise.all([storage.coach.importResponse(answer(saved)), other.coach.importResponse(answer(saved))]); }
    finally { other.close(); }
    expect(await raw.coachResponses.count()).toBe(1); await unchanged(storage);
  }));
  it("отказ записи не заменяет существующий preview и не даёт ложный успех", async () => withDb(async (storage) => {
    const saved = await request(storage); const before = await storage.coach.importResponse(answer(saved));
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === "coachResponses") throw new DOMException("Synthetic quota", "QuotaExceededError");
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
    try { await expect(storage.coach.importResponse({ ...answer(saved), summary: "Другой ответ" })).rejects.toThrow(); }
    finally { IDBObjectStore.prototype.put = original; }
    expect(await storage.coach.preview(saved.requestId)).toEqual(before); await unchanged(storage);
  }));
  it("отказ сохранения request запрещает экспорт; закрытая БД не открывается сама", async () => withDb(async (storage, raw) => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
      if (this.name === "coachRequests") throw new DOMException("Synthetic quota", "QuotaExceededError");
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
    try { await expect(request(storage)).rejects.toThrow(); } finally { IDBObjectStore.prototype.add = original; }
    expect(await raw.coachRequests.count()).toBe(0); storage.close(); await expect(request(storage)).rejects.toThrow();
  }));
  it("миграция реальной v1 сохраняет профиль и историю и добавляет пустые AI-таблицы", async () => {
    const name = `m2-02-test-${crypto.randomUUID()}`; const old = new Dexie(name); old.version(1).stores(storageSchemaV1);
    const current = createTrainingStorage(name);
    try {
      await old.open(); await old.table("profileRevisions").add({ revision: 1, payload: profile });
      await old.table("counters").add({ key: "historyRevision", value: 7 }); old.close();
      await current.open(); expect(await current.profiles.current()).toEqual(profile); expect(await current.sessions.historyRevision()).toBe(7);
      expect(await current.coach.latestRequest()).toBeUndefined();
    } finally { old.close(); current.close(); await Dexie.delete(name); }
  });
  it("UTF-8, BOM и JSON без доверия MIME; размер проверяется до чтения", async () => {
    const storageResponse = { ...example };
    expect((await readCoachFile(new Blob([JSON.stringify(storageResponse)]))).kind).toBe("coach_response");
    expect((await readCoachFile(new Blob(["\uFEFF" + JSON.stringify(storageResponse)]))).kind).toBe("coach_response");
    const arrayBuffer = vi.fn(); await expect(readCoachFile({ size: MAX_RESPONSE_BYTES + 1, arrayBuffer })).rejects.toThrow("2 MiB"); expect(arrayBuffer).not.toHaveBeenCalled();
    await expect(readCoachFile(new Blob([new Uint8Array([0xff])]))).rejects.toThrow("UTF-8");
    await expect(readCoachFile(new Blob(["```json\n{}\n```"]))).rejects.toThrow("JSON");
  });
  it("опасные ключи запрещены, HTML/ссылки/команды остаются текстом", async () => withDb(async (storage) => {
    const saved = await request(storage);
    const input = { ...answer(saved), summary: '<img src=x onerror="alert(1)"> https://example.org cmd /c erase' };
    const response = await storage.coach.importResponse(input);
    const html = renderToStaticMarkup(<CoachPreview response={response} />);
    expect(html).toContain("&lt;img"); expect(html).not.toContain("<img"); expect(html).not.toContain("href=");
    await expect(readCoachFile(new Blob([JSON.stringify(input).replace('"summary":', '"__proto__":{},"summary":')]))).rejects.toThrow();
  }));
  it("копирование ждёт Promise и передаёт ошибку, без преждевременного успеха", async () => withDb(async (storage) => {
    const saved = await request(storage); let finish: (() => void) | undefined; let done = false;
    const pending = copyRequest(saved, () => new Promise<void>((resolve) => { finish = resolve; })).then(() => { done = true; });
    await Promise.resolve(); expect(done).toBe(false); finish?.(); await pending; expect(done).toBe(true);
    await expect(copyRequest(saved, async () => { throw new Error("Denied"); })).rejects.toThrow("Denied");
  }));
});
