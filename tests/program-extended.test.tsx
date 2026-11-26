import "fake-indexeddb/auto";
import { IDBObjectStore } from "fake-indexeddb";
import { Dexie } from "dexie";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createTrainingStorage, programFileSchema, programToDraft, createProgramVersionFromDraft,
  exerciseCatalog, mergeExerciseCatalog,
  phaseSessionTarget, plannedSet, evaluateProgression,
  coachRequestSchema, ProgramDetails, validateBackup, diffPrograms,
  type TrainingStorage, type WorkoutSession,
} from "@/entities/training";
import { ProgramPlan } from "@/features/coach-exchange/coach-preview";
import { exportProgram, programImportInstructions, readProgramFile } from "@/features/coach-exchange/model";
import { TrainingDatabase } from "@/shared/infrastructure/db";
import extended from "../examples/training-program.periodized.example.json";
import legacy from "../examples/training-program.example.json";
import oldResponseSchema from "@/entities/training/model/legacy-response-schema.json";
import requestExample from "../examples/coach-request.example.json";

const time = "2026-11-26T10:00:00.000Z";
const file = programFileSchema.parse(extended);
async function fixture(action: (s: TrainingStorage, raw: TrainingDatabase, name: string) => Promise<void>) {
  const name = `imp02-${crypto.randomUUID()}`; const s = createTrainingStorage(name); const raw = new TrainingDatabase(name);
  try {
    await s.open(); await raw.open();
    await s.profiles.save({ id: crypto.randomUUID(), revision: 1, goal: "Проверка обмена", experience: "advanced", sessionsPerWeek: 3,
      equipment: ["barbell", "rack", "bench", "dumbbells", "cable", "leg-press", "assisted-pull-up", "treadmill", "bodyweight", "machine"], nutritionOptIn: true });
    await action(s, raw, name);
  } finally { s.close(); raw.close(); await Dexie.delete(name); }
}
async function accept(s: TrainingStorage, input: unknown = file) {
  const p = await s.programs.previewImport(input);
  return s.programs.applyImport({ file: p.file, expectedToken: p.token, createdAt: time, reviewAcknowledged: true, newExercisesAcknowledged: true });
}
async function finishOne(s: TrainingStorage, all = false) {
  const a = (await s.programs.active())!;
  const session = await s.sessions.start({ sessionId: crypto.randomUUID(), startedAt: time, expectedCursor: a.cursor, expectedHistoryRevision: await s.sessions.historyRevision() });
  for (const row of (all ? session.plannedSnapshot.exercises : session.plannedSnapshot.exercises.slice(0, 1))) {
    for (let index = 1; index <= (all ? row.sets : 1); index++) {
      const target = plannedSet(row, index).target;
      await s.sessions.recordSet({ expectedSet: null, expectedHistoryRevision: await s.sessions.historyRevision(), set: {
        id: crypto.randomUUID(), sessionId: session.id, plannedExerciseId: row.id, originalExerciseId: row.exerciseId, actualExerciseId: row.exerciseId,
        ...(row.definition ? { definition: row.definition } : {}), index, timestamp: time, status: "done",
        actual: target.type === "reps" ? { type: "reps", reps: target.max, weightKg: target.weightKg } : target.type === "duration" ? { type: "duration", seconds: target.seconds } : { type: "distance", meters: target.meters },
        ...(target.type === "reps" ? { rir: 2 } : {}),
      } });
    }
  }
  return s.sessions.finish({ sessionId: session.id, endedAt: time, expectedHistoryRevision: await s.sessions.historyRevision() });
}

describe("IMP-02 расширенный обмен", () => {
  it("три дня, восемь недель, все категории и полный каталог; прежний v1 читается", async () => {
    expect(file.program.workouts).toHaveLength(3);
    expect(file.program.phases!.reduce((n, p) => n + phaseSessionTarget(p), 0)).toBe(24);
    expect(file.program.recommendations).toHaveLength(7);
    expect(exerciseCatalog.length).toBeGreaterThan(40);
    expect(JSON.parse(programImportInstructions()).exerciseCatalog).toEqual(exerciseCatalog);
    expect(programFileSchema.parse(legacy)).toEqual(legacy);
    expect(await readProgramFile(new Blob([JSON.stringify(file)]))).toEqual(file);
    expect(coachRequestSchema.parse({ ...requestExample, responseSchema: oldResponseSchema }).responseSchema).toEqual(oldResponseSchema);
  });
  it("новые упражнения требуют отдельного подтверждения; preview ничего не пишет", async () => fixture(async (s, raw) => {
    const counts = await Promise.all(raw.tables.map((t) => t.count()));
    const p = await s.programs.previewImport(file);
    expect(p.newExercises.map((e) => e.id)).toEqual(["single-arm-cable-press"]);
    expect(await Promise.all(raw.tables.map((t) => t.count()))).toEqual(counts);
    await expect(s.programs.applyImport({ file, expectedToken: p.token, createdAt: time, reviewAcknowledged: true })).rejects.toThrow("Подтвердите добавление");
    expect(await raw.programVersions.count()).toBe(0);
    await accept(s);
    expect((await s.programs.previewImport(file)).newExercises).toEqual([]);
  }));
  it("AI-ответ с новым упражнением сохраняется только после подтверждения пакета; дальнейший keep и rollback совместимы", async () => fixture(async (s, raw) => {
    const request = await s.coach.createInitialRequest(crypto.randomUUID(), time);
    const response = await s.coach.importResponse({ schemaVersion: 1, kind: "coach_response", requestId: request.requestId, context: request.context,
      decision: "propose_program", proposedProgram: file.program, summary: "Программа со структурированными этапами", reasons: [], nutritionTips: [] });
    expect(await raw.programVersions.count()).toBe(0);
    await expect(s.coach.accept(response, time, false)).rejects.toThrow();
    const accepted = await s.coach.accept(response, time, true);
    const first = (await s.programs.active())!.program;
    expect(exportProgram(first)).toEqual(file);
    expect(first.id).toBe(accepted.programVersionId);
    const overview = (await s.analysis.overview(time))!;
    const q = await s.coach.createReviewRequest(crypto.randomUUID(), time, overview.token);
    const keep = await s.coach.importResponse({ schemaVersion: 1, kind: "coach_response", requestId: q.requestId, context: q.context, decision: "keep", summary: "Продолжить", reasons: [], nutritionTips: [] });
    await s.coach.accept(keep, time, true);
    expect((await s.programs.active())!.program).toEqual(first);
    await accept(s, { ...file, program: { ...file.program, title: "Вторая версия" } });
    const back = await s.programs.rollback({ sourceId: first.id, expectedToken: (await s.analysis.overview(time))!.token, createdAt: time, reviewAcknowledged: true });
    expect(programToDraft(back)).toEqual(file.program);
    expect((await s.programs.active())!.cursor).toMatchObject({ phaseIndex: 0, phaseSessions: 0 });
    expect(validateBackup(await s.backup.export(false))).toBeDefined();
  }));
  it("пропуск и занятие без результатов не продвигают счётчик этапа", async () => fixture(async (s) => {
    await accept(s);
    const active = (await s.programs.active())!;
    await s.sessions.skipWorkout({ sessionId: crypto.randomUUID(), startedAt: time, expectedCursor: active.cursor, expectedHistoryRevision: 0 });
    const next = (await s.programs.active())!;
    expect(next.cursor).toMatchObject({ nextWorkoutIndex: 1, phaseSessions: 0 });
    const session = await s.sessions.start({ sessionId: crypto.randomUUID(), startedAt: time, expectedCursor: next.cursor, expectedHistoryRevision: await s.sessions.historyRevision() });
    await s.sessions.finish({ sessionId: session.id, endedAt: time, expectedHistoryRevision: await s.sessions.historyRevision() });
    expect((await s.programs.active())!.cursor).toMatchObject({ nextWorkoutIndex: 1, phaseSessions: 0 });
  }));
  it("export → import → reload → export сохраняет все поля; backup/restore и AI review полные", async () => fixture(async (s, raw, name) => {
    const accepted = await accept(s);
    expect(programToDraft(accepted)).toEqual(file.program);
    expect(exportProgram(accepted)).toEqual(file);
    const other = createTrainingStorage(name); await other.open();
    try { expect(exportProgram((await other.programs.active())!.program)).toEqual(file); } finally { other.close(); }
    await finishOne(s, true); await finishOne(s, true); const customSession = await finishOne(s, true);
    expect(customSession.sets.some((set) => set.definition?.id === "single-arm-cable-press")).toBe(true);
    expect((await s.progress.overview()).exercises.some((e) => e.exercise.id === "single-arm-cable-press")).toBe(true);
    const overview = (await s.analysis.overview(time))!;
    const request = await s.coach.createReviewRequest(crypto.randomUUID(), time, overview.token);
    expect(request.programPosition).toEqual({ phaseIndex: 0, phaseSessions: 3 });
    expect(coachRequestSchema.safeParse({ ...request, programPosition: undefined }).success).toBe(false);
    expect(request.program?.progressionRules).toEqual(file.program.progressionRules);
    expect(request.program?.recommendations).toEqual(file.program.recommendations);
    expect(request.exerciseCatalog.some((e) => e.id === "single-arm-cable-press")).toBe(true);
    expect(request.historySummary.find((e) => e.exerciseId === "single-arm-cable-press")?.definition).toBeDefined();
    const backup = await s.backup.export(false); expect(validateBackup(backup)).toEqual(backup);
    const preview = await s.backup.preview(backup);
    await s.backup.restore(backup, preview.expectedToken, true);
    // Restore changes page generation; inspect via raw connection / independent new context in browser separately.
    expect((await raw.programVersions.toArray())[0].payload).toEqual(accepted);
    expect((await raw.sessions.toArray()).map((r) => r.payload)).toContainEqual(customSession);
  }));
  it("24 занятия, переходы только по подтверждению, неизменные исторические снимки", async () => fixture(async (s, raw) => {
    await accept(s);
    await expect(s.programs.advancePhase({ expectedCursor: (await s.programs.active())!.cursor, expectedHistoryRevision: 0, confirmed: true })).rejects.toThrow("Ещё не выполнено");
    for (const count of [9, 9]) {
      for (let i = 0; i < count; i++) await finishOne(s);
      const a = (await s.programs.active())!;
      const old = await raw.sessions.toArray();
      const command = { expectedCursor: a.cursor, expectedHistoryRevision: await s.sessions.historyRevision(), confirmed: true };
      await expect(s.programs.advancePhase({ ...command, confirmed: false })).rejects.toThrow();
      const cursor = await s.programs.advancePhase(command);
      expect(cursor.phaseIndex).toBe((a.cursor.phaseIndex ?? 0) + 1);
      expect(cursor.phaseSessions).toBe(0);
      expect(await raw.sessions.toArray()).toEqual(old);
      await expect(s.programs.advancePhase(command)).rejects.toThrow("изменились");
      const w = (await s.programs.active())!.workout;
      expect(w.exercises[1].target).toMatchObject({ weightKg: cursor.phaseIndex === 1 ? 14 : 12 });
      expect(validateBackup(await s.backup.export(false))).toBeDefined();
    }
    for (let i = 0; i < 6; i++) await finishOne(s);
    expect((await s.programs.active())!.cursor).toMatchObject({ phaseIndex: 2, phaseSessions: 6 });
    expect(await raw.sessions.count()).toBe(24);
    expect(await raw.programVersions.count()).toBe(1);
  }));
  it("смена этапа блокирует старый AI-ответ, stale cursor и переход при активном занятии", async () => fixture(async (s) => {
    const manual = { ...file, program: { ...file.program, phases: file.program.phases!.map((p) => ({ ...p, transition: "manual" })) } };
    await accept(s, manual);
    const a = (await s.programs.active())!; const overview = (await s.analysis.overview(time))!;
    const q = await s.coach.createReviewRequest(crypto.randomUUID(), time, overview.token);
    const keep = { schemaVersion: 1, kind: "coach_response", requestId: q.requestId, context: q.context, decision: "keep", summary: "Сохранить", reasons: [], nutritionTips: [] };
    await s.programs.advancePhase({ expectedCursor: a.cursor, expectedHistoryRevision: 0, confirmed: true });
    await expect(s.coach.importResponse(keep)).rejects.toThrow("Этап программы изменился");
    await expect(s.sessions.start({ sessionId: crypto.randomUUID(), startedAt: time, expectedCursor: a.cursor, expectedHistoryRevision: 0 })).rejects.toThrow("Порядок изменился");
    const b = (await s.programs.active())!;
    await s.sessions.start({ sessionId: crypto.randomUUID(), startedAt: time, expectedCursor: b.cursor, expectedHistoryRevision: 0 });
    await expect(s.programs.advancePhase({ expectedCursor: b.cursor, expectedHistoryRevision: await s.sessions.historyRevision(), confirmed: true })).rejects.toThrow("активное занятие");
  }));
  it("отклоняет дубликаты и конфликт определений между версиями", async () => fixture(async (s) => {
    await accept(s);
    const changed = structuredClone(extended); const r = changed.program.workouts[2].exercises[1];
    if (!("definition" in r) || !r.definition) throw new Error("fixture");
    r.definition.name = "Другое название того же ID";
    await expect(s.programs.previewImport(changed)).rejects.toThrow("Конфликт определения");
    const definition = file.program.workouts[2].exercises[1].definition!;
    expect(() => mergeExerciseCatalog([definition, { ...definition, id: "another-id" }])).toThrow();
    await accept(s, { ...file, program: { ...file.program, title: "Ещё одна версия" } });
    const backup = await s.backup.export(false);
    const versions = backup.data.programVersions.map((v, index) => index === 0 ? v : { ...v, payload: { ...v.payload, workouts: v.payload.workouts.map((w) => ({ ...w, exercises: w.exercises.map((r) => r.definition ? { ...r, definition: { ...r.definition, name: "Переопределённый ID" } } : r) })) } });
    expect(() => validateBackup({ ...backup, data: { ...backup.data, programVersions: versions } })).toThrow("Конфликт определения");
  }));
  it("ошибка перехода откатывает курсор, повтор не продвигает второй раз", async () => fixture(async (s, raw) => {
    await accept(s, { ...file, program: { ...file.program, phases: file.program.phases!.map((p) => ({ ...p, transition: "manual" })) } });
    const a = (await s.programs.active())!;
    const previous = await raw.programState.toArray();
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === "programState") throw new DOMException("Synthetic quota", "QuotaExceededError");
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
    try { await expect(s.programs.advancePhase({ expectedCursor: a.cursor, expectedHistoryRevision: 0, confirmed: true })).rejects.toThrow(); }
    finally { IDBObjectStore.prototype.put = original; }
    expect(await raw.programState.toArray()).toEqual(previous);
    await s.programs.advancePhase({ expectedCursor: a.cursor, expectedHistoryRevision: 0, confirmed: true });
    await expect(s.programs.advancePhase({ expectedCursor: a.cursor, expectedHistoryRevision: 0, confirmed: true })).rejects.toThrow();
    expect((await s.programs.active())!.cursor.phaseIndex).toBe(1);
  }));
  it("полные планы/рекомендации/параметры подходов доступны в UI без исполнения текста", () => {
    const html = renderToStaticMarkup(<ProgramPlan program={file.program} />);
    for (const text of ["A · Ноги и жим", "C · Смешанное занятие", "Этапы программы", "Правила прогрессии", "Рекомендации программы", "Разминочный", "Жим одной рукой"]) expect(html).toContain(text);
    expect(renderToStaticMarkup(<ProgramDetails program={{ ...file.program, recommendations: [{ category: "other", text: "<script>alert(1)</script>" }] }} />)).toContain("&lt;script&gt;");
  });
  it("diff показывает изменения этапов, правил, рекомендаций и отдельных подходов по русским полям", () => {
    const after = { ...file.program, recommendations: [{ category: "other", text: "Изменённая рекомендация" }],
      phases: file.program.phases!.map((p, i) => ({ ...p, goal: i === 0 ? "Новая цель этапа" : p.goal })),
      progressionRules: file.program.progressionRules!.map((r, i) => i === 0 ? { ...r, action: { type: "sets", change: 1 } } : r) };
    const diff = diffPrograms(file.program, after);
    expect(diff.some((d) => d.path.includes("Этап 1 · цель"))).toBe(true);
    expect(diff.some((d) => d.path.includes("Правило прогрессии 1 · действие"))).toBe(true);
    expect(diff.some((d) => d.path.includes("Рекомендация 1 · текст"))).toBe(true);
    expect(diffPrograms(file.program, file.program)).toEqual([]);
  });
  it.each([
    (p: typeof extended) => { p.program.phases[1].id = p.program.phases[0].id; },
    (p: typeof extended) => { p.program.phases[1].overrides[0].exerciseIndex = 19; },
    (p: typeof extended) => { p.program.phases[1].overrides[0].prescription.exerciseId = "push-up"; },
    (p: typeof extended) => { p.program.progressionRules[0].exerciseId = "missing"; },
    (p: typeof extended) => { p.program.recommendations[0].phaseId = "missing"; },
    (p: typeof extended) => { p.program.workouts[0].exercises[0].sets = 4; },
    (p: typeof extended) => { Object.assign(p.program.workouts[1].exercises[3].target, { maxSeconds: 10 }); },
    (p: typeof extended) => { Object.assign(p.program.workouts[0].exercises[0], { rirMax: 1 }); },
  ])("некорректные поля отклоняются с путём", (mutate) => {
    const bad = structuredClone(extended); mutate(bad);
    const result = programFileSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path[0]).toBe("program");
  });
});

describe("IMP-03 runtime-инварианты на границе файла", () => {
  const row = { exerciseId: "db-bench-press", sets: 1, target: { type: "reps", min: 8, max: 12, weightKg: 0 }, restSec: 0, rir: 0, rirMax: 0 };
  const phase = { id: "first", title: "Этап", goal: "Цель", duration: { unit: "sessions", count: 1 }, transition: "manual", overrides: [] };
  const base = { title: "Проверка", goalInterpretation: "Проверка", reviewAfterSessions: 1, workouts: [{ title: "A", exercises: [row] }], phases: [phase] };
  const withRow = (value: unknown) => ({ ...base, workouts: [{ title: "A", exercises: [value] }] });
  const set = { kind: "working", target: row.target, restSec: 0, rir: 0, rirMax: 0 };
  const withSet = (value: unknown) => withRow({ ...row, setPlans: [value] });
  const withOverrides = (overrides: unknown[]) => ({ ...base, phases: [{ ...phase, overrides }] });
  const override = { workoutIndex: 0, exerciseIndex: 0, prescription: row };
  const rule = { id: "rule", description: "Правило", condition: { type: "upper_reps", sessions: 1 }, action: { type: "weight", change: 1, unit: "kg" } };
  it.each([
    ["min > max", withRow({ ...row, target: { ...row.target, min: 13 } })],
    ["min > max в подходе", withSet({ ...set, target: { ...row.target, min: 13 } })],
    ["rir > rirMax в подходе", withSet({ ...set, rir: 2, rirMax: 1 })],
    ["rirMax без rir", withRow({ ...row, rir: undefined, rirMax: 1 })],
    ["rirMax при null", withSet({ ...set, rir: null, rirMax: 1 })],
    ["seconds > maxSeconds в подходе", withRow({ exerciseId: "plank", sets: 1, target: { type: "duration", seconds: 30 }, restSec: 0,
      setPlans: [{ kind: "working", restSec: 0, target: { type: "duration", seconds: 30, maxSeconds: 20 } }] })],
    ["длина setPlans", withRow({ ...row, sets: 2, setPlans: [set] })],
    ["неизвестный ID без definition", withRow({ ...row, exerciseId: "missing" })],
    ["definition.id отличается", withRow({ ...row, definition: file.program.workouts[2].exercises[1].definition })],
    ["несуществующий день override", withOverrides([{ ...override, workoutIndex: 1 }])],
    ["несуществующая строка override", withOverrides([{ ...override, exerciseIndex: 1 }])],
    ["повтор override", withOverrides([override, override])],
    ["конфликтующие overrides", withOverrides([override, { ...override, prescription: { ...row, sets: 2 } }])],
    ["измерение строки", withRow({ ...row, target: { type: "duration", seconds: 30 }, rir: undefined, rirMax: undefined })],
    ["измерение подхода", withSet({ kind: "working", restSec: 0, target: { type: "duration", seconds: 30 } })],
    ["измерение override", withOverrides([{ ...override, prescription: { ...row, target: { type: "distance", meters: 10 }, rir: undefined, rirMax: undefined } }])],
    ["exerciseId правила", { ...base, progressionRules: [{ ...rule, exerciseId: "missing" }] }],
    ["exerciseId рекомендации", { ...base, recommendations: [{ category: "other", text: "Совет", exerciseId: "missing" }] }],
    ["phaseId без этапов", { ...base, phases: undefined, recommendations: [{ category: "other", text: "Совет", phaseId: "first" }] }],
  ])("отклоняет %s", (_name, program) => {
    const result = programFileSchema.safeParse({ schemaVersion: 1, kind: "training_program", program });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === "program")).toBe(true);
  });
  it("принимает равные границы и нули, одинаковую позицию в разных этапах", () => {
    const valid = withRow({ ...row, target: { ...row.target, min: 8, max: 8 }, setPlans: [set] });
    expect(programFileSchema.safeParse({ ...file, program: { ...valid, phases: [
      { ...phase, overrides: [override] }, { ...phase, id: "second", overrides: [override] },
    ] } }).success).toBe(true);
  });
  it("сохраняет, повторно экспортирует и показывает интенсивность целей времени и дистанции в overrides", async () => fixture(async (s, _raw, name) => {
    const rows = [
      { exerciseId: "plank", sets: 1, target: { type: "duration", seconds: 30, maxSeconds: 45, intensity: "Темп этапа времени" }, restSec: 30 },
      { exerciseId: "treadmill-walk", sets: 1, target: { type: "distance", meters: 500, intensity: "Темп этапа дистанции" }, restSec: 30 },
    ];
    const program = programFileSchema.parse({ ...file, program: { ...base, workouts: [{ title: "A", exercises: rows }],
      phases: [{ ...phase, overrides: rows.map((prescription, exerciseIndex) => ({ workoutIndex: 0, exerciseIndex, prescription })) }] } }).program;
    await accept(s, { ...file, program });
    s.close();
    const reopened = createTrainingStorage(name);
    let saved;
    try {
      await reopened.open();
      saved = exportProgram((await reopened.programs.active())!.program);
    } finally { reopened.close(); }
    expect(saved).toEqual({ ...file, program });
    const html = renderToStaticMarkup(<ProgramDetails program={saved.program} />);
    expect(html).toContain("Темп этапа времени");
    expect(html).toContain("Темп этапа дистанции");
    expect(html).toContain("30–45 с");
    expect(html).not.toContain("RIR");
  }));
});

describe("IMP-04 пустой RIR для времени и дистанции", () => {
  const makeFile = (exerciseId: string, target: unknown) => ({ schemaVersion: 1, kind: "training_program", program: {
    title: "Проверка пустого RIR", goalInterpretation: "Синтетический план", reviewAfterSessions: 6,
    workouts: [{ title: "A", exercises: [{ exerciseId, sets: 1, target, restSec: 60, rir: null,
      setPlans: [{ kind: "working", target, restSec: 60, rir: null }] }] }],
    phases: ["one", "two", "three"].map((id) => ({ id, title: id, goal: "Проверка импорта", duration: { unit: "sessions", count: 3 }, transition: "manual",
      overrides: [{ workoutIndex: 0, exerciseIndex: 0, prescription: { exerciseId, sets: 1, target, restSec: 60, rir: null,
        setPlans: [{ kind: "working", target, restSec: 60, rir: null }] } }] })),
  } });
  it.each([
    ["plank", { type: "duration", seconds: 30, maxSeconds: 45 }],
    ["treadmill-walk", { type: "distance", meters: 500 }],
  ])("%s: null сохраняется в строке, трёх этапах, подходах, DB и повторном экспорте", async (id, target) => fixture(async (s) => {
    const input = makeFile(String(id), target);
    const parsed = await readProgramFile(new Blob([JSON.stringify(input)]));
    expect(parsed).toEqual(input);
    const saved = await accept(s, parsed);
    s.close(); await s.open();
    expect(exportProgram((await s.programs.active())!.program)).toEqual(input);
    expect(exportProgram(saved)).toEqual(input);
    await finishOne(s, true);
    expect(validateBackup(await s.backup.export(false))).toBeDefined();
  }));
  it.each([0, 2])("числовой RIR %s не удаляется молча; ошибка называет поле и значение", (rir) => {
    const input = makeFile("plank", { type: "duration", seconds: 30 });
    const bad = { ...input, program: { ...input.program, workouts: [{ title: "A", exercises: [{ ...input.program.workouts[0].exercises[0], rir,
      setPlans: [{ ...input.program.workouts[0].exercises[0].setPlans[0], rir }] }] }] } };
    const result = programFileSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "program.workouts.0.exercises.0.rir" && issue.message.includes(`RIR=${rir}`))).toBe(true);
      expect(result.error.issues.some((issue) => issue.path.join(".") === "program.workouts.0.exercises.0.setPlans.0.rir")).toBe(true);
    }
  });
});

describe("IMP-02 чистые правила прогрессии", () => {
  function samples(type: string = "upper_reps", action: unknown = { type: "weight", change: 1, unit: "kg" }, exerciseId = "db-bench-press") {
    const p = createProgramVersionFromDraft({ title: "Тест", goalInterpretation: "Тест", reviewAfterSessions: 2, workouts: [{ title: "A", exercises: [{ exerciseId, sets: 2, target: { type: "reps", min: 8, max: 12, weightKg: 10 }, restSec: 90, rir: 2 }] }], progressionRules: [{ id: "test", description: "Тест", condition: { type, sessions: 2, minRir: 2 }, action }] }, { id: crypto.randomUUID(), revision: 1, previousId: null, profileRevision: 1, createdAt: time }, () => crypto.randomUUID());
    const history: WorkoutSession[] = Array.from({ length: 2 }, () => {
      const id = crypto.randomUUID(); const row = p.workouts[0].exercises[0];
      return { id, programVersionId: p.id, templateId: p.workouts[0].id, plannedSnapshot: p.workouts[0], startedAt: time, endedAt: time, status: "completed", sets: [1, 2].map((index) => ({ id: crypto.randomUUID(), sessionId: id, plannedExerciseId: row.id, originalExerciseId: row.exerciseId, actualExerciseId: row.exerciseId, index, timestamp: time, status: "done", actual: { type: "reps", reps: 12, weightKg: 10 }, rir: 2 })) };
    });
    return { p, history };
  }
  it.each(["kg", "percent"])("гравитрон: прогресс уменьшает помощь (%s), разгрузка увеличивает; знак не инвертируется", (unit) => {
    const { p, history } = samples("upper_reps", { type: "weight", change: -2.5, unit }, "assisted-pull-up");
    const before = structuredClone({ p, history });
    expect(evaluateProgression(p, history)[0].rule.action).toEqual({ type: "weight", change: -2.5, unit });
    const deload = { ...p, progressionRules: p.progressionRules!.map((r) => ({ ...r,
      condition: { type: "below_reps", sessions: 2 }, action: { type: "weight", change: 2.5, unit } })) };
    const low = history.map((s) => ({ ...s, sets: s.sets.map((set) => set.status === "done" ? { ...set, actual: { ...set.actual, reps: 6 } } : set) }));
    expect(evaluateProgression(deload, low)[0].rule.action).toEqual({ type: "weight", change: 2.5, unit });
    expect({ p, history }).toEqual(before);
  });
  it("все рабочие подходы/окно/RIR, без мутации и автоматического применения", () => {
    const { p, history } = samples(); const before = structuredClone({ p, history });
    expect(evaluateProgression(p, history)).toHaveLength(1);
    expect(evaluateProgression(p, history.slice(0, 1))).toEqual([]);
    const unknown = history.map((s) => ({ ...s, sets: s.sets.map((set) => ({ ...set, rir: null })) }));
    expect(evaluateProgression(p, unknown)).toEqual([]);
    expect({ p, history }).toEqual(before);
  });
  it.each(["plateau", "below_reps", "excessive_load", "manual"])("условие %s, индивидуальное действие сохраняется", (type) => {
    const { p, history } = samples(type, { type: "reps", change: -1 });
    expect(evaluateProgression(p, history)).toHaveLength(type === "plateau" ? 1 : 0);
  });
  it("прогрессия не смешивает этапы, иной вес, пропуски и упражнения", () => {
    const { p, history } = samples();
    expect(evaluateProgression(p, history, 1)).toEqual([]);
    const otherWeight = history.map((s) => ({ ...s, sets: s.sets.map((set) => set.status === "done" ? { ...set, actual: { type: "reps", reps: 12, weightKg: 8 } } : set) }));
    expect(evaluateProgression(p, otherWeight)).toEqual([]);
    const skipped = history.map((s) => ({ ...s, status: "partial", sets: s.sets.slice(0, 1) }));
    expect(evaluateProgression(p, skipped)).toEqual([]);
  });
  it.each(["below_reps", "excessive_load"])("%s с фактическим низким RIR предлагает уменьшение веса", (type) => {
    const { p, history } = samples(type, { type: "weight", change: -5, unit: "percent" });
    const lower = { ...p, progressionRules: p.progressionRules!.map((r) => ({ ...r, condition: { type, sessions: 2, maxRir: 1 } })) };
    const lowHistory = history.map((s) => ({ ...s, sets: s.sets.map((set) => set.status === "done" ? { ...set, rir: 0, actual: { type: "reps", reps: 6, weightKg: 10 } } : set) }));
    expect(evaluateProgression(lower, lowHistory)[0].rule.action).toMatchObject({ change: -5, unit: "percent" });
  });
  it("индивидуальное правило имеет приоритет над общим для такого же условия и действия", () => {
    const { p, history } = samples(); const rule = p.progressionRules![0];
    const individual = { ...p, progressionRules: [rule, { ...rule, id: "specific", exerciseId: "db-bench-press", action: { type: "weight", change: 0.5, unit: "kg" } }] };
    const suggestions = evaluateProgression(individual, history);
    expect(suggestions).toHaveLength(1); expect(suggestions[0].rule.id).toBe("specific");
  });
});
