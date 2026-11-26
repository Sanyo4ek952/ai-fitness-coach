import { z } from "zod";
import { equipmentListSchema, idSchema, revisionSchema, text } from "./primitives";

export const profileDetailsSchema = z.strictObject({
  ageYears: z.int().min(18).max(120).nullish(),
  heightCm: z.number().min(50).max(250).nullish(),
  weightKg: z.number().positive().max(500).nullish(),
  sessionMinutes: z.int().min(1).max(480).nullish(),
  availableWeights: text(500).nullish(),
  constraints: text(1000).nullish(),
  sleep: text(500).nullish(),
  nutrition: text(500).nullish(),
}).readonly();

export const profileSchema = z.strictObject({
  id: idSchema,
  revision: revisionSchema,
  goal: text(500),
  experience: z.enum(["beginner", "intermediate", "advanced", "unknown"]),
  sessionsPerWeek: z.int().min(1).max(7).nullable(),
  equipment: equipmentListSchema,
  details: profileDetailsSchema.nullish(),
  nutritionOptIn: z.boolean(),
}).readonly();

export type Profile = z.infer<typeof profileSchema>;
export type ProfileDetails = z.infer<typeof profileDetailsSchema>;
