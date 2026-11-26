import { z } from "zod";
import { bodyStorage } from "./body-storage";
import { backupStorage } from "./backup-storage";
import { privacyStorage } from "./privacy-storage";
import { measurementSelectionSchema, selectMeasurements } from "../model/body-progress";
import { TrainingDatabase, type StoredRevision, type StoredVersion, type StoredSession } from "@/shared/infrastructure/db";
import { profileSchema, type Profile } from "../model/profile";
import { programVersionSchema, programDefinitions, type ProgramVersion } from "../model/program";
import { programFileSchema } from "../model/program-import";
import { workoutSessionSchema, type WorkoutSession } from "../model/session";
import { idSchema, revisionSchema, timestampSchema } from "../model/primitives";
import { coachRequestSchema, createCoachRequest, parseCoachResponseForRequest, PROGRAM_INSTRUCTIONS, type CoachRequest } from "../model/coach-request";
import { coachResponseSchema } from "../model/coach-response";
import { exerciseCatalog, findExercise, mergeExerciseCatalog, type Exercise } from "../model/exercise";
import { createInitialProgramCursor, createProgramVersionFromDraft, programCursorSchema, selectNextWorkout, workoutForPhase, advanceProgramPhase } from "../model/program-sequence";
import { coachAcceptanceSchema } from "../model/coach-acceptance";
import { createWorkoutSession, finishWorkoutSession, finishSessionSchema, historyRevisionSchema, startSessionSchema } from "../model/session-lifecycle";
import { recordSetSchema, recordWorkoutSet } from "../model/set-recording";
import { applySessionAction, sessionActionSchema, skipWorkout, skipWorkoutSchema, timerCommandSchema, updateRestTimer } from "../model/session-actions";
import { analysisControlSchema, analysisSnapshotSchema, evaluateAnalysis } from "../model/analysis";
import { buildReviewHistory } from "../model/review-export";
import { programToDraft } from "../model/program-diff";
import { evaluateProgression } from "../model/progression";
import { buildProgress } from "../model/progress";

export class StorageConflictError extends Error {
  constructor(message: string) { super(message); this.name = "StorageConflictError"; }
}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new StorageConflictError(message);
}

function checkedCatalog(definitions: readonly Exercise[]) {
  try { return mergeExerciseCatalog(definitions); }
  catch (cause) { throw new StorageConflictError(`program.workouts.definition: ${cause instanceof Error ? cause.message : "Конфликт каталога"}`); }
}

function readProfile(row: StoredRevision): Profile {
  const profile = profileSchema.parse(row.payload);
  check(profile.revision === row.revision, "Повреждён ключ ревизии профиля");
  return profile;
}
function readProgram(row: StoredVersion): ProgramVersion {
  const program = programVersionSchema.parse(row.payload);
  check(program.id === row.id && program.revision === row.revision, "Повреждён ключ версии программы");
  return program;
}
function readSession(row: StoredSession): WorkoutSession {
  const session = workoutSessionSchema.parse(row.payload);
  check(session.id === row.id && session.status === row.status, "Повреждён ключ сессии");
  return session;
}

// No singleton, browser access on import, cache, fallback, delete or silent retry.
// Consumers await open() and committed writes; errors retain their original cause.
export function createTrainingStorage(name?: string) {
  const db = new TrainingDatabase(name);
  const body = bodyStorage(db);
  const counterSchema = historyRevisionSchema;

  async function currentProfile() {
    const row = await db.profileRevisions.orderBy("revision").last();
    return row === undefined ? undefined : readProfile(row);
  }
  async function historyRevision() {
    return db.transaction("r", db.sessions, db.counters, async () => {
      const row = await db.counters.get("historyRevision");
      if (row !== undefined) return counterSchema.parse(row.value);
      check(await db.sessions.count() === 0, "Отсутствует ревизия сохранённой истории");
      return 0;
    });
  }

  async function activeProgram() {
    const row = await db.programState.get("activeProgram");
    if (!row) return undefined;
    const cursor = programCursorSchema.parse(row.payload);
    const version = await db.programVersions.get(cursor.programVersionId);
    check(version !== undefined, "Активная версия программы не найдена");
    const program = readProgram(version);
    return Object.freeze({ program, cursor, workout: selectNextWorkout(program, cursor) });
  }
  async function readAcceptance(requestId: string) {
    const row = await db.coachAcceptances.get(idSchema.parse(requestId));
    if (!row) return undefined;
    const acceptance = coachAcceptanceSchema.parse(row.payload);
    check(acceptance.requestId === row.requestId, "Повреждён ключ подтверждения");
    return acceptance;
  }
  const sessionTables = [db.programVersions, db.programState, db.sessions, db.counters];
  async function activeSession() {
    const rows = await db.sessions.where("status").equals("active").toArray();
    check(rows.length <= 1, "Найдено несколько активных занятий. Данные не изменены.");
    if (!rows[0]) return undefined;
    const session = readSession(rows[0]);
    const version = await db.programVersions.get(session.programVersionId);
    check(version !== undefined && JSON.stringify(workoutForPhase(readProgram(version), session.templateId, session.phaseIndex)) === JSON.stringify(session.plannedSnapshot),
      "Снимок активного занятия не соответствует сохранённой программе");
    return session;
  }
  async function requireCurrentSession(sessionId: string) {
    const session = await activeSession();
    check(session?.id === sessionId, "Активное занятие изменилось. Посмотрите текущий шаг.");
    const current = await activeProgram();
    check(current?.program.id === session.programVersionId && current.workout.id === session.templateId, "Позиция программы не соответствует занятию");
    return session;
  }
  async function checkContext(request: CoachRequest) {
    check(await readAcceptance(request.requestId) === undefined, "Этот запрос уже принят. Повторное применение запрещено.");
    const savedRequest = await db.coachRequests.get(request.requestId);
    if (request.measurements !== undefined) {
      check(savedRequest === undefined || (savedRequest.measurementRevision !== undefined
        && savedRequest.measurementRevision === await body.revision()), "Замеры изменились. Скачайте новый запрос.");
    }
    const profile = await currentProfile();
    check(profile?.revision === request.context.profileRevision, "Профиль изменился. Скачайте новый запрос.");
    check(await historyRevision() === request.context.historyRevision, "История изменилась. Скачайте новый запрос.");
    check(await db.sessions.where("status").equals("active").count() === 0, "Сначала завершите активное занятие.");
    const active = await activeProgram();
    check((active?.program.id ?? null) === request.context.programVersionId, "Активная программа изменилась. Скачайте новый запрос.");
    if (request.mode === "initial") {
      check(await db.programVersions.count() === 0 && await db.sessions.count() === 0,
        "Начальный обмен доступен до первой программы. Повторный анализ появится позже.");
    } else {
      check(active !== undefined, "Для анализа нужна активная программа");
      check(JSON.stringify(request.programPosition) === JSON.stringify(active.cursor.phaseIndex === undefined ? undefined : { phaseIndex: active.cursor.phaseIndex, phaseSessions: active.cursor.phaseSessions ?? 0 }), "Этап программы изменился. Скачайте новый запрос.");
      check(JSON.stringify(active.program) === JSON.stringify(request.program), "Снимок запроса не соответствует активной программе. Скачайте новый запрос.");
      const saved = await db.coachRequests.get(request.requestId);
      // Old review exports lack provenance. Keep them intact and require a
      // fresh explicit export rather than guessing their analysis baseline.
      if (saved) {
        check(saved.baselineKey !== undefined, "У запроса нет baseline анализа. Скачайте новый запрос.");
        const overview = await analysisOverview(request.createdAt);
        check(idSchema.parse(saved.baselineKey) === overview?.baselineKey, "Анализ уже принят в другой вкладке. Скачайте новый запрос.");
      }
    }
  }
  const exchangeTables = [db.bodyMeasurements, db.profileRevisions, db.programVersions, db.sessions, db.counters, db.coachRequests, db.coachResponses, db.programState, db.coachAcceptances];
  async function programImportContext() {
    const profile = await currentProfile();
    check(profile !== undefined, "Сначала сохраните профиль.");
    check(await db.sessions.where("status").equals("active").count() === 0, "Сначала завершите активное занятие.");
    const active = await activeProgram();
    const last = await db.programVersions.orderBy("revision").last();
    const previous = last === undefined ? undefined : readProgram(last);
    check((active?.program.id ?? null) === (previous?.id ?? null), "Цепочка активной программы изменилась.");
    const baseline = await db.programState.get("analysisBaseline");
    return { profile, previous, before: active?.program,
      token: JSON.stringify([profile.id, profile.revision, previous?.id ?? null, active?.cursor ?? null, await historyRevision(), baseline?.payload ?? null]) };
  }

  function checkImportedEquipment(file: ReturnType<typeof programFileSchema.parse>, profile: Profile) {
    for (const workout of file.program.workouts) for (const row of workout.exercises) {
      const exercise = findExercise(row.exerciseId, row.definition);
      check(exercise !== undefined && exercise.equipment.every((item) => profile.equipment.includes(item)),
        `Проверьте оборудование в профиле для упражнения «${exercise?.name ?? row.exerciseId}». План не изменён.`);
    }
  }
  async function readRequest(requestId: string) {
    const row = await db.coachRequests.get(idSchema.parse(requestId));
    check(row !== undefined, "Запрос не найден на этом устройстве. Скачайте новый запрос.");
    const request = coachRequestSchema.parse(row.payload);
    check(request.requestId === row.requestId, "Повреждён ключ AI-запроса");
    return request;
  }

  async function analysisOverview(now: string) {
    timestampSchema.parse(now);
    const profile = await currentProfile();
    const active = await activeProgram();
    if (!profile || !active) return undefined;
    const acceptances = (await db.coachAcceptances.toArray()).map((row) => {
      const value = coachAcceptanceSchema.parse(row.payload);
      check(value.requestId === row.requestId, "Повреждён ключ подтверждения анализа");
      return value;
    }).filter((value) => value.programVersionId === active.program.id)
      .sort((a, b) => Date.parse(b.acceptedAt) - Date.parse(a.acceptedAt) || b.requestId.localeCompare(a.requestId));
    const baselineRow = await db.programState.get("analysisBaseline");
    const baseline = baselineRow ? z.strictObject({ programVersionId: idSchema, requestId: idSchema }).parse(baselineRow.payload) : undefined;
    const acceptance = baseline?.programVersionId === active.program.id
      ? acceptances.find((value) => value.requestId === baseline.requestId) : acceptances[0];
    check(baseline?.programVersionId !== active.program.id || acceptance !== undefined, "Принятый baseline анализа не найден");
    const baselineRevision = acceptance?.response.context.profileRevision ?? active.program.profileRevision;
    const row = await db.profileRevisions.get(baselineRevision);
    check(row !== undefined, "Профиль принятого анализа не найден");
    const controlRow = await db.programState.get("analysisControl");
    const control = controlRow ? analysisControlSchema.parse(controlRow.payload) : undefined;
    const result = evaluateAnalysis({ now, profile, baselineProfile: readProfile(row), program: active.program, acceptance,
      sessions: (await db.sessions.toArray()).map(readSession), control });
    const token = JSON.stringify([result.baselineKey, profile.revision, await historyRevision(), control ?? null, active.cursor]);
    return Object.freeze({ ...result, token, profileRevision: profile.revision, baselineProfileRevision: baselineRevision });
  }
  async function captureAnalysis(current: NonNullable<Awaited<ReturnType<typeof analysisOverview>>>) {
    const snapshot = analysisSnapshotSchema.parse({ baselineKey: current.baselineKey, profileRevision: current.profileRevision,
      baselineProfileRevision: current.baselineProfileRevision, reasonCodes: current.reasonCodes,
      facts: current.signals.flatMap((signal) => signal.evidence) });
    const previous = await db.programState.get("analysisSnapshot");
    if (previous && JSON.stringify(analysisSnapshotSchema.parse(previous.payload)) === JSON.stringify(snapshot)) return;
    await db.programState.put({ key: "analysisSnapshot", payload: structuredClone(snapshot) });
  }

  return {
    backup: backupStorage(db),
    privacy: privacyStorage(db),
    body,
    async open(): Promise<void> { await db.open(); },
    close(): void { db.close(); },
    progress: {
      async overview() {
        return db.transaction("r", db.profileRevisions, db.programVersions, db.sessions, db.counters, async () => {
          const profile = await currentProfile();
          const sessions = (await db.sessions.toArray()).map(readSession);
          const versions = new Map((await db.programVersions.toArray()).map((row) => {
            const version = readProgram(row); return [version.id, version];
          }));
          check(sessions.every((session) => JSON.stringify(workoutForPhase(versions.get(session.programVersionId), session.templateId, session.phaseIndex))
            === JSON.stringify(session.plannedSnapshot)), "История не соответствует сохранённым версиям программы.");
          return { goal: profile?.goal ?? null, historyRevision: await historyRevision(), ...buildProgress(sessions) };
        });
      },
    },
    analysis: {
      async overview(now: string) { return db.transaction("r", exchangeTables, () => analysisOverview(now)); },
      // Reconciles one local indicator, never queues duplicate notifications.
      // Explicit effect/action boundary; read-only overview remains write-free.
      async refresh(now: string) {
        return db.write(exchangeTables, async () => {
          const current = await analysisOverview(now);
          if (current) await captureAnalysis(current);
          return current;
        });
      },
      async act(input: unknown) {
        const command = z.strictObject({ kind: z.enum(["manual", "snooze"]), now: timestampSchema, expectedToken: z.string().min(1) }).parse(input);
        return db.write(exchangeTables, async () => {
          const current = await analysisOverview(command.now);
          check(current !== undefined && current.token === command.expectedToken, "Сигнал изменился. Посмотрите актуальные причины и повторите действие.");
          check(command.kind === "manual" || (current.needsAnalysis && !current.reasonCodes.includes("safety")), "Этот сигнал нельзя отложить");
          const control = analysisControlSchema.parse({ baselineKey: current.baselineKey,
            manual: command.kind === "manual" || current.reasonCodes.includes("manual"),
            snooze: command.kind === "manual" ? null : { sessionIds: current.sessionIds, signalKeys: current.signals.map((signal) => signal.key) } });
          await db.programState.put({ key: "analysisControl", payload: structuredClone(control) });
          const result = await analysisOverview(command.now);
          if (result) await captureAnalysis(result);
          return result;
        });
      },
    },
    coach: {
      async nutrition() {
        return db.transaction("r", exchangeTables, async () => {
          const empty: readonly string[] = [];
          const profile = await currentProfile();
          if (!profile?.nutritionOptIn) return { enabled: false, tips: empty };
          const overview = await analysisOverview(new Date().toISOString());
          const accepted = overview ? await readAcceptance(overview.baselineKey) : undefined;
          // The baseline, not the newest export or timestamp, selects the package.
          // A rollback has no acceptance; changed profile advice needs a new review.
          if (!accepted || accepted.response.context.profileRevision !== profile.revision) {
            return { enabled: true, tips: empty };
          }
          const request = await readRequest(accepted.requestId);
          const response = parseCoachResponseForRequest(accepted.response, request);
          return { enabled: true, tips: response.nutritionTips, acceptedAt: accepted.acceptedAt };
        });
      },
      async createReviewRequest(requestId: string, createdAt: string, expectedToken: string, measurementKinds: unknown = []) {
        return db.write(exchangeTables, async () => {
          const analysis = await analysisOverview(createdAt);
          check(analysis !== undefined && analysis.token === expectedToken, "Контекст анализа изменился. Обновите страницу и повторите экспорт.");
          const profile = await currentProfile();
          const active = await activeProgram();
          check(profile !== undefined && active !== undefined, "Для повторного анализа нужны профиль и активная программа.");
          const baseline = await readAcceptance(analysis.baselineKey);
          check(Date.parse(createdAt) >= Date.parse(baseline?.acceptedAt ?? active.program.createdAt), "Время запроса раньше принятого анализа. Проверьте часы устройства.");
          const { goal, experience, sessionsPerWeek, equipment, details, nutritionOptIn } = profile;
          const sessions = (await db.sessions.toArray()).map(readSession);
          const versions = new Map((await db.programVersions.toArray()).map((row) => { const version = readProgram(row); return [version.id, version]; }));
          check(sessions.every((session) => JSON.stringify(workoutForPhase(versions.get(session.programVersionId), session.templateId, session.phaseIndex))
            === JSON.stringify(session.plannedSnapshot)), "История не соответствует сохранённым версиям программы.");
          // Reject future facts rather than silently exporting a partial history.
          check(sessions.every((session) => Date.parse(session.startedAt) <= Date.parse(createdAt)
            && (session.endedAt === null || Date.parse(session.endedAt) <= Date.parse(createdAt))), "История содержит будущие даты. Проверьте часы устройства.");
          const request = createCoachRequest({ schemaVersion: 1, kind: "coach_request", requestId, createdAt, mode: "review",
            context: { profileRevision: profile.revision, programVersionId: active.program.id, historyRevision: await historyRevision() },
            ...(measurementSelectionSchema.parse(measurementKinds).length ? {
              measurements: selectMeasurements(await body.listMeasurements(), measurementKinds, createdAt),
            } : {}),
            profile: { goal, experience, sessionsPerWeek, equipment, details, nutritionOptIn }, program: active.program,
            programInstructions: PROGRAM_INSTRUCTIONS,
            ...(active.cursor.phaseIndex !== undefined ? { programPosition: { phaseIndex: active.cursor.phaseIndex, phaseSessions: active.cursor.phaseSessions ?? 0 } } : {}),
            ...buildReviewHistory(sessions), reasonCodes: [...new Set([...analysis.reasonCodes, "manual"])], exerciseCatalog: checkedCatalog([...versions.values()].flatMap(programDefinitions)) });
          await checkContext(request);
          await db.coachRequests.add({ requestId: request.requestId, payload: structuredClone(request), baselineKey: analysis.baselineKey,
            ...(request.measurements === undefined ? {} : { measurementRevision: await body.revision() }) });
          return request;
        });
      },
      async createInitialRequest(requestId: string, createdAt: string, measurementKinds: unknown = []) {
        return db.write(exchangeTables, async () => {
          const profile = await currentProfile();
          check(profile !== undefined, "Сначала сохраните профиль.");
          const { goal, experience, sessionsPerWeek, equipment, details, nutritionOptIn } = profile;
          const request = createCoachRequest({ schemaVersion: 1, kind: "coach_request", requestId, createdAt,
            mode: "initial", context: { profileRevision: profile.revision, programVersionId: null, historyRevision: await historyRevision() },
            ...(measurementSelectionSchema.parse(measurementKinds).length ? {
              measurements: selectMeasurements(await body.listMeasurements(), measurementKinds, createdAt),
            } : {}),
            profile: { goal, experience, sessionsPerWeek, equipment, details, nutritionOptIn }, program: null,
            programInstructions: PROGRAM_INSTRUCTIONS, recentSessions: [], historySummary: [], reasonCodes: ["initial"], exerciseCatalog });
          await checkContext(request);
          await db.coachRequests.add({ requestId: request.requestId, payload: structuredClone(request),
            ...(request.measurements === undefined ? {} : { measurementRevision: await body.revision() }) });
          return request;
        });
      },
      async getRequest(requestId: string) { return readRequest(requestId); },
      async importResponse(input: unknown) {
        const parsed = coachResponseSchema.parse(input);
        return db.write(exchangeTables, async () => {
          const request = await readRequest(parsed.requestId);
          const response = parseCoachResponseForRequest(parsed, request);
          await checkContext(request);
          // One pending response per request. Reimport never creates a program,
          // version or history entry. A newer answer can replace the preview.
          await db.coachResponses.put({ requestId: request.requestId, payload: structuredClone(response) });
          return response;
        });
      },
      async preview(requestId: string) {
        return db.transaction("r", exchangeTables, async () => {
          const request = await readRequest(requestId);
          await checkContext(request);
          const row = await db.coachResponses.get(request.requestId);
          if (!row) return undefined;
          check(row.requestId === request.requestId, "Повреждён ключ AI-ответа");
          return parseCoachResponseForRequest(row.payload, request);
        });
      },
      async acceptance(requestId: string) { return readAcceptance(requestId); },
      // The caller passes the exact preview it displayed. Never accept a newer
      // response silently when another tab replaced that preview.
      async accept(input: unknown, acceptedAtInput: unknown, reviewAcknowledged: unknown) {
        const expected = coachResponseSchema.parse(input);
        const acceptedAt = timestampSchema.parse(acceptedAtInput);
        z.literal(true).parse(reviewAcknowledged);
        return db.write(exchangeTables, async () => {
          const request = await readRequest(expected.requestId);
          await checkContext(request);
          const row = await db.coachResponses.get(request.requestId);
          check(row !== undefined, "Предпросмотр не найден. Импортируйте ответ заново.");
          const response = parseCoachResponseForRequest(row.payload, request);
          check(JSON.stringify(response) === JSON.stringify(parseCoachResponseForRequest(expected, request)), "Предпросмотр изменился в другой вкладке. Откройте его заново.");
          check(response.decision === "propose_program" || response.decision === "keep", "Это решение нельзя применить как программу.");
          check(Date.parse(acceptedAt) >= Date.parse(request.createdAt), "Время подтверждения раньше запроса. Проверьте часы устройства.");
          if (request.mode === "review") {
            const stored = await db.coachRequests.get(request.requestId);
            const baseline = stored?.baselineKey === undefined ? undefined : await readAcceptance(idSchema.parse(stored.baselineKey));
            check(baseline === undefined || Date.parse(acceptedAt) >= Date.parse(baseline.acceptedAt), "Время подтверждения раньше принятого анализа.");
          }
          let programVersionId: string;
          if (response.decision === "propose_program") {
            const last = await db.programVersions.orderBy("revision").last();
            const previous = last === undefined ? undefined : readProgram(last);
            check(previous === undefined || Date.parse(acceptedAt) >= Date.parse(previous.createdAt), "Новая версия создана раньше предыдущей");
            const program = createProgramVersionFromDraft(response.proposedProgram, {
              id: crypto.randomUUID(), revision: (previous?.revision ?? 0) + 1, previousId: previous?.id ?? null,
              profileRevision: request.context.profileRevision, createdAt: acceptedAt,
            }, () => crypto.randomUUID());
            await db.programVersions.add({ id: program.id, revision: program.revision, payload: structuredClone(program) });
            await db.programState.put({ key: "activeProgram", payload: structuredClone(createInitialProgramCursor(program)) });
            programVersionId = program.id;
          } else {
            const active = await activeProgram();
            check(active !== undefined, "Текущая программа отсутствует");
            programVersionId = active.program.id;
          }
          const acceptance = coachAcceptanceSchema.parse({ requestId: request.requestId, status: "accepted", acceptedAt, reviewAcknowledged,
            programVersionId, response });
          await db.coachAcceptances.add({ requestId: request.requestId, payload: structuredClone(acceptance) });
          await db.programState.put({ key: "analysisBaseline", payload: { programVersionId, requestId: request.requestId } });
          return acceptance;
        });
      },
      async reject(input: unknown) {
        const expected = coachResponseSchema.parse(input);
        return db.write(exchangeTables, async () => {
          const request = await readRequest(expected.requestId);
          check(await readAcceptance(request.requestId) === undefined, "Принятый пакет нельзя отклонить");
          const row = await db.coachResponses.get(request.requestId);
          check(row !== undefined && JSON.stringify(parseCoachResponseForRequest(row.payload, request)) === JSON.stringify(parseCoachResponseForRequest(expected, request)),
            "Предпросмотр изменился. Откройте его заново.");
          await db.coachResponses.delete(request.requestId);
        });
      },
      async latestRequest() {
        return db.transaction("r", exchangeTables, async () => {
          const rows = await db.coachRequests.toArray();
          const requests = rows.map((row) => {
            const request = coachRequestSchema.parse(row.payload);
            check(row.requestId === request.requestId, "Повреждён ключ AI-запроса");
            return request;
          });
          return requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.requestId.localeCompare(a.requestId))[0];
        });
      },
    },
    profiles: {
      current: currentProfile,
      async get(revision: number) {
        const row = await db.profileRevisions.get(revisionSchema.parse(revision));
        return row === undefined ? undefined : readProfile(row);
      },
      async save(input: unknown): Promise<Profile> {
        const profile = profileSchema.parse(input);
        return db.write([db.profileRevisions], async () => {
          const previous = await currentProfile();
          check(profile.revision === (previous?.revision ?? 0) + 1, "Профиль изменён в другой вкладке или нарушен порядок ревизий");
          check(previous === undefined || previous.id === profile.id, "Нельзя заменить идентификатор профиля");
          // structuredClone removes readonly descriptors, not values. Readback
          // always revalidates and freezes the domain value with its own schema.
          await db.profileRevisions.add({ revision: profile.revision, payload: structuredClone(profile) });
          return profile;
        });
      },
    },
    programs: {
      async advancePhase(input: unknown) {
        const command = z.strictObject({ expectedCursor: programCursorSchema, expectedHistoryRevision: historyRevisionSchema, confirmed: z.literal(true) }).parse(input);
        return db.write(sessionTables, async () => {
          const active = await activeProgram();
          check(active !== undefined && JSON.stringify(active.cursor) === JSON.stringify(command.expectedCursor)
            && await historyRevision() === command.expectedHistoryRevision, "Программа или история изменились. Посмотрите этап заново.");
          check(await db.sessions.where("status").equals("active").count() === 0, "Сначала завершите активное занятие.");
          let cursor;
          try { cursor = advanceProgramPhase(active.program, active.cursor); }
          catch (cause) { throw new StorageConflictError(cause instanceof Error ? cause.message : "Не удалось сменить этап"); }
          await db.programState.put({ key: "activeProgram", payload: structuredClone(cursor) });
          return cursor;
        });
      },
      async previewImport(input: unknown) {
        const file = programFileSchema.parse(input);
        return db.transaction("r", exchangeTables, async () => {
          const context = await programImportContext();
          checkImportedEquipment(file, context.profile);
          const definitions = (await db.programVersions.toArray()).flatMap((v) => programDefinitions(readProgram(v)));
          checkedCatalog([...definitions, ...programDefinitions(file.program)]);
          const knownIds = new Set(checkedCatalog(definitions).map((e) => e.id));
          const newExercises = checkedCatalog(programDefinitions(file.program)).filter((e) => !knownIds.has(e.id));
          return Object.freeze({ file, before: context.before, token: context.token, newExercises });
        });
      },
      async applyImport(input: unknown) {
        const command = z.strictObject({ file: programFileSchema, expectedToken: z.string().min(1),
          createdAt: timestampSchema, reviewAcknowledged: z.literal(true), newExercisesAcknowledged: z.boolean().optional() }).parse(input);
        return db.write(exchangeTables, async () => {
          const context = await programImportContext();
          check(context.token === command.expectedToken, "Профиль, программа или история изменились. Отправьте файл на проверку заново.");
          checkImportedEquipment(command.file, context.profile);
          const definitions = (await db.programVersions.toArray()).flatMap((v) => programDefinitions(readProgram(v)));
          checkedCatalog([...definitions, ...programDefinitions(command.file.program)]);
          const knownIds = new Set(checkedCatalog(definitions).map((e) => e.id));
          check(programDefinitions(command.file.program).every((e) => knownIds.has(e.id)) || command.newExercisesAcknowledged === true, "Подтвердите добавление новых упражнений.");
          check(context.previous === undefined || Date.parse(command.createdAt) >= Date.parse(context.previous.createdAt), "Новая версия создана раньше предыдущей. Проверьте часы устройства.");
          const program = createProgramVersionFromDraft(command.file.program, {
            id: crypto.randomUUID(), revision: (context.previous?.revision ?? 0) + 1,
            previousId: context.previous?.id ?? null, profileRevision: context.profile.revision, createdAt: command.createdAt,
          }, () => crypto.randomUUID());
          await db.programVersions.add({ id: program.id, revision: program.revision, payload: structuredClone(program) });
          await db.programState.put({ key: "activeProgram", payload: structuredClone(createInitialProgramCursor(program)) });
          return program;
        });
      },
      async rollback(input: unknown) {
        const command = z.strictObject({ sourceId: idSchema, expectedToken: z.string().min(1),
          createdAt: timestampSchema, reviewAcknowledged: z.literal(true) }).parse(input);
        return db.write(exchangeTables, async () => {
          const overview = await analysisOverview(command.createdAt);
          check(overview !== undefined && overview.token === command.expectedToken, "Контекст изменился. Откройте возврат заново.");
          check(await db.sessions.where("status").equals("active").count() === 0, "Сначала завершите активное занятие.");
          const active = await activeProgram();
          const sourceRow = await db.programVersions.get(command.sourceId);
          check(active !== undefined && sourceRow !== undefined && active.program.id !== command.sourceId, "Выберите сохранённую прежнюю версию.");
          const source = readProgram(sourceRow);
          check(source.revision < active.program.revision, "Возврат доступен только к прежней версии.");
          const latest = await db.programVersions.orderBy("revision").last();
          check(latest !== undefined && latest.id === active.program.id, "Цепочка активной программы изменилась.");
          const baseline = await readAcceptance(overview.baselineKey);
          check(baseline === undefined || Date.parse(command.createdAt) >= Date.parse(baseline.acceptedAt), "Время возврата раньше принятого анализа.");
          check(Date.parse(command.createdAt) >= Date.parse(active.program.createdAt), "Новая версия создана раньше предыдущей");
          const program = createProgramVersionFromDraft(programToDraft(source), { id: crypto.randomUUID(),
            revision: active.program.revision + 1, previousId: active.program.id,
            profileRevision: overview.profileRevision, createdAt: command.createdAt }, () => crypto.randomUUID());
          const restored = programVersionSchema.parse({ ...program, ...(source.notes === undefined ? {} : { notes: source.notes }) });
          await db.programVersions.add({ id: restored.id, revision: restored.revision, payload: structuredClone(restored) });
          await db.programState.put({ key: "activeProgram", payload: structuredClone(createInitialProgramCursor(restored)) });
          return restored;
        });
      },
      async active() { return db.transaction("r", db.programState, db.programVersions, activeProgram); },
      async get(id: string) {
        const row = await db.programVersions.get(idSchema.parse(id));
        return row === undefined ? undefined : readProgram(row);
      },
      async list(): Promise<readonly ProgramVersion[]> {
        return Object.freeze((await db.programVersions.orderBy("revision").toArray()).map(readProgram));
      },
      // Persistence only. Activation must use coach.accept's single transaction.
      async append(input: unknown): Promise<ProgramVersion> {
        const program = programVersionSchema.parse(input);
        return db.write([db.profileRevisions, db.programVersions], async () => {
          const profile = await currentProfile();
          check(profile?.revision === program.profileRevision, "Версия профиля устарела или отсутствует");
          const row = await db.programVersions.orderBy("revision").last();
          const previous = row === undefined ? undefined : readProgram(row);
          check(program.revision === (previous?.revision ?? 0) + 1 && program.previousId === (previous?.id ?? null), "Нарушена цепочка версий программы");
          check(previous === undefined || Date.parse(program.createdAt) >= Date.parse(previous.createdAt), "Новая версия создана раньше предыдущей");
          checkedCatalog([...(await db.programVersions.toArray()).flatMap((v) => programDefinitions(readProgram(v))), ...programDefinitions(program)]);
          await db.programVersions.add({ id: program.id, revision: program.revision, payload: structuredClone(program) });
          return program;
        });
      },
    },
    sessions: {
      historyRevision,
      async action(input: unknown) {
        const command = sessionActionSchema.parse(input);
        return db.write(sessionTables, async () => {
          const row = await db.sessions.get(command.sessionId);
          check(row !== undefined, "Занятие не найдено");
          const previous = readSession(row);
          const version = await db.programVersions.get(previous.programVersionId);
          check(version !== undefined && JSON.stringify(workoutForPhase(readProgram(version), previous.templateId, previous.phaseIndex)) === JSON.stringify(previous.plannedSnapshot), "Снимок занятия не соответствует программе");
          const replay = command.kind === "replace"
            ? previous.replacements?.some((item) => JSON.stringify(item) === JSON.stringify(command.replacement))
            : command.sets.every((set) => previous.sets.some((item) => JSON.stringify(item) === JSON.stringify(set)));
          if (replay) return previous;
          await requireCurrentSession(command.sessionId);
          const revision = await historyRevision();
          check(revision === command.expectedHistoryRevision, "История изменилась. Посмотрите сохранённые факты перед действием.");
          let session: WorkoutSession;
          try { session = applySessionAction(previous, command); }
          catch (cause) { throw new StorageConflictError(cause instanceof Error ? cause.message : "Не удалось проверить действие"); }
          await db.sessions.put({ id: session.id, status: session.status, payload: structuredClone(session) });
          await db.counters.put({ key: "historyRevision", value: counterSchema.parse(revision + 1) });
          return session;
        });
      },
      async timer(input: unknown) {
        const command = timerCommandSchema.parse(input);
        return db.write(sessionTables, async () => {
          const previous = await requireCurrentSession(command.sessionId);
          if (JSON.stringify(previous.restTimer ?? null) === JSON.stringify(command.timer)) return previous;
          let session: WorkoutSession;
          try { session = updateRestTimer(previous, command); }
          catch (cause) { throw new StorageConflictError(cause instanceof Error ? cause.message : "Не удалось сохранить таймер"); }
          // Timer is local UI timing, not a training fact: no historyRevision bump.
          await db.sessions.put({ id: session.id, status: session.status, payload: structuredClone(session) });
          return session;
        });
      },
      async skipWorkout(input: unknown) {
        const command = skipWorkoutSchema.parse(input);
        return db.write(sessionTables, async () => {
          const row = await db.sessions.get(command.sessionId);
          if (row) {
            const previous = readSession(row);
            const version = await db.programVersions.get(previous.programVersionId);
            check(previous.status === "skipped" && version !== undefined
              && previous.programVersionId === command.expectedCursor.programVersionId
              && previous.templateId === selectNextWorkout(readProgram(version), command.expectedCursor).id
              && JSON.stringify(previous.plannedSnapshot) === JSON.stringify(selectNextWorkout(readProgram(version), command.expectedCursor))
              && previous.startedAt === command.startedAt, "Этот ID уже принадлежит другому событию");
            return previous;
          }
          check(await activeSession() === undefined, "Сначала завершите или продолжите активное занятие. Его факты не будут удалены.");
          const current = await activeProgram();
          check(current !== undefined && JSON.stringify(current.cursor) === JSON.stringify(command.expectedCursor), "Порядок изменился. Посмотрите следующее занятие.");
          const revision = await historyRevision();
          check(revision === command.expectedHistoryRevision, "История изменилась. Подтвердите пропуск заново.");
          const result = skipWorkout(current.program, command);
          await db.sessions.add({ id: result.session.id, status: result.session.status, payload: structuredClone(result.session) });
          await db.programState.put({ key: "activeProgram", payload: structuredClone(result.cursor) });
          await db.counters.put({ key: "historyRevision", value: counterSchema.parse(revision + 1) });
          return result.session;
        });
      },
      async recordSet(input: unknown) {
        const command = recordSetSchema.parse(input);
        return db.write(sessionTables, async () => {
          const row = await db.sessions.get(command.set.sessionId);
          check(row !== undefined, "Занятие не найдено");
          const previous = readSession(row);
          const version = await db.programVersions.get(previous.programVersionId);
          check(version !== undefined && JSON.stringify(workoutForPhase(readProgram(version), previous.templateId, previous.phaseIndex)) === JSON.stringify(previous.plannedSnapshot), "Снимок занятия не соответствует программе");
          // Exact retry after commit is a read, including after finish. Never
          // replay over a newer correction, or create a second slot/ID.
          const saved = previous.sets.find((set) => set.id === command.set.id);
          if (JSON.stringify(saved) === JSON.stringify(command.set)) return previous;
          const revision = await historyRevision();
          check(revision === command.expectedHistoryRevision, "История изменилась. Проверьте сохранённые подходы и повторите; ваш ввод сохранён на экране.");
          if (previous.status === "active") {
            check((await activeSession())?.id === previous.id, "Активное занятие изменилось");
            const current = await activeProgram();
            check(current?.program.id === previous.programVersionId && current.workout.id === previous.templateId, "Позиция программы не соответствует занятию");
          }
          let session: WorkoutSession;
          try { session = recordWorkoutSet(previous, command); }
          catch (cause) { throw new StorageConflictError(cause instanceof Error ? cause.message : "Не удалось проверить подход"); }
          const next = counterSchema.parse(revision + 1);
          await db.sessions.put({ id: session.id, status: session.status, payload: structuredClone(session) });
          await db.counters.put({ key: "historyRevision", value: next });
          return session;
        });
      },
      async overview() {
        return db.transaction("r", sessionTables, async () => Object.freeze({
          active: await activeProgram(), session: await activeSession(), historyRevision: await historyRevision(),
          progression: await (async () => { const active = await activeProgram(); return active ? evaluateProgression(active.program, (await db.sessions.toArray()).map(readSession), active.cursor.phaseIndex) : []; })(),
        }));
      },
      async start(input: unknown) {
        const command = startSessionSchema.parse(input);
        return db.write(sessionTables, async () => {
          const existing = await db.sessions.get(command.sessionId);
          if (existing) {
            const session = readSession(existing);
            check(session.status !== "skipped", "Этот ID принадлежит пропуску занятия");
            const version = await db.programVersions.get(session.programVersionId);
            check(version !== undefined && session.templateId === selectNextWorkout(readProgram(version), command.expectedCursor).id
              && session.programVersionId === command.expectedCursor.programVersionId && session.startedAt === command.startedAt,
              "Этот ID уже принадлежит другому занятию");
            return session; // Replay never reopens a finished session.
          }
          const current = await activeProgram();
          check(current !== undefined, "Сначала примите программу");
          check(JSON.stringify(current.cursor) === JSON.stringify(command.expectedCursor), "Порядок изменился. Посмотрите следующее занятие заново.");
          const active = await activeSession();
          if (active) {
            check(active.programVersionId === current.program.id && active.templateId === current.workout.id, "Активное занятие относится к другой позиции программы");
            return active; // Two tabs start/resume the same existing session.
          }
          const revision = await historyRevision();
          check(revision === command.expectedHistoryRevision, "История изменилась. Обновите экран перед стартом.");
          const session = createWorkoutSession(current.program, command);
          const next = counterSchema.parse(revision + 1);
          await db.sessions.add({ id: session.id, status: session.status, payload: structuredClone(session) });
          await db.counters.put({ key: "historyRevision", value: next });
          return session;
        });
      },
      async finish(input: unknown) {
        const command = finishSessionSchema.parse(input);
        return db.write(sessionTables, async () => {
          const row = await db.sessions.get(command.sessionId);
          check(row !== undefined, "Занятие не найдено");
          const previous = readSession(row);
          if (previous.status !== "active") return previous; // Exactly once, even after a later session starts.
          check((await activeSession())?.id === previous.id, "Активное занятие изменилось");
          const revision = await historyRevision();
          check(revision === command.expectedHistoryRevision, "Результаты изменились в другой вкладке. Посмотрите их перед завершением.");
          const current = await activeProgram();
          check(current !== undefined, "Не найдена активная программа занятия");
          const result = finishWorkoutSession(current.program, current.cursor, previous, command.endedAt);
          const next = counterSchema.parse(revision + 1);
          await db.sessions.put({ id: previous.id, status: result.session.status, payload: structuredClone(result.session) });
          await db.programState.put({ key: "activeProgram", payload: structuredClone(result.cursor) });
          await db.counters.put({ key: "historyRevision", value: next });
          return result.session;
        });
      },
      async get(id: string) {
        const row = await db.sessions.get(idSchema.parse(id));
        return row === undefined ? undefined : readSession(row);
      },
      async list(): Promise<readonly WorkoutSession[]> {
        return Object.freeze((await db.sessions.toArray()).map(readSession));
      },
      // Low-level atomic snapshot replacement, not a start/log/finish action.
      // Expected global revision protects edits made by independent connections.
      async save(input: unknown, expectedHistoryRevision: number): Promise<number> {
        const session = workoutSessionSchema.parse(input);
        counterSchema.parse(expectedHistoryRevision);
        return db.write([db.programVersions, db.programState, db.sessions, db.counters], async () => {
          const revision = await historyRevision();
          check(revision === expectedHistoryRevision, "История изменена в другой вкладке");
          const programRow = await db.programVersions.get(session.programVersionId);
          check(programRow !== undefined, "Версия программы не найдена");
          const template = workoutForPhase(readProgram(programRow), session.templateId, session.phaseIndex);
          check(JSON.stringify(template) === JSON.stringify(session.plannedSnapshot), "Снимок не соответствует сохранённой версии программы");
          const row = await db.sessions.get(session.id);
          check(session.status !== "skipped" || row !== undefined, "Пропускайте занятие через sessions.skipWorkout, вместе с курсором");
          if (row !== undefined) {
            const previous = readSession(row);
            check(previous.programVersionId === session.programVersionId && previous.templateId === session.templateId && previous.startedAt === session.startedAt, "Нельзя заменить источник исторической сессии");
            check(previous.status === "active" || (previous.status === session.status && previous.endedAt === session.endedAt), "Нельзя повторно завершить или открыть историческую сессию");
            if (previous.status === "active" && session.status !== "active") {
              const active = await activeProgram();
              check(active?.program.id !== session.programVersionId, "Завершайте активную тренировку через sessions.finish, вместе с курсором");
            }
          }
          if (session.status === "active") {
            const active = await db.sessions.where("status").equals("active").toArray();
            check(active.every((item) => readSession(item).id === session.id), "Уже есть активное занятие");
          }
          const next = counterSchema.parse(revision + 1);
          await db.sessions.put({ id: session.id, status: session.status, payload: structuredClone(session) });
          await db.counters.put({ key: "historyRevision", value: next });
          return next;
        });
      },
    },
  };
}

export type TrainingStorage = ReturnType<typeof createTrainingStorage>;
