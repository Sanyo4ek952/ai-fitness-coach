import "fake-indexeddb/auto";
import { Dexie } from "dexie";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { coachRequestSchema, createProgramVersionFromDraft, createTrainingStorage, profileSchema, type CoachRequest, type TrainingStorage } from "@/entities/training";
import { TrainingDatabase, storageSchemaV1, storageSchemaV2 } from "@/shared/infrastructure/db";
import { NextWorkout } from "@/features/next-workout";
import { ProgramOverview } from "@/features/next-workout/next-workout";
import example from "../examples/coach-response.example.json";
import requestExample from "../examples/coach-request.example.json";

const time = "2026-11-24T12:00:00.000Z";
const later = "2026-11-24T12:01:00.000Z";
const profile = profileSchema.parse({ id: crypto.randomUUID(), revision: 1, goal: "Синтетическая цель", experience: "unknown", sessionsPerWeek: null, equipment: ["dumbbells", "bench"], nutritionOptIn: true });
const answer = (request: CoachRequest) => ({ ...example, requestId: request.requestId, context: request.context, nutritionTips: ["Синтетический совет"] });
async function withDb(action: (s: TrainingStorage, raw: TrainingDatabase, name: string) => Promise<void>) {
  const name = `m2-03-test-${crypto.randomUUID()}`;
  const s = createTrainingStorage(name); const raw = new TrainingDatabase(name);
  try { await s.open(); await raw.open(); await s.profiles.save(profile); await action(s, raw, name); }
  finally { s.close(); raw.close(); await Dexie.delete(name); }
}
async function preview(s: TrainingStorage) {
  const request = await s.coach.createInitialRequest(crypto.randomUUID(), time);
  const response = await s.coach.importResponse(answer(request));
  return { request, response };
}
async function noAcceptance(s: TrainingStorage, raw: TrainingDatabase) {
  expect(await s.programs.list()).toEqual([]); expect(await s.programs.active()).toBeUndefined();
  expect(await raw.coachAcceptances.count()).toBe(0); expect(await s.sessions.list()).toEqual([]);
  expect(await s.sessions.historyRevision()).toBe(0);
}
async function review(s: TrainingStorage, raw: TrainingDatabase, original: CoachRequest) {
  const active = await s.programs.active(); if (!active) throw new Error("Нет программы");
  const request = coachRequestSchema.parse({ ...original, requestId: crypto.randomUUID(), createdAt: later, mode: "review", program: active.program,
    context: { ...original.context, programVersionId: active.program.id, historyRevision: await s.sessions.historyRevision() }, reasonCodes: ["manual"] });
  // Review export UI is M4; fixtures exercise the acceptance boundary only.
  await raw.coachRequests.add({ requestId: request.requestId, payload: structuredClone(request), baselineKey: (await s.analysis.overview(later))?.baselineKey });
  return request;
}

describe("M2-03 атомарное принятие", () => {
  it("SSR не открывает БД и не выдаёт демопрограмму за сохранённую", () => {
    const html = renderToStaticMarkup(<NextWorkout />);
    expect(html).toContain("Загружаем последовательность"); expect(html).not.toContain("Жим ногами");
  });
  it("preview → подтверждение всего пакета → reload → первый шаблон; история неизменна", async () => withDb(async (s, raw) => {
    const { request, response } = await preview(s); await noAcceptance(s, raw);
    const accepted = await s.coach.accept(response, later, true);
    expect(accepted.response).toEqual(response); expect(accepted.status).toBe("accepted");
    s.close(); await s.open();
    expect(await s.coach.acceptance(request.requestId)).toEqual(accepted);
    const active = await s.programs.active(); if (!active) throw new Error("Нет программы");
    expect(active.workout.title).toBe(example.proposedProgram.workouts[0].title);
    expect(active.cursor.nextWorkoutIndex).toBe(0); expect(active.program.id).toBe(accepted.programVersionId);
    expect(active.program.workouts.map((w) => w.exercises.map(({ id, ...row }) => { expect(id).toMatch(/^[\da-f-]{36}$/); return row; })))
      .toEqual(example.proposedProgram.workouts.map((w) => w.exercises));
    expect(await s.profiles.current()).toEqual(profile); expect(await s.sessions.list()).toEqual([]); expect(await s.sessions.historyRevision()).toBe(0);
    expect(await s.programs.list()).toHaveLength(1);
    const html = renderToStaticMarkup(<ProgramOverview active={active} />);
    expect(html).toContain("Вес подобрать"); expect(html).toContain("Даты не обязательны"); expect(html).toContain("Порядок занятий"); expect(html).not.toContain("Начать тренировку");
    await expect(s.coach.accept(response, later, true)).rejects.toThrow();
    await expect(s.coach.importResponse(response)).rejects.toThrow();
    await expect(s.coach.reject(response)).rejects.toThrow();
    expect(await s.programs.list()).toHaveLength(1);
  }));
  it("отказ сохраняется после reload; тот же запрос можно импортировать снова", async () => withDb(async (s, raw) => {
    const { request, response } = await preview(s); await s.coach.reject(response);
    s.close(); await s.open(); expect(await s.coach.preview(request.requestId)).toBeUndefined();
    await expect(s.coach.accept(response, later, true)).rejects.toThrow("Предпросмотр не найден"); await noAcceptance(s, raw);
    await s.coach.importResponse(response); await s.coach.accept(response, later, true); expect(await s.programs.list()).toHaveLength(1);
  }));
  it.each([false, undefined, "true"])("без явного подтверждения оценки %s запись запрещена", async (ack) => withDb(async (s, raw) => {
    const { response } = await preview(s); await expect(s.coach.accept(response, later, ack)).rejects.toThrow(); await noAcceptance(s, raw);
  }));
  it.each(["needs_input", "unsupported"] as const)("%s не создаёт программу", async (decision) => withDb(async (s, raw) => {
    const { request } = await preview(s); const { proposedProgram, ...base } = answer(request); expect(proposedProgram).toBeDefined();
    const response = await s.coach.importResponse({ ...base, decision, ...(decision === "needs_input" ? { question: "Уточните оборудование" } : {}) });
    await expect(s.coach.accept(response, later, true)).rejects.toThrow("нельзя применить"); await noAcceptance(s, raw);
  }));
  it("замена preview другой вкладкой блокирует принятие и отказ старого снимка", async () => withDb(async (s, raw, name) => {
    const { response } = await preview(s); const other = createTrainingStorage(name);
    try { await other.open(); await other.coach.importResponse({ ...response, summary: "Новый пакет" }); }
    finally { other.close(); }
    await expect(s.coach.accept(response, later, true)).rejects.toThrow("Предпросмотр изменился");
    await expect(s.coach.reject(response)).rejects.toThrow("Предпросмотр изменился"); await noAcceptance(s, raw);
  }));
  it.each(["profile", "history", "active", "program"])("изменение %s после preview блокирует commit", async (change) => withDb(async (s, raw) => {
    const { response } = await preview(s);
    if (change === "profile") await s.profiles.save({ ...profile, revision: 2, goal: "Другая цель" });
    if (change === "history") await raw.counters.put({ key: "historyRevision", value: 1 });
    if (change === "active") await raw.sessions.add({ id: crypto.randomUUID(), status: "active", payload: {} });
    if (change === "program") await raw.programVersions.add({ id: crypto.randomUUID(), revision: 1, payload: {} });
    await expect(s.coach.accept(response, later, true)).rejects.toThrow(); expect(await raw.coachAcceptances.count()).toBe(0); expect(await raw.programState.count()).toBe(0);
  }));
  it.each([false, true])("два подключения принимают один/разные запросы (разные=%s): только один commit", async (different) => withDb(async (s, raw, name) => {
    const first = await preview(s); const second = different ? await preview(s) : first;
    const other = createTrainingStorage(name);
    try {
      await other.open(); const results = await Promise.allSettled([s.coach.accept(first.response, later, true), other.coach.accept(second.response, later, true)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    } finally { other.close(); }
    expect(await s.programs.list()).toHaveLength(1); expect(await raw.programState.count()).toBe(2); expect(await raw.coachAcceptances.count()).toBe(1); expect(await s.sessions.historyRevision()).toBe(0);
  }));
  it.each(["programVersions", "programState", "coachAcceptances"])("сбой %s откатывает все записи и позволяет повтор", async (table) => withDb(async (s, raw) => {
    const { request, response } = await preview(s);
    const originalAdd = IDBObjectStore.prototype.add; const originalPut = IDBObjectStore.prototype.put;
    function fail(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === table) throw new DOMException("Synthetic quota", "QuotaExceededError");
      return key === undefined ? originalAdd.call(this, value) : originalAdd.call(this, value, key);
    }
    IDBObjectStore.prototype.add = fail;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === table) throw new DOMException("Synthetic quota", "QuotaExceededError");
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
    try { await expect(s.coach.accept(response, later, true)).rejects.toThrow(); }
    finally { IDBObjectStore.prototype.add = originalAdd; IDBObjectStore.prototype.put = originalPut; }
    await noAcceptance(s, raw); expect(await s.coach.preview(request.requestId)).toEqual(response);
    await s.coach.accept(response, later, true); expect(await s.programs.list()).toHaveLength(1);
  }));
  it("keep подтверждает анализ без новой версии и без сброса курсора", async () => withDb(async (s, raw) => {
    const { request, response } = await preview(s); await s.coach.accept(response, later, true);
    const before = await s.programs.active(); if (!before) throw new Error("Нет программы");
    const cursor = { ...before.cursor, nextWorkoutIndex: 1 };
    await raw.programState.put({ key: "activeProgram", payload: cursor });
    const unchangedActive = await s.programs.active();
    const reviewRequest = await review(s, raw, request);
    const { proposedProgram, ...base } = answer(reviewRequest); expect(proposedProgram).toBeDefined();
    const keep = await s.coach.importResponse({ ...base, decision: "keep" });
    await s.coach.accept(keep, later, true);
    expect(await s.programs.active()).toEqual(unchangedActive); expect(await s.programs.list()).toHaveLength(1); expect(await s.sessions.historyRevision()).toBe(0);
  }));
  it("новая версия не меняет прежние снимки/факты; новая последовательность с первого шаблона", async () => withDb(async (s, raw) => {
    const { request, response } = await preview(s); await s.coach.accept(response, later, true);
    const before = await s.programs.active(); if (!before) throw new Error("Нет программы");
    const sessionId = crypto.randomUUID();
    const row = before.workout.exercises[0];
    const session = { id: sessionId, programVersionId: before.program.id, templateId: before.workout.id, plannedSnapshot: before.workout, startedAt: later, endedAt: later, status: "abandoned", sets: [{ id: crypto.randomUUID(), sessionId, plannedExerciseId: row.id, originalExerciseId: row.exerciseId, actualExerciseId: row.exerciseId, index: 1, status: "done", actual: { type: "reps", reps: 7, weightKg: null }, timestamp: later }] };
    await s.sessions.save(session, 0);
    const reviewRequest = await review(s, raw, request);
    const next = await s.coach.importResponse({ ...answer(reviewRequest), proposedProgram: { ...example.proposedProgram, title: "Другой план" } });
    await s.coach.accept(next, later, true);
    expect(await s.programs.get(before.program.id)).toEqual(before.program); expect(await s.sessions.get(session.id)).toEqual(session); expect(await s.sessions.historyRevision()).toBe(1);
    const after = await s.programs.active(); expect(after?.cursor.nextWorkoutIndex).toBe(0); expect(after?.program.previousId).toBe(before.program.id); expect(after?.program.revision).toBe(2);
  }));
  it("upgrade v2→v4 сохраняет все старые таблицы; не активирует низкоуровневую версию", async () => {
    const name = `m2-03-test-${crypto.randomUUID()}`; const old = new Dexie(name); old.version(1).stores(storageSchemaV1); old.version(2).stores(storageSchemaV2);
    const s = createTrainingStorage(name); const raw = new TrainingDatabase(name);
    const program = createProgramVersionFromDraft(example.proposedProgram, { id: crypto.randomUUID(), revision: 1, previousId: null, profileRevision: 1, createdAt: time }, () => crypto.randomUUID());
    const session = { id: crypto.randomUUID(), programVersionId: program.id, templateId: program.workouts[0].id, plannedSnapshot: program.workouts[0], startedAt: time, endedAt: time, status: "abandoned", sets: [] };
    try {
      await old.open(); await old.table("profileRevisions").add({ revision: 1, payload: profile });
      await old.table("programVersions").add({ id: program.id, revision: 1, payload: program });
      await old.table("sessions").add({ id: session.id, status: session.status, payload: session });
      await old.table("counters").add({ key: "historyRevision", value: 7 });
      await old.table("coachRequests").add({ requestId: requestExample.requestId, payload: requestExample });
      await old.table("coachResponses").add({ requestId: example.requestId, payload: example }); old.close();
      await s.open(); await raw.open(); expect(raw.verno).toBe(4); expect(await s.profiles.current()).toEqual(profile); expect(await s.sessions.historyRevision()).toBe(7);
      expect(await s.programs.get(program.id)).toEqual(program); expect(await s.sessions.get(session.id)).toEqual(session);
      expect(await s.coach.getRequest(requestExample.requestId)).toEqual(requestExample);
      expect((await raw.coachResponses.toArray())[0].payload).toEqual(example); expect(await s.programs.active()).toBeUndefined(); expect(await raw.coachAcceptances.count()).toBe(0);
    } finally { old.close(); s.close(); raw.close(); await Dexie.delete(name); }
  });
  it("сбой добавления таблицы при v2→v3 откатывает схему и сохраняет профиль v2", async () => {
    const name = `m2-03-test-${crypto.randomUUID()}`; const old = new Dexie(name); old.version(2).stores(storageSchemaV2);
    const s = createTrainingStorage(name); const original = IDBDatabase.prototype.createObjectStore;
    try {
      await old.open(); await old.table("profileRevisions").add({ revision: 1, payload: profile }); old.close();
      IDBDatabase.prototype.createObjectStore = function (name, options) {
        if (name === "coachAcceptances") throw new DOMException("Synthetic schema failure", "QuotaExceededError");
        return original.call(this, name, options);
      };
      try { await expect(s.open()).rejects.toThrow(); } finally { IDBDatabase.prototype.createObjectStore = original; s.close(); }
      await old.open(); expect(old.verno).toBe(2); expect((await old.table("profileRevisions").get(1)).payload).toEqual(profile);
      expect(old.tables.some((table) => table.name === "programState" || table.name === "coachAcceptances")).toBe(false);
      old.close(); await s.open(); expect(await s.profiles.current()).toEqual(profile); expect(await s.programs.active()).toBeUndefined();
    } finally { IDBDatabase.prototype.createObjectStore = original; old.close(); s.close(); await Dexie.delete(name); }
  });
  it("повреждённый курсор не становится пустой программой или первым занятием", async () => withDb(async (s, raw) => {
    const { response } = await preview(s); await s.coach.accept(response, later, true);
    const before = await s.programs.active(); if (!before) throw new Error("Нет программы");
    await raw.programState.put({ key: "activeProgram", payload: { ...before.cursor, nextWorkoutIndex: 13 } });
    await expect(s.programs.active()).rejects.toThrow("отсутствует"); expect(await s.programs.list()).toEqual([before.program]);
  }));
});
