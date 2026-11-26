import { z } from "zod";

export const idSchema = z.uuid();
export const timestampSchema = z.iso.datetime({ offset: false });
export const revisionSchema = z.int().min(1).max(Number.MAX_SAFE_INTEGER);
export const text = (max: number) => z.string().trim().min(1).max(max);
export const weightSchema = z.number().min(0).max(1000).nullable();
export const rirSchema = z.number().min(0).max(10).nullable();
export const equipmentSchema = z.enum([
  "dumbbells", "bench", "barbell", "rack", "cable", "leg-press",
  "assisted-pull-up", "machine", "treadmill", "bodyweight", "unknown",
]);
export const equipmentListSchema = z.array(equipmentSchema).min(1).max(16)
  .refine((items) => new Set(items).size === items.length, "Оборудование повторяется")
  .refine((items) => !items.includes("unknown") || items.length === 1, "Неизвестное оборудование нельзя совмещать с известным")
  .readonly();

export function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}
