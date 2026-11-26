import { describe, expect, it } from "vitest";
import { coachAcceptanceSchema } from "../src/entities/training/model/coach-acceptance";
import response from "../examples/coach-response.example.json";

const versionId = "00000000-0000-4000-8000-000000000001";
const accepted = { requestId: response.requestId, status: "accepted", acceptedAt: "2026-11-24T10:00:00Z", reviewAcknowledged: true, programVersionId: versionId, response };

describe("сохранённое подтверждение полного пакета", () => {
  it("сохраняет исходный ответ целиком и замораживает прочитанный пакет", () => {
    const value = coachAcceptanceSchema.parse(accepted);
    expect(value.response).toEqual(response);
    expect(Object.isFrozen(value.response)).toBe(true);
    expect(Object.isFrozen(value)).toBe(true);
  });
  it("отклоняет чужой ID и лишние поля", () => {
    expect(coachAcceptanceSchema.safeParse({ ...accepted, requestId: versionId }).success).toBe(false);
    expect(coachAcceptanceSchema.safeParse({ ...accepted, cursor: 0 }).success).toBe(false);
  });
  it.each(["needs_input", "unsupported"])("%s не принимается как программа", (decision) => {
    const { proposedProgram, ...base } = response;
    expect(proposedProgram.workouts.length).toBeGreaterThan(0);
    expect(coachAcceptanceSchema.safeParse({ ...accepted, response: { ...base, decision, ...(decision === "needs_input" ? { question: "Уточните оборудование" } : {}) } }).success).toBe(false);
  });
  it("keep сохраняет ID текущей версии", () => {
    const { proposedProgram, ...base } = response;
    expect(proposedProgram.workouts.length).toBeGreaterThan(0);
    const keep = { ...base, decision: "keep", context: { ...base.context, programVersionId: versionId } };
    expect(coachAcceptanceSchema.safeParse({ ...accepted, response: keep }).success).toBe(true);
    expect(coachAcceptanceSchema.safeParse({ ...accepted, programVersionId: "00000000-0000-4000-8000-000000000002", response: keep }).success).toBe(false);
  });
});
