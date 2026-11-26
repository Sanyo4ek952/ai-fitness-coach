import "fake-indexeddb/auto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTrainingStorage, evaluateAnalysis, programVersionSchema, profileSchema, workoutSessionSchema, coachAcceptanceSchema, type TrainingStorage } from "@/entities/training";
import { AnalysisSignal, AnalysisSummary } from "@/features/analysis-signal/analysis-signal";
import { runStorageCase } from "./storage-cases";
import example from "../examples/coach-response.example.json";

const id = () => crypto.randomUUID();
const time = "2026-11-01T00:00:00Z";
const now = "2026-11-10T00:00:00Z";
const profile = profileSchema.parse({ id: id(), revision: 1, goal: "Тест", experience: "unknown", sessionsPerWeek: null, equipment: ["dumbbells", "bench"], nutritionOptIn: false });
const row = { id: id(), exerciseId: "goblet-squat", sets: 2, target: { type: "reps", min: 6, max: 8, weightKg: 20 }, restSec: 60, rir: 2 };
const program = programVersionSchema.parse({ id: id(), revision: 1, previousId: null, profileRevision: 1, createdAt: time, title: "Тест", goalInterpretation: "Тест",
  workouts: [{ id: id(), title: "А", exercises: [row] }, { id: id(), title: "Б", exercises: [{ ...row, id: id() }] }], reviewAfterSessions: 2 });
function session(day: number, reps = 5, workout = program.workouts[0]) {
  const sessionId = id(); const timestamp = `2026-11-${String(day).padStart(2, "0")}T01:00:00Z`;
  const r = workout.exercises[0];
  return workoutSessionSchema.parse({ id: sessionId, programVersionId: program.id, templateId: workout.id, plannedSnapshot: workout,
    startedAt: timestamp, endedAt: timestamp, status: "completed", sets: [1, 2].map((index) => ({ id: id(), sessionId, plannedExerciseId: r.id,
      originalExerciseId: r.exerciseId, actualExerciseId: r.exerciseId, index, timestamp, status: "done", actual: { type: "reps", reps, weightKg: 20 }, rir: 2 })) });
}
const first = session(2); const second = session(3);
const base = { now, profile, baselineProfile: profile, program, sessions: [first, second] };
const performance = (input: unknown) => evaluateAnalysis(input).reasonCodes.includes("performance");
const snooze = { baselineKey: program.id, manual: false, snooze: { sessionIds: [first.id, second.id], signalKeys: evaluateAnalysis(base).signals.map((signal) => signal.key) } };

describe("M4-01 чистые правила анализа", () => {
  it("пустая история и календарь без результатов не требуют анализа", () => {
    expect(evaluateAnalysis({ ...base, sessions: [] }).reasonCodes).toEqual([]);
    expect(evaluateAnalysis({ ...base, sessions: [first] }).reasonCodes).toEqual([]);
  });
  it("два сопоставимых занятия ниже диапазона дают performance и ссылки на реальные подходы", () => {
    const result = evaluateAnalysis(base);
    expect(result.reasonCodes).toEqual(["performance", "periodic"]);
    expect(result.signals[0].evidence).toEqual([first, second].map((s) => ({ sessionId: s.id, setIds: s.sets.map((set) => set.id) })));
    expect(evaluateAnalysis(base)).toEqual(result); expect(base.sessions).toEqual([first, second]);
  });
  it("один плохой день и нормальное последнее занятие не дают performance", () => {
    expect(performance({ ...base, sessions: [first, session(3, 7)] })).toBe(false);
    expect(performance({ ...base, sessions: [session(2, 7), second] })).toBe(false);
  });
  it.each([null, undefined, 1])("RIR %s не даёт сигнала лёгкости", (rir) => {
    const sessions = [session(2, 9), session(3, 9)].map((s) => ({ ...s, sets: s.sets.map((set) => ({ ...set, rir })) }));
    expect(performance({ ...base, sessions })).toBe(false);
  });
  it("выше диапазона при достаточном известном RIR даёт performance", () => {
    expect(performance({ ...base, sessions: [session(2, 9), session(3, 9)] })).toBe(true);
  });
  it("известный нулевой вес сопоставим только с известным нулём плана", () => {
    const sessions = [first, second].map((s) => ({ ...s,
      plannedSnapshot: { ...s.plannedSnapshot, exercises: [{ ...row, target: { ...row.target, weightKg: 0 } }] },
      sets: s.sets.map((set) => ({ ...set, actual: { type: "reps", reps: 5, weightKg: 0 } })) }));
    expect(performance({ ...base, sessions })).toBe(true);
  });
  it("время и дистанция не получают выдуманных порогов performance или RIR", () => {
    for (const target of [{ type: "duration", seconds: 20 }, { type: "distance", meters: 100 }]) {
      const exerciseId = target.type === "duration" ? "plank" : "treadmill-walk";
      const sessions = [first, second].map((s) => ({ ...s,
        plannedSnapshot: { ...s.plannedSnapshot, exercises: [{ id: row.id, exerciseId, sets: 2, target, restSec: 60 }] },
        sets: s.sets.map((set) => ({ ...set, originalExerciseId: exerciseId, actualExerciseId: exerciseId, rir: undefined,
          actual: target.type === "duration" ? { type: "duration", seconds: 10 } : { type: "distance", meters: 10 } })) }));
      expect(performance({ ...base, sessions })).toBe(false);
    }
  });
  it("новое направление performance снимает отсрочку", () => {
    const sessions = [first, second].map((s) => ({ ...s, sets: s.sets.map((set) => ({ ...set, actual: { type: "reps", reps: 9, weightKg: 20 } })) }));
    const result = evaluateAnalysis({ ...base, control: snooze, sessions });
    expect(result.reasonCodes[0]).toBe("performance"); expect(result.deferred).toBe(false);
  });
  it.each([null, 0, 10, 30])("несопоставимый фактический вес %s не сравнивается с 20", (weightKg) => {
    const sessions = [first, second].map((s) => ({ ...s, sets: s.sets.map((set) => ({ ...set, actual: { type: "reps", reps: 5, weightKg } })) }));
    expect(performance({ ...base, sessions })).toBe(false);
  });
  it("неизвестный плановый вес не считается нулём", () => {
    const sessions = [first, second].map((s) => ({ ...s, plannedSnapshot: { ...s.plannedSnapshot, exercises: [{ ...row, target: { ...row.target, weightKg: null } }] } }));
    expect(performance({ ...base, sessions })).toBe(false);
  });
  it("замены не наследуют диапазон для сравнения", () => {
    const sessions = [first, second].map((s) => ({ ...s,
      replacements: [{ plannedExerciseId: row.id, originalExerciseId: row.exerciseId, actualExerciseId: "leg-press", timestamp: s.startedAt }],
      sets: s.sets.map((set) => ({ ...set, actualExerciseId: "leg-press" })) }));
    expect(performance({ ...base, sessions })).toBe(false);
  });
  it("неполная строка прерывает пару; skipped не становится регрессом", () => {
    const valid = session(3); const changed = { ...valid, status: "partial", sets: [valid.sets[0]] };
    expect(performance({ ...base, sessions: [first, changed] })).toBe(false);
  });
  it("изменённый диапазон/число подходов не создаёт сопоставимость", () => {
    const changed = { ...second, plannedSnapshot: { ...second.plannedSnapshot, exercises: [{ ...row, target: { ...row.target, min: 7 } }] } };
    expect(performance({ ...base, sessions: [first, changed] })).toBe(false);
  });
  it("periodic: ровно 7 дней + 2 результата; цикл работает раньше без пропусков", () => {
    const within = [session(2, 7), session(3, 7)];
    expect(evaluateAnalysis({ ...base, sessions: within, now: "2026-11-07T23:59:59Z" }).reasonCodes).toEqual([]);
    expect(evaluateAnalysis({ ...base, sessions: within, now: "2026-11-08T00:00:00Z" }).reasonCodes).toEqual(["periodic"]);
    expect(evaluateAnalysis({ ...base, sessions: [within[0], session(3, 7, program.workouts[1])], now: "2026-11-04T00:00:00Z" }).reasonCodes).toEqual(["periodic"]);
  });
  it("skipped/abandoned/active и другая версия не расходуют отсрочку", () => {
    const skipped = { ...session(4), status: "skipped", sets: [] };
    const abandoned = { ...session(5), status: "abandoned", sets: [] };
    const active = { ...session(6), status: "active", endedAt: null };
    const foreign = { ...session(7), programVersionId: id() };
    const result = evaluateAnalysis({ ...base, control: snooze, sessions: [...base.sessions, skipped, abandoned, active, foreign] });
    expect(result.deferred).toBe(true); expect(result.remaining).toBe(2);
  });
  it("отсрочка на два новых ID с результатами; исправления не расходуют её", () => {
    expect(evaluateAnalysis({ ...base, control: snooze }).remaining).toBe(2);
    expect(evaluateAnalysis({ ...base, control: snooze, sessions: [...base.sessions, session(4)] }).remaining).toBe(1);
    expect(evaluateAnalysis({ ...base, control: snooze, sessions: [...base.sessions, session(4), session(5)] }).needsAnalysis).toBe(true);
  });
  it("новая цель снимает отсрочку, порядок equipment и optional не создают сигнал", () => {
    expect(evaluateAnalysis({ ...base, control: snooze, profile: { ...profile, goal: "Новая цель" } }).reasonCodes[0]).toBe("changed_context");
    expect(evaluateAnalysis({ ...base, control: snooze, profile: { ...profile, goal: "Новая цель" } }).deferred).toBe(false);
    expect(evaluateAnalysis({ ...base, profile: { ...profile, equipment: [...profile.equipment].reverse(), details: { weightKg: 80 } } }).reasonCodes).not.toContain("changed_context");
  });
  it("боль немедленно выше других сигналов и не откладывается", () => {
    const active = session(4); const result = evaluateAnalysis({ ...base, control: snooze,
      sessions: [...base.sessions, { ...active, status: "active", endedAt: null, sets: active.sets.map((set) => ({ ...set, pain: true })) }] });
    expect(result.reasonCodes[0]).toBe("safety"); expect(result.needsAnalysis).toBe(true); expect(result.deferred).toBe(false);
  });
  it("keep сбрасывает baseline/старую ручную просьбу/отсрочку без новой программы", () => {
    const requestId = id();
    const acceptance = coachAcceptanceSchema.parse({ requestId, status: "accepted", acceptedAt: "2026-11-04T00:00:00Z", reviewAcknowledged: true, programVersionId: program.id,
      response: { schemaVersion: 1, kind: "coach_response", requestId, context: { profileRevision: 1, programVersionId: program.id, historyRevision: 7 }, decision: "keep", summary: "Оставить", reasons: [], nutritionTips: [] } });
    const result = evaluateAnalysis({ ...base, acceptance, control: { ...snooze, manual: true } });
    expect(result.reasonCodes).toEqual([]); expect(result.deferred).toBe(false); expect(result.sessionIds).toEqual([]);
  });
  it("строгая граница отклоняет неизвестные поля и чужую единицу", () => {
    expect(() => evaluateAnalysis({ ...base, extra: true })).toThrow();
    expect(() => evaluateAnalysis({ ...base, sessions: [{ ...first, sets: first.sets.map((set) => ({ ...set, actual: { type: "duration", seconds: 4 } })) }] })).toThrow();
  });
  it("SSR ничего не читает; краткая сводка явно оставляет тренировку доступной", () => {
    expect(renderToStaticMarkup(<AnalysisSignal />)).toBe("");
    const html = renderToStaticMarkup(<AnalysisSummary value={evaluateAnalysis(base)} />);
    expect(html).toContain("Есть повод для анализа"); expect(html).toContain("не блокирует тренировку");
    const safety = evaluateAnalysis({ ...base, sessions: [{ ...first, sets: first.sets.map((set) => ({ ...set, pain: true })) }] });
    expect(renderToStaticMarkup(<AnalysisSummary value={safety} />)).toContain('role="alert"');
  });
});

async function seed(storage: TrainingStorage) {
  await storage.profiles.save(profile);
  const request = await storage.coach.createInitialRequest(id(), time);
  const response = await storage.coach.importResponse({ ...example, requestId: request.requestId, context: request.context });
  await storage.coach.accept(response, time, true);
}
async function finishOne(storage: TrainingStorage, day: number, pain = false) {
  const current = await storage.sessions.overview(); if (!current.active) throw new Error("Нет программы");
  const timestamp = `2026-11-${String(day).padStart(2, "0")}T01:00:00Z`;
  const active = await storage.sessions.start({ sessionId: id(), startedAt: timestamp, expectedCursor: current.active.cursor, expectedHistoryRevision: current.historyRevision });
  const row = active.plannedSnapshot.exercises[0];
  await storage.sessions.recordSet({ expectedHistoryRevision: current.historyRevision + 1, expectedSet: null,
    set: { id: id(), sessionId: active.id, plannedExerciseId: row.id, originalExerciseId: row.exerciseId, actualExerciseId: row.exerciseId,
      index: 1, timestamp, status: "done", actual: { type: "reps", reps: 7, weightKg: null }, pain } });
  return storage.sessions.finish({ sessionId: active.id, endedAt: timestamp, expectedHistoryRevision: current.historyRevision + 2 });
}
describe("M4-01 транзакции анализа", () => {
  it("refresh сохраняет reasonCodes/ссылки на факты без дублей; чтение не изменяет snapshot", () => runStorageCase({ name: "analysis snapshot", async run({ storage: s, raw }) {
    await seed(s); await finishOne(s, 2); await finishOne(s, 3);
    const result = await s.analysis.refresh(now); const saved = await raw.programState.get("analysisSnapshot");
    expect(saved?.payload).toMatchObject({ reasonCodes: ["periodic"], facts: expect.arrayContaining([expect.objectContaining({ sessionId: expect.any(String), setIds: expect.any(Array) })]) });
    await s.analysis.refresh(now); expect(await raw.programState.get("analysisSnapshot")).toEqual(saved);
    expect(await s.analysis.overview(now)).toEqual(result); expect(await raw.programState.count()).toBe(3);
  } }));
  it("тренировки доступны при сигнале; skip не расходует отсрочку, два partial расходуют", () => runStorageCase({ name: "analysis lifecycle", async run({ storage: s }) {
    await seed(s); const initial = await s.analysis.overview(now); if (!initial) throw new Error("Нет анализа");
    const manual = await s.analysis.act({ kind: "manual", now, expectedToken: initial.token }); if (!manual) throw new Error("Нет анализа");
    await s.analysis.act({ kind: "snooze", now, expectedToken: manual.token });
    const current = await s.sessions.overview(); if (!current.active) throw new Error("Нет программы");
    await s.sessions.skipWorkout({ sessionId: id(), startedAt: "2026-11-02T00:00:00Z", expectedCursor: current.active.cursor, expectedHistoryRevision: current.historyRevision });
    expect((await s.analysis.overview(now))?.remaining).toBe(2);
    await finishOne(s, 3); expect((await s.analysis.overview(now))?.remaining).toBe(1);
    await finishOne(s, 4); expect((await s.analysis.overview(now))?.needsAnalysis).toBe(true);
    const before = await s.sessions.overview(); await finishOne(s, 5);
    expect(await s.sessions.historyRevision()).toBe(before.historyRevision + 3);
  } }));
  it("safety нельзя отложить, история и курсор остаются неизменны", () => runStorageCase({ name: "analysis safety", async run({ storage: s }) {
    await seed(s); await finishOne(s, 2, true);
    const value = await s.analysis.overview(now); if (!value) throw new Error("Нет анализа");
    expect(value.reasonCodes[0]).toBe("safety"); const before = await s.sessions.overview();
    await expect(s.analysis.act({ kind: "snooze", now, expectedToken: value.token })).rejects.toThrow("нельзя отложить");
    expect(await s.sessions.overview()).toEqual(before);
  } }));
  it("принятый keep становится baseline чтения без записи новой программы", () => runStorageCase({ name: "analysis keep baseline", async run({ storage: s, raw }) {
    await seed(s); await finishOne(s, 2);
    const active = await s.programs.active(); if (!active) throw new Error("Нет программы");
    const requestId = id();
    const acceptance = coachAcceptanceSchema.parse({ requestId, status: "accepted", acceptedAt: "2026-11-04T00:00:00Z", reviewAcknowledged: true, programVersionId: active.program.id,
      response: { schemaVersion: 1, kind: "coach_response", requestId, context: { profileRevision: 1, programVersionId: active.program.id, historyRevision: 3 }, decision: "keep", summary: "Оставить", reasons: [], nutritionTips: [] } });
    await raw.coachAcceptances.add({ requestId, payload: acceptance });
    await raw.programState.put({ key: "analysisBaseline", payload: { requestId, programVersionId: active.program.id } });
    const result = await s.analysis.overview(now); expect(result?.baselineKey).toBe(requestId); expect(result?.sessionIds).toEqual([]);
    expect(await s.programs.active()).toEqual(active); expect(await s.programs.list()).toHaveLength(1);
  } }));
  it("без программы нет сигнала; чтение не пишет; manual/snooze переживают reopen", () => runStorageCase({ name: "analysis persistence", async run({ storage: s, raw }) {
    expect(await s.analysis.overview(now)).toBeUndefined(); await seed(s);
    const before = await s.sessions.overview(); const active = await s.programs.active();
    const value = await s.analysis.overview(now); if (!value) throw new Error("Нет анализа");
    expect(value.reasonCodes).toEqual([]); expect(await raw.programState.count()).toBe(2);
    const manual = await s.analysis.act({ kind: "manual", now, expectedToken: value.token }); if (!manual) throw new Error("Нет сигнала");
    expect(manual.reasonCodes).toEqual(["manual"]);
    const deferred = await s.analysis.act({ kind: "snooze", now, expectedToken: manual.token });
    expect(deferred?.remaining).toBe(2); s.close(); await s.open();
    expect(await s.analysis.overview(now)).toEqual(deferred); expect(await s.programs.active()).toEqual(active); expect(await s.sessions.overview()).toEqual(before);
  } }));
  it("две связи/повторы не продлевают отсрочку, stale history/profile блокируют действие", () => runStorageCase({ name: "analysis conflicts", async run({ storage: s, name, track }) {
    await seed(s); const other = track(createTrainingStorage(name)); await other.open();
    const value = await s.analysis.overview(now); if (!value) throw new Error("Нет анализа");
    const results = await Promise.allSettled([s.analysis.act({ kind: "manual", now, expectedToken: value.token }), other.analysis.act({ kind: "manual", now, expectedToken: value.token })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const manual = await s.analysis.overview(now); if (!manual) throw new Error("Нет сигнала");
    await s.profiles.save({ ...profile, revision: 2, goal: "Новая цель" });
    await expect(s.analysis.act({ kind: "snooze", now, expectedToken: manual.token })).rejects.toThrow("Сигнал изменился");
    expect((await s.analysis.overview(now))?.reasonCodes).toEqual(["changed_context", "manual"]);
    const beforeStart = await s.analysis.overview(now); const current = await s.sessions.overview();
    if (!beforeStart || !current.active) throw new Error("Нет программы");
    await s.sessions.start({ sessionId: id(), startedAt: now, expectedCursor: current.active.cursor, expectedHistoryRevision: current.historyRevision });
    await expect(other.analysis.act({ kind: "snooze", now, expectedToken: beforeStart.token })).rejects.toThrow("Сигнал изменился");
  } }));
  it.each(["analysisControl", "analysisSnapshot"])("ошибка put %s откатывает выбор и snapshot", (keyToFail) => runStorageCase({ name: "analysis rollback", async run({ storage: s, raw }) {
    await seed(s); const before = await s.analysis.overview(now); if (!before) throw new Error("Нет анализа");
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) { if (this.name === "programState" && Reflect.get(Object(value), "key") === keyToFail) throw new DOMException("Synthetic quota", "QuotaExceededError"); return key === undefined ? put.call(this, value) : put.call(this, value, key); };
    try { await expect(s.analysis.act({ kind: "manual", now, expectedToken: before.token })).rejects.toThrow(); }
    finally { IDBObjectStore.prototype.put = put; }
    expect(await s.analysis.overview(now)).toEqual(before); expect(await s.sessions.historyRevision()).toBe(0);
    expect(await raw.programState.get("analysisControl")).toBeUndefined(); expect(await raw.programState.get("analysisSnapshot")).toBeUndefined();
  } }));
});
