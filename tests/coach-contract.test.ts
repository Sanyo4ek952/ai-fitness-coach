import { describe, expect, it } from "vitest";
import { z } from "zod";
import requestExample from "../examples/coach-request.example.json";
import responseExample from "../examples/coach-response.example.json";
import {
  COACH_INSTRUCTIONS, coachContextSchema, coachHistorySummarySchema, coachRequestSchema,
  coachResponseSchema, createCoachRequest, createCoachResponseJsonSchema, exerciseCatalog,
  parseCoachResponseForRequest,
} from "@/entities/training";

const { instructions: exampleInstructions, responseSchema: exampleSchema, ...exampleInput } = requestExample;
const input = { ...exampleInput, exerciseCatalog: exerciseCatalog.slice(0, 3) };
const request = () => createCoachRequest(input);
const versionId = "00000000-0000-4000-8000-000000000001";
const templateId = "00000000-0000-4000-8000-000000000002";
const rowId = "00000000-0000-4000-8000-000000000003";
const sessionId = "00000000-0000-4000-8000-000000000004";
const setId = "00000000-0000-4000-8000-000000000005";
const row = { id: rowId, ...responseExample.proposedProgram.workouts[0].exercises[0] };
const snapshot = { id: templateId, title: "А", exercises: [row] };
const program = { id: versionId, revision: 1, previousId: null, profileRevision: 1,
  createdAt: input.createdAt, title: "Цикл", goalInterpretation: "Развитие силы", workouts: [snapshot], reviewAfterSessions: 2 };
const session = { id: sessionId, programVersionId: versionId, templateId, plannedSnapshot: snapshot,
  startedAt: input.createdAt, endedAt: input.createdAt, status: "partial", sets: [{ id: setId, sessionId,
    plannedExerciseId: rowId, originalExerciseId: row.exerciseId, actualExerciseId: row.exerciseId,
    index: 1, timestamp: input.createdAt, status: "done", actual: { type: "reps", reps: 8, weightKg: null } }] };
const aggregate = { exerciseId: row.exerciseId, measurement: "reps", unit: "reps", sessionCount: 1,
  doneSetCount: 1, total: 8, firstPerformedAt: input.createdAt, lastPerformedAt: input.createdAt };
function reviewRequest() {
  return createCoachRequest({ ...input, mode: "review", context: { ...input.context, programVersionId: versionId, historyRevision: 1 },
    program, recentSessions: [session], historySummary: [aggregate], reasonCodes: ["manual"] });
}
function decisionInput(decision: string) {
  const { proposedProgram, ...base } = responseExample;
  return { ...base, decision, ...(decision === "propose_program" ? { proposedProgram } : {}),
    ...(decision === "needs_input" ? { question: "Какое оборудование доступно?" } : {}) };
}

describe("AI request v1", () => {
  it("собирает полный контракт и проверяет синтетическую фикстуру, не меняя вход", () => {
    const before = structuredClone(input);
    const result = request();
    expect(result.instructions).toBe(COACH_INSTRUCTIONS);
    expect(result.instructions).toBe(exampleInstructions);
    expect(result.responseSchema).toEqual(exampleSchema);
    expect(coachRequestSchema.parse(requestExample)).toEqual(result);
    expect(coachRequestSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
    expect(input).toEqual(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.profile.equipment)).toBe(true);
    expect(Object.isFrozen(result.context)).toBe(true);
    expect(Object.isFrozen(result.responseSchema)).toBe(true);
    expect(Object.values(result.responseSchema).filter(Array.isArray).every(Object.isFrozen)).toBe(true);
  });
  it("принимает неизвестное оборудование, optional/null и ревизию профиля новее программы", () => {
    expect(createCoachRequest({ ...input, profile: { ...input.profile, equipment: ["unknown"], details: null } }).profile.details).toBeNull();
    const review = reviewRequest();
    expect(coachRequestSchema.parse({ ...review, context: { ...review.context, profileRevision: 2 } }).context.profileRevision).toBe(2);
  });
  it("проверяет пример ответа целиком относительно полного запроса", () => {
    expect(parseCoachResponseForRequest(responseExample, request())).toEqual(responseExample);
  });
  it.each([
    { schemaVersion: 2 }, { kind: "fitness_backup" }, { mode: "other" }, { requestId: "bad" },
    { createdAt: "2026-11-24" }, { createdAt: "2026-11-24T10:00:00+03:00" },
    { photos: ["private"] }, { measurements: ["private"] }, { reasonCodes: [] },
    { reasonCodes: ["initial", "initial"] }, { reasonCodes: ["made_up"] }, { reasonCodes: ["manual"] },
    { program }, { mode: "review" }, { recentSessions: [session] },
    { exerciseCatalog: [] }, { exerciseCatalog: [...input.exerciseCatalog, input.exerciseCatalog[0]] },
    { exerciseCatalog: [{ ...input.exerciseCatalog[0], name: "Подменённое упражнение" }] },
    { profile: { ...input.profile, name: "Частное имя" } },
    { profile: { ...input.profile, details: { photo: "private" } } },
  ])("отклоняет некорректный запрос: %j", (patch) => {
    expect(() => createCoachRequest({ ...input, ...patch })).toThrow();
  });
  it("отклоняет неполную инструкцию и подменённую/удалённую внешнюю схему", () => {
    for (const patch of [{ instructions: "placeholder" }, { responseSchema: {} }, { responseSchema: { $ref: "https://example.com/schema" } }]) {
      expect(coachRequestSchema.safeParse({ ...request(), ...patch }).success).toBe(false);
    }
  });
  it("не зависит от порядка ключей JSON Schema и выдаёт независимую схему", () => {
    const first = createCoachResponseJsonSchema();
    const reordered = Object.fromEntries(Object.entries(first).reverse());
    expect(coachRequestSchema.safeParse({ ...request(), responseSchema: reordered }).success).toBe(true);
    first.description = "changed";
    expect(createCoachResponseJsonSchema().description).toBeUndefined();
  });
  it("проверяет long-term агрегаты и последние занятия в review", () => {
    expect(reviewRequest().recentSessions).toHaveLength(1);
    const review = reviewRequest();
    for (const patch of [
      { context: { ...review.context, programVersionId: null } },
      { context: { ...review.context, historyRevision: 0 } },
      { program: { ...program, profileRevision: 2 } },
      { recentSessions: [{ ...session, endedAt: null, status: "active" }] },
      { recentSessions: [{ ...session, status: "abandoned" }] },
      { recentSessions: [{ ...session, endedAt: "2026-11-25T07:00:00Z" }] },
      { recentSessions: [session, session] }, { recentSessions: Array.from({ length: 21 }, () => session) },
      { historySummary: [aggregate, aggregate] },
      { historySummary: [{ ...aggregate, lastPerformedAt: "2026-11-25T07:00:00Z" }] },
      { reasonCodes: ["initial"] },
    ]) expect(coachRequestSchema.safeParse({ ...review, ...patch }).success).toBe(false);
  });
  it.each([
    { measurement: "duration" }, { unit: "kg" }, { total: -1 }, { total: Infinity },
    { total: NaN }, { total: 1.5 }, { sessionCount: 2 }, { doneSetCount: 0 },
    { exerciseId: "invented" }, { firstPerformedAt: "2026-11-25T07:00:00Z" }, { weightKg: 10 },
  ])("отклоняет несогласованный агрегат: %j", (patch) => {
    expect(coachHistorySummarySchema.safeParse({ ...aggregate, ...patch }).success).toBe(false);
  });
  it("различает секунды и метры без пересчёта в повторения и тоннаж", () => {
    for (const [exerciseId, measurement, unit] of [["plank", "duration", "seconds"], ["treadmill-walk", "distance", "meters"]]) {
      expect(coachHistorySummarySchema.safeParse({ ...aggregate, exerciseId, measurement, unit, total: 12.5 }).success).toBe(true);
    }
  });
});

describe("AI response v1", () => {
  it.each(["propose_program", "needs_input", "unsupported"])("принимает initial %s", (decision) => {
    expect(parseCoachResponseForRequest(decisionInput(decision), request()).decision).toBe(decision);
  });
  it("keep принимается только при активной программе", () => {
    expect(coachResponseSchema.safeParse(decisionInput("keep")).success).toBe(false);
    const review = reviewRequest();
    const keep = { ...decisionInput("keep"), context: review.context };
    expect(parseCoachResponseForRequest(keep, review).decision).toBe("keep");
  });
  it.each([
    { schemaVersion: 2 }, { kind: "coach_request" }, { requestId: "wrong" }, { decision: "other" },
    { summary: " " }, { summary: "a".repeat(301) }, { reasons: Array(6).fill("Причина") },
    { reasons: ["a".repeat(241)] }, { nutritionTips: Array(4).fill("Совет") },
    { nutritionTips: ["a".repeat(181)] }, { question: "Лишний вопрос" }, { photos: [] },
    { context: { ...input.context, historyRevision: -1 } },
    { proposedProgram: { ...responseExample.proposedProgram, workouts: [] } },
  ])("отклоняет неверный ответ: %j", (patch) => {
    expect(coachResponseSchema.safeParse({ ...responseExample, ...patch }).success).toBe(false);
  });
  it("требует вопрос только в needs_input, запрещает программу в других вариантах", () => {
    expect(coachResponseSchema.safeParse({ ...decisionInput("needs_input"), question: undefined }).success).toBe(false);
    expect(coachResponseSchema.safeParse({ ...decisionInput("needs_input"), question: "a".repeat(241) }).success).toBe(false);
    for (const decision of ["needs_input", "unsupported", "keep"]) {
      expect(coachResponseSchema.safeParse({ ...responseExample, decision }).success).toBe(false);
    }
  });
  it("отклоняет чужой ID, каждую устаревшую ревизию и советы без согласия", () => {
    for (const patch of [
      { requestId: versionId }, { context: { ...input.context, profileRevision: 2 } },
      { context: { ...input.context, historyRevision: 1 } }, { context: { ...input.context, programVersionId: versionId } },
      { nutritionTips: ["Питайтесь разнообразно"] },
    ]) expect(() => parseCoachResponseForRequest({ ...responseExample, ...patch }, request())).toThrow();
    const optedIn = createCoachRequest({ ...input, profile: { ...input.profile, nutritionOptIn: true } });
    expect(parseCoachResponseForRequest({ ...responseExample, nutritionTips: ["Питайтесь разнообразно"] }, optedIn).nutritionTips).toHaveLength(1);
  });
  it("отклоняет ID вне каталога запроса и неподтверждённое оборудование", () => {
    const subset = createCoachRequest({ ...input, exerciseCatalog: [exerciseCatalog[0]] });
    expect(() => parseCoachResponseForRequest(responseExample, subset)).toThrow();
    for (const equipment of [["unknown"], ["dumbbells"]]) {
      const limited = createCoachRequest({ ...input, profile: { ...input.profile, equipment } });
      expect(() => parseCoachResponseForRequest(responseExample, limited)).toThrow();
    }
  });
  it("не исполняет HTML, ссылки или команды в текстовых полях и не меняет вход", () => {
    const summary = '<script>throw new Error("execute")</script> https://example.com cmd /c echo';
    const source = { ...responseExample, summary };
    const result = parseCoachResponseForRequest(source, request());
    expect(result.summary).toBe(summary);
    if (result.decision !== "propose_program") throw new Error("Ожидалось предложение программы");
    expect(Object.isFrozen(result.proposedProgram)).toBe(true);
    expect(Object.isFrozen(source)).toBe(false);
    expect(coachResponseSchema.safeParse(JSON.parse(JSON.stringify(source).replace('"summary":', '"__proto__":{},"summary":'))).success).toBe(false);
  });
  it.each([{ profileRevision: 0 }, { historyRevision: 0.5 }, { historyRevision: Number.MAX_SAFE_INTEGER + 1 }, { historyRevision: "0" }])("не приводит типы контекста: %j", (patch) => {
    expect(coachContextSchema.safeParse({ ...input.context, ...patch }).success).toBe(false);
  });
});

describe("внешняя JSON Schema", () => {
  it("содержит закрытые варианты и проверяет JSON round-trip структурным валидатором", () => {
    const schema = createCoachResponseJsonSchema();
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    // Обратный конвертер Zod используется только в тесте: runtime доверяет исходным схемам.
    const external = z.fromJSONSchema(schema);
    for (const decision of ["propose_program", "needs_input", "unsupported"]) expect(external.safeParse(decisionInput(decision)).success).toBe(true);
    for (const patch of [{ extra: true }, { schemaVersion: 2 }, { proposedProgram: {} }, { question: "unexpected" }, { summary: "a".repeat(301) }]) {
      expect(external.safeParse({ ...responseExample, ...patch }).success).toBe(false);
    }
  });
});
