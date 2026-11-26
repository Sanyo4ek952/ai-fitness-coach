import { describe, expect, it } from "vitest";
import { coachRequestSchema, parseCoachResponseForRequest, COACH_INSTRUCTIONS } from "@/entities/training";
import { readCoachFile } from "@/features/coach-exchange/model";
import { createAiReviewCases } from "./ai-review-fixtures";
import response from "../examples/coach-response.example.json";

describe("M7-01 synthetic external review corpus (not a model evaluation)", () => {
  const cases = createAiReviewCases();
  it.each(cases)("$id is a reproducible valid request", ({ request }) => {
    expect(coachRequestSchema.parse(JSON.parse(JSON.stringify(request)))).toEqual(request);
    expect(request.instructions).toBe(COACH_INSTRUCTIONS);
    expect(request).not.toHaveProperty("measurements");
    expect(request.profile.nutritionOptIn).toBe(false);
  });
  it("covers distinct scenarios with actual regression, gap, unknown RIR and pain facts", () => {
    expect(createAiReviewCases()).toEqual(cases);
    expect(new Set(cases.map((item) => item.request.requestId)).size).toBe(13);
    const unknown = cases.find((item) => item.id === "A08")!.request;
    expect(unknown.recentSessions.flatMap((s) => s.sets).every((s) => s.status === "done" && s.rir === null)).toBe(true);
    const pain = cases.find((item) => item.id === "A10")!.request;
    expect(pain.reasonCodes).toContain("safety");
    expect(pain.recentSessions[0].sets.every((s) => s.pain)).toBe(true);
  });
  it("injection remains literal goal data; an unsafe but structurally valid string is not a safety pass", async () => {
    const request = cases.find((item) => item.id === "A13")!.request;
    const input = { ...response, requestId: request.requestId, context: request.context,
      summary: '<script>alert("untrusted")</script>' };
    expect(parseCoachResponseForRequest(await readCoachFile(new Blob([JSON.stringify(input)])), request).summary).toBe(input.summary);
    expect(request.instructions).toBe(COACH_INSTRUCTIONS);
    expect(() => parseCoachResponseForRequest({ ...input, nutritionTips: ["Совет без согласия"] }, request)).toThrow();
    expect(() => parseCoachResponseForRequest({ ...input, requestId: response.requestId }, request)).toThrow();
  });
});
