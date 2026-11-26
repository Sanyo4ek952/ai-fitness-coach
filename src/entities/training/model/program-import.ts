import { z } from "zod";
import { programDraftSchema } from "./program";

// A user's complete plan, independent of the request/response AI exchange.
export const programFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("training_program"),
  program: programDraftSchema,
}).readonly();

export type ProgramFile = z.infer<typeof programFileSchema>;

export function createProgramFileJsonSchema() {
  return z.toJSONSchema(programFileSchema, { target: "draft-2020-12", io: "input" });
}
