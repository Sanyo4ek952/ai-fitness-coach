import { z } from "zod";
import { idSchema, revisionSchema, text } from "./primitives";
import { programDraftSchema } from "./program";

export const coachContextSchema = z.strictObject({
  profileRevision: revisionSchema,
  programVersionId: idSchema.nullable(),
  historyRevision: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
}).readonly();

const responseShape = {
  schemaVersion: z.literal(1),
  kind: z.literal("coach_response"),
  requestId: idSchema,
  context: coachContextSchema,
  summary: text(300),
  reasons: z.array(text(240)).max(5).readonly(),
  nutritionTips: z.array(text(180)).max(3).readonly(),
};

export const coachResponseSchema = z.discriminatedUnion("decision", [
  z.strictObject({ ...responseShape, decision: z.literal("propose_program"), proposedProgram: programDraftSchema }),
  z.strictObject({ ...responseShape, decision: z.literal("keep") }),
  z.strictObject({ ...responseShape, decision: z.literal("needs_input"), question: text(240) }),
  z.strictObject({ ...responseShape, decision: z.literal("unsupported") }),
]).refine((response) => response.decision !== "keep" || response.context.programVersionId !== null,
  "Нельзя сохранить отсутствующую программу").readonly();

// Refinements (связи, каталог, min <= max) дополнительно проверяются Zod при импорте.
export function createCoachResponseJsonSchema() {
  return z.toJSONSchema(coachResponseSchema, { target: "draft-2020-12", io: "input" });
}

export type CoachContext = z.infer<typeof coachContextSchema>;
export type CoachResponse = z.infer<typeof coachResponseSchema>;
