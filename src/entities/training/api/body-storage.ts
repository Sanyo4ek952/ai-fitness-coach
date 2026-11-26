import { z } from "zod";
import type { TrainingDatabase, StoredBodyRecord } from "@/shared/infrastructure/db";
import { bodyMeasurementSchema, progressPhotoSchema, MAX_MEASUREMENTS, MAX_PHOTOS } from "../model/body-progress";
import { inspectPhoto } from "../model/photo";
import { idSchema } from "../model/primitives";

function read<T extends { readonly id: string }>(row: StoredBodyRecord, schema: z.ZodType<T>): T {
  const value = schema.parse(row.payload);
  if (value.id !== row.id) throw new Error("Повреждён ключ записи");
  return value;
}
export function bodyStorage(db: TrainingDatabase) {
  async function revision() {
    const row = await db.counters.get("measurementRevision");
    if (row) return z.int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(row.value);
    if (await db.bodyMeasurements.count()) throw new Error("Отсутствует ревизия замеров");
    return 0;
  }
  async function listMeasurements() {
    await revision();
    return (await db.bodyMeasurements.toArray()).map((row) => read(row, bodyMeasurementSchema))
      .sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt) || a.id.localeCompare(b.id));
  }
  async function bump() { await db.counters.put({ key: "measurementRevision", value: z.int().max(Number.MAX_SAFE_INTEGER).parse(await revision() + 1) }); }
  return {
    revision,
    listMeasurements,
    async overview() {
      return db.transaction("r", db.bodyMeasurements, db.progressPhotos, db.counters, async () => ({
        measurements: await listMeasurements(),
        photos: (await db.progressPhotos.toArray()).map((row) => read(row, progressPhotoSchema))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id)),
      }));
    },
    async addMeasurement(input: unknown) {
      const value = bodyMeasurementSchema.parse(input);
      if (Date.parse(value.measuredAt) > Date.now()) throw new Error("Дата замера ещё не наступила");
      return db.write([db.bodyMeasurements, db.counters], async () => {
        if (await db.bodyMeasurements.count() >= MAX_MEASUREMENTS) throw new Error("Достигнут лимит 1000 замеров");
        // Increment before insert also validates a missing counter on nonempty data.
        await bump();
        await db.bodyMeasurements.add({ id: value.id, payload: structuredClone(value) });
        return value;
      });
    },
    async deleteMeasurement(idInput: unknown) {
      const id = idSchema.parse(idInput);
      return db.write([db.bodyMeasurements, db.counters], async () => {
        const row = await db.bodyMeasurements.get(id);
        if (!row) return;
        read(row, bodyMeasurementSchema); await bump(); await db.bodyMeasurements.delete(id);
      });
    },
    async addPhoto(input: unknown) {
      const value = progressPhotoSchema.parse(input);
      const dimensions = inspectPhoto(new Uint8Array(await value.blob.arrayBuffer()), value.mime);
      if (dimensions.width !== value.width || dimensions.height !== value.height) throw new Error("Повреждён размер фото");
      return db.write([db.progressPhotos], async () => {
        if (await db.progressPhotos.count() >= MAX_PHOTOS) throw new Error("Достигнут лимит 20 фото. Можно удалить ненужные снимки.");
        await db.progressPhotos.add({ id: value.id, payload: structuredClone(value) });
        return value;
      });
    },
    async deletePhotos(idsInput: unknown) {
      const ids = z.array(idSchema).min(1).max(MAX_PHOTOS).refine((items) => new Set(items).size === items.length).parse(idsInput);
      return db.write([db.progressPhotos], async () => {
        // Exact displayed IDs: a concurrently added photo is never deleted.
        await db.progressPhotos.bulkDelete(ids);
      });
    },
  };
}
