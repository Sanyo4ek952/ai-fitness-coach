import { z } from "zod";
import { coachResponseSchema } from "./coach-response";
import { idSchema, timestampSchema } from "./primitives";

// Retains the whole explicitly accepted package, including reasons/nutrition.
// Pending requests have no acceptance; the external request DTO is immutable.
export const coachAcceptanceSchema = z.strictObject({
  requestId: idSchema,
  status: z.literal("accepted"),
  acceptedAt: timestampSchema,
  reviewAcknowledged: z.literal(true),
  programVersionId: idSchema,
  response: coachResponseSchema,
}).superRefine((value, ctx) => {
  if (value.requestId !== value.response.requestId) {
    ctx.addIssue({ code: "custom", message: "Принят ответ другого запроса" });
  }
  if (value.response.decision !== "propose_program" && value.response.decision !== "keep") {
    ctx.addIssue({ code: "custom", message: "Это решение нельзя принять как программу" });
  }
  if (value.response.decision === "keep" && value.programVersionId !== value.response.context.programVersionId) {
    ctx.addIssue({ code: "custom", message: "Keep должен сохранить текущую версию" });
  }
}).readonly();

export type CoachAcceptance = z.infer<typeof coachAcceptanceSchema>;
