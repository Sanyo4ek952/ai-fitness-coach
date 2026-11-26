import { z } from "zod";
import { idSchema, timestampSchema } from "./primitives";

export const measurementKinds = ["weight", "waist", "hips", "chest", "thigh", "arm"] as const;
export const measurementKindSchema = z.enum(measurementKinds);
export const measurementLabels = { weight: "Масса тела", waist: "Талия", hips: "Бёдра", chest: "Грудь", thigh: "Бедро", arm: "Плечо" };
export const bodyMeasurementSchema = z.strictObject({
  id: idSchema, kind: measurementKindSchema, value: z.number().positive().max(500),
  unit: z.enum(["kg", "cm"]), measuredAt: timestampSchema,
}).refine((item) => item.kind === "weight" ? item.unit === "kg" : item.unit === "cm" && item.value <= 300,
  "Проверьте единицу и значение замера").readonly();
export type BodyMeasurement = z.infer<typeof bodyMeasurementSchema>;
export const measurementSelectionSchema = z.array(measurementKindSchema).max(6)
  .refine((items) => new Set(items).size === items.length).readonly();
export const MAX_MEASUREMENTS = 1000;
export const MAX_PHOTOS = 20;
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const progressPhotoSchema = z.strictObject({
  id: idSchema, createdAt: timestampSchema, mime: z.literal("image/jpeg"),
  size: z.int().positive().max(MAX_PHOTO_BYTES), width: z.int().min(1).max(1600), height: z.int().min(1).max(1600),
  blob: z.instanceof(Blob),
}).refine((item) => item.blob.type === item.mime && item.blob.size === item.size, "Повреждён файл фото").readonly();
export type ProgressPhoto = z.infer<typeof progressPhotoSchema>;

/** Explicit kinds are the user's choice of relevance to their free-form goal. */
export function selectMeasurements(input: unknown, kindsInput: unknown, nowInput: unknown) {
  const items = z.array(bodyMeasurementSchema).max(MAX_MEASUREMENTS).parse(input);
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("Повтор ID замера");
  const kinds = measurementSelectionSchema.parse(kindsInput);
  const now = Date.parse(timestampSchema.parse(nowInput));
  return items.filter((item) => kinds.includes(item.kind) && Date.parse(item.measuredAt) <= now
    && Date.parse(item.measuredAt) >= now - 90 * 86400000)
    .sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt) || a.id.localeCompare(b.id));
}
