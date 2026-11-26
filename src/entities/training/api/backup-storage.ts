import { z } from "zod";
import type { TrainingDatabase } from "@/shared/infrastructure/db";
import { backupDataSchema, validateBackup, validateBackupPhotos, encodePhoto, decodePhoto, MAX_BACKUP_BYTES, type FitnessBackup } from "../model/backup";
import { progressPhotoSchema } from "../model/body-progress";

export function backupStorage(db: TrainingDatabase) {
  async function snapshot() {
    return db.transaction("r", db.tables, async () => ({
      profileRevisions: await db.profileRevisions.toArray(), programVersions: await db.programVersions.toArray(),
      sessions: await db.sessions.toArray(), counters: (await db.counters.toArray()).filter((r) => r.key !== "restoreGeneration"),
      coachRequests: await db.coachRequests.toArray(), coachResponses: await db.coachResponses.toArray(),
      coachAcceptances: await db.coachAcceptances.toArray(), programState: await db.programState.toArray(),
      bodyMeasurements: await db.bodyMeasurements.toArray(), progressPhotos: await db.progressPhotos.toArray(),
    }));
  }
  // All stores, including timer/control/photo IDs: revisions alone miss changes.
  // Photos are immutable through the adapter; ID plus validated metadata is their identity.
  function token(data: Awaited<ReturnType<typeof snapshot>>) {
    return JSON.stringify({ ...data, progressPhotos: data.progressPhotos.map((r) => {
      const { blob, ...meta } = progressPhotoSchema.parse(r.payload); return { id: r.id, payload: meta, bytes: blob.size };
    }) });
  }
  async function exportBackup(includePhotos: boolean): Promise<FitnessBackup> {
    z.boolean().parse(includePhotos);
    const rows = await snapshot();
    const photos = includePhotos ? await Promise.all(rows.progressPhotos.map(async (r) => {
      const { blob, ...meta } = progressPhotoSchema.parse(r.payload);
      return { id: r.id, payload: { ...meta, data: encodePhoto(new Uint8Array(await blob.arrayBuffer())) } };
    })) : [];
    const backup = validateBackup({ kind: "fitness_backup", version: 1, databaseVersion: 4,
      createdAt: new Date().toISOString(), photosIncluded: includePhotos, data: { ...rows, progressPhotos: photos } });
    await validateBackupPhotos(backup);
    if (new Blob([JSON.stringify(backup)]).size > MAX_BACKUP_BYTES) throw new Error("Резервная копия превышает 96 MiB");
    return backup;
  }
  async function preview(input: unknown) {
    const backup = validateBackup(input);
    await validateBackupPhotos(backup);
    const current = await snapshot();
    if (current.sessions.some((r) => r.status === "active")) throw new Error("Сначала завершите текущее занятие перед восстановлением");
    return { backup, expectedToken: token(current), current: {
      profiles: current.profileRevisions.length, versions: current.programVersions.length,
      sessions: current.sessions.length, measurements: current.bodyMeasurements.length, photos: current.progressPhotos.length,
    } };
  }
  async function restore(input: unknown, expectedToken: string, confirmed: unknown) {
    z.literal(true).parse(confirmed); z.string().min(1).parse(expectedToken);
    const backup = validateBackup(input);
    await validateBackupPhotos(backup);
    const photos = backup.data.progressPhotos.map((r) => {
      const { data, ...meta } = r.payload;
      return { id: r.id, payload: progressPhotoSchema.parse({ ...meta, blob: new Blob([decodePhoto(data)], { type: meta.mime }) }) };
    });
    // Validation and Blob decoding finish before opening the write transaction.
    await db.write(db.tables, async () => {
      const current = await snapshot();
      if (token(current) !== expectedToken || current.sessions.some((r) => r.status === "active")) {
        throw new Error("Данные изменились после предпросмотра. Выберите копию заново.");
      }
      const generation = crypto.randomUUID();
      for (const table of db.tables) await table.clear();
      const data = backupDataSchema.parse(backup.data);
      await db.profileRevisions.bulkAdd(data.profileRevisions);
      await db.programVersions.bulkAdd(data.programVersions);
      await db.sessions.bulkAdd(data.sessions);
      await db.counters.bulkAdd(data.counters);
      await db.coachRequests.bulkAdd(data.coachRequests);
      await db.coachResponses.bulkAdd(data.coachResponses);
      await db.coachAcceptances.bulkAdd(data.coachAcceptances);
      await db.programState.bulkAdd(data.programState);
      await db.bodyMeasurements.bulkAdd(data.bodyMeasurements);
      await db.progressPhotos.bulkAdd(photos);
      await db.counters.put({ key: "restoreGeneration", value: generation });
    });
    // All connections in this page now require reload; don't leave stale forms writable.
  }
  return { export: exportBackup, preview, restore, needsReload: () => db.needsReload() };
}
