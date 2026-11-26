import "fake-indexeddb/auto";
import { Dexie } from "dexie";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTrainingStorage, programFileSchema, programToDraft, type TrainingStorage } from "@/entities/training";
import { TrainingDatabase } from "@/shared/infrastructure/db";
import { OwnProgramImport } from "@/features/coach-exchange/own-program-import";
import { programImportInstructions, readProgramFile } from "@/features/coach-exchange/model";
import example from "../examples/coach-response.example.json";

const time = "2026-11-26T08:00:00.000Z";
const later = "2026-11-26T09:00:00.000Z";
const file = programFileSchema.parse({ schemaVersion: 1, kind: "training_program", program: example.proposedProgram });
async function fixture(action: (s: TrainingStorage, raw: TrainingDatabase, name: string) => Promise<void>) {
  const name = `program-import-${crypto.randomUUID()}`; const s = createTrainingStorage(name); const raw = new TrainingDatabase(name);
  try {
    await s.open(); await raw.open();
    await s.profiles.save({ id: crypto.randomUUID(), revision: 1, goal: "Свой готовый план", experience: "unknown", sessionsPerWeek: null, equipment: ["dumbbells", "bench", "bodyweight"], nutritionOptIn: false });
    await action(s, raw, name);
  } finally { s.close(); raw.close(); await Dexie.delete(name); }
}
async function snapshot(raw: TrainingDatabase) { return Promise.all(raw.tables.map((table) => table.toArray())); }
async function accept(s: TrainingStorage, input: unknown = file) {
  const preview = await s.programs.previewImport(input);
  return s.programs.applyImport({ file: preview.file, expectedToken: preview.token, createdAt: time, reviewAcknowledged: true });
}

describe("IMP-01 своя программа без AI-запроса", () => {
  it("строгий файл без служебных ID; инструкция не меняет исходный план", async () => {
    expect(await readProgramFile(new Blob([JSON.stringify(file)]))).toEqual(file);
    expect(await readProgramFile(new Blob([JSON.stringify(example)]))).toEqual(file);
    const { proposedProgram: _program, ...base } = example;
    expect(_program).toBeDefined();
    await expect(readProgramFile(new Blob([JSON.stringify({ ...base, decision: "unsupported" })]))).rejects.toThrow();
    expect(() => programFileSchema.parse(example)).toThrow();
    expect(() => programFileSchema.parse({ ...file, requestId: crypto.randomUUID() })).toThrow();
    expect(() => programFileSchema.parse({ ...file, schemaVersion: 2 })).toThrow();
    const packet = JSON.parse(programImportInstructions());
    expect(packet.responseSchema).toHaveProperty("$schema");
    expect(packet.instructions).toContain("Не пересчитывай");
    expect(packet).not.toHaveProperty("profile"); expect(packet).not.toHaveProperty("requestId");
    expect(renderToStaticMarkup(<OwnProgramImport onApplied={() => {}} />)).toContain("Исходный запрос из приложения не нужен");
  });
  it("preview только читает; apply создаёт точную программу и курсор без AI-пакетов", async () => fixture(async (s, raw) => {
    const before = await snapshot(raw);
    const preview = await s.programs.previewImport(file);
    expect(await snapshot(raw)).toEqual(before); expect(preview.before).toBeUndefined();
    const program = await s.programs.applyImport({ file, expectedToken: preview.token, createdAt: time, reviewAcknowledged: true });
    expect(programToDraft(program)).toEqual(file.program);
    expect((await s.programs.active())?.cursor.nextWorkoutIndex).toBe(0);
    expect(await raw.coachRequests.count()).toBe(0); expect(await raw.coachAcceptances.count()).toBe(0);
    s.close(); await s.open(); expect((await s.programs.active())?.program).toEqual(program);
  }));
  it("новая версия сохраняет факты и прежний план; backup и последующий AI review валидны", async () => fixture(async (s, raw) => {
    const original = await accept(s);
    const session = await s.sessions.start({ sessionId: crypto.randomUUID(), startedAt: time, expectedCursor: (await s.programs.active())!.cursor, expectedHistoryRevision: 0 });
    const row = session.plannedSnapshot.exercises[0];
    await s.sessions.recordSet({ set: { id: crypto.randomUUID(), sessionId: session.id, plannedExerciseId: row.id, originalExerciseId: row.exerciseId, index: 1, timestamp: time, status: "done", actualExerciseId: row.exerciseId, actual: { type: "reps", reps: 9, weightKg: 12 }, rir: 3 }, expectedSet: null, expectedHistoryRevision: await s.sessions.historyRevision() });
    await s.sessions.finish({ sessionId: session.id, endedAt: time, expectedHistoryRevision: await s.sessions.historyRevision() });
    const sessions = await raw.sessions.toArray(); const history = await s.sessions.historyRevision();
    const secondFile = { ...file, program: { ...file.program, title: "Мой следующий план", workouts: [...file.program.workouts].reverse() } };
    const preview = await s.programs.previewImport(secondFile);
    expect(preview.before).toEqual(original);
    const second = await s.programs.applyImport({ file: secondFile, expectedToken: preview.token, createdAt: later, reviewAcknowledged: true });
    expect(second.previousId).toBe(original.id); expect(second.revision).toBe(2);
    expect(await raw.sessions.toArray()).toEqual(sessions); expect(await s.sessions.historyRevision()).toBe(history);
    expect(await s.programs.get(original.id)).toEqual(original);
    const overview = await s.analysis.overview(later); expect(overview).toBeDefined();
    const request = await s.coach.createReviewRequest(crypto.randomUUID(), later, overview!.token);
    expect(request.program?.id).toBe(second.id); expect(request.recentSessions).toHaveLength(1);
    const backup = await s.backup.export(false);
    expect(backup).toBeDefined();
  }));
  it.each(["profile", "program", "history", "active"] as const)("изменение %s блокирует применение прежнего просмотра без записи", async (change) => fixture(async (s, raw) => {
    const preview = await s.programs.previewImport(file);
    if (change === "profile") { const profile = await s.profiles.current(); await s.profiles.save({ ...profile, revision: 2 }); }
    if (change === "program") await accept(s);
    if (change === "history") await raw.counters.put({ key: "historyRevision", value: 1 });
    if (change === "active") { await accept(s); await s.sessions.start({ sessionId: crypto.randomUUID(), startedAt: time, expectedCursor: (await s.programs.active())!.cursor, expectedHistoryRevision: 0 }); }
    const before = await snapshot(raw);
    await expect(s.programs.applyImport({ file, expectedToken: preview.token, createdAt: later, reviewAcknowledged: true })).rejects.toThrow();
    expect(await snapshot(raw)).toEqual(before);
  }));
  it("повтор и два соединения не создают дубликат версии", async () => fixture(async (s, _raw, name) => {
    const other = createTrainingStorage(name); await other.open();
    try {
      const preview = await s.programs.previewImport(file);
      const command = { file, expectedToken: preview.token, createdAt: time, reviewAcknowledged: true };
      const results = await Promise.allSettled([s.programs.applyImport(command), other.programs.applyImport(command)]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await s.programs.list()).toHaveLength(1);
    } finally { other.close(); }
  }));
  it("свой план после принятого AI-плана сохраняет прежний пакет и допускает новый keep/backup", async () => fixture(async (s) => {
    const initial = await s.coach.createInitialRequest(crypto.randomUUID(), time);
    const response = await s.coach.importResponse({ ...example, requestId: initial.requestId, context: initial.context });
    const accepted = await s.coach.accept(response, time, true);
    const preview = await s.programs.previewImport(file);
    const own = await s.programs.applyImport({ file, expectedToken: preview.token, createdAt: later, reviewAcknowledged: true });
    expect(own.previousId).toBe(accepted.programVersionId);
    expect(await s.coach.acceptance(initial.requestId)).toEqual(accepted);
    const overview = await s.analysis.overview(later); expect(overview?.baselineKey).toBe(own.id);
    const request = await s.coach.createReviewRequest(crypto.randomUUID(), later, overview!.token);
    const keep = await s.coach.importResponse({ schemaVersion: 1, kind: "coach_response", requestId: request.requestId, context: request.context, decision: "keep", summary: "Оставить мой план", reasons: [], nutritionTips: [] });
    await s.coach.accept(keep, later, true);
    expect(await s.programs.list()).toHaveLength(2);
    expect(await s.backup.export(false)).toBeDefined();
  }));
  it("явное согласие, оборудование и известные упражнения обязательны", async () => fixture(async (s, raw) => {
    const preview = await s.programs.previewImport(file); const before = await snapshot(raw);
    await expect(s.programs.applyImport({ file, expectedToken: preview.token, createdAt: time, reviewAcknowledged: false })).rejects.toThrow();
    const row = file.program.workouts[0].exercises[0];
    await expect(s.programs.previewImport({ ...file, program: { ...file.program, workouts: [{ title: "A", exercises: [{ ...row, exerciseId: "invented-exercise" }] }] } })).rejects.toThrow();
    await expect(s.programs.previewImport({ ...file, program: { ...file.program, workouts: [{ title: "A", exercises: [{ ...row, exerciseId: "leg-press" }] }] } })).rejects.toThrow("оборудование");
    expect(await snapshot(raw)).toEqual(before);
  }));
  it("отказ записи курсора атомарно откатывает версию; повтор успешен", async () => fixture(async (s, raw) => {
    const preview = await s.programs.previewImport(file); const before = await snapshot(raw);
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === "programState") throw new DOMException("Synthetic quota", "QuotaExceededError");
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
    try { await expect(s.programs.applyImport({ file, expectedToken: preview.token, createdAt: time, reviewAcknowledged: true })).rejects.toThrow(); }
    finally { IDBObjectStore.prototype.put = original; }
    expect(await snapshot(raw)).toEqual(before);
    expect(await accept(s)).toHaveProperty("revision", 1);
  }));
});
