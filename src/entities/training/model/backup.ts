import { z } from "zod";
import { profileSchema } from "./profile";
import { programVersionSchema, programDefinitions } from "./program";
import { mergeExerciseCatalog } from "./exercise";
import { workoutSessionSchema } from "./session";
import { coachRequestSchema, parseCoachResponseForRequest } from "./coach-request";
import { coachResponseSchema } from "./coach-response";
import { coachAcceptanceSchema } from "./coach-acceptance";
import { programCursorSchema, selectNextWorkout, workoutForPhase } from "./program-sequence";
import { analysisControlSchema, analysisSnapshotSchema } from "./analysis";
import { bodyMeasurementSchema, progressPhotoSchema, MAX_PHOTO_BYTES } from "./body-progress";
import { idSchema, revisionSchema, timestampSchema } from "./primitives";
import { programToDraft } from "./program-diff";
import { inspectPhoto } from "./photo";

export const MAX_BACKUP_BYTES = 96 * 1024 * 1024;
const counter = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const exchange = { requestId: idSchema };
const { blob: blobSchema, ...photoShape } = progressPhotoSchema.unwrap().shape; void blobSchema;
const photoFileSchema = z.strictObject({ ...photoShape,
  data: z.string().max(4 * Math.ceil(MAX_PHOTO_BYTES / 3)).regex(/^[A-Za-z0-9+/]*={0,2}$/),
});
export const backupDataSchema = z.strictObject({
  profileRevisions: z.array(z.strictObject({ revision: revisionSchema, payload: profileSchema })).max(10000),
  programVersions: z.array(z.strictObject({ id: idSchema, revision: revisionSchema, payload: programVersionSchema })).max(10000),
  sessions: z.array(z.strictObject({ id: idSchema, status: workoutSessionSchema.unwrap().shape.status, payload: workoutSessionSchema })).max(10000),
  counters: z.array(z.strictObject({ key: z.enum(["historyRevision", "measurementRevision"]), value: counter })).max(2),
  coachRequests: z.array(z.strictObject({ ...exchange, payload: coachRequestSchema, baselineKey: idSchema.optional(), measurementRevision: counter.optional() })).max(10000),
  coachResponses: z.array(z.strictObject({ ...exchange, payload: coachResponseSchema })).max(10000),
  coachAcceptances: z.array(z.strictObject({ ...exchange, payload: coachAcceptanceSchema })).max(10000),
  programState: z.array(z.discriminatedUnion("key", [
    z.strictObject({ key: z.literal("activeProgram"), payload: programCursorSchema }),
    z.strictObject({ key: z.literal("analysisBaseline"), payload: z.strictObject({ programVersionId: idSchema, requestId: idSchema }) }),
    z.strictObject({ key: z.literal("analysisControl"), payload: analysisControlSchema }),
    z.strictObject({ key: z.literal("analysisSnapshot"), payload: analysisSnapshotSchema }),
  ])).max(4),
  bodyMeasurements: z.array(z.strictObject({ id: idSchema, payload: bodyMeasurementSchema })).max(1000),
  progressPhotos: z.array(z.strictObject({ id: idSchema, payload: photoFileSchema })).max(20),
});
export const backupSchema = z.strictObject({
  kind: z.literal("fitness_backup"), version: z.literal(1), databaseVersion: z.literal(4),
  createdAt: timestampSchema, photosIncluded: z.boolean(), data: backupDataSchema,
});
export type FitnessBackup = z.infer<typeof backupSchema>;

function check(value: unknown, message = "Повреждены связи резервной копии"): asserts value {
  if (!value) throw new Error(message);
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** No writes, network, navigation or execution. Validate the entire graph first. */
export function validateBackup(input: unknown): FitnessBackup {
  // Bound depth/work before recursive schemas (including the embedded JSON Schema).
  const pending = [{ value: input, depth: 0 }]; let nodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    check(++nodes <= 2000000 && item.depth <= 64, "Слишком сложная резервная копия");
    if (item.value && typeof item.value === "object") {
      check(!Array.isArray(item.value) || item.value.length <= 10000, "Слишком много записей");
      for (const [key, value] of Object.entries(item.value)) {
        check(!["__proto__", "prototype", "constructor"].includes(key), "Недопустимый ключ в копии");
        pending.push({ value, depth: item.depth + 1 });
      }
    }
  }
  const backup = backupSchema.parse(input); const d = backup.data;
  check(Object.values(d).reduce((sum, rows) => sum + rows.length, 0) <= 20000, "В копии больше 20000 записей");
  for (const rows of Object.values(d)) {
    const keys = rows.map((row) => "key" in row ? row.key : "id" in row ? row.id : "requestId" in row ? row.requestId : row.revision);
    check(new Set(keys).size === keys.length, "Повтор ключа в резервной копии");
  }
  const profiles = new Map(d.profileRevisions.map((r) => [r.revision, r.payload]));
  const versions = new Map(d.programVersions.map((r) => [r.id, r.payload]));
  mergeExerciseCatalog([...versions.values()].flatMap(programDefinitions));
  const sessions = new Map(d.sessions.map((r) => [r.id, r.payload]));
  const requests = new Map(d.coachRequests.map((r) => [r.requestId, r.payload]));
  const accepted = new Map(d.coachAcceptances.map((r) => [r.requestId, r.payload]));
  const history = d.counters.find((r) => r.key === "historyRevision")?.value ?? 0;
  const measurements = d.counters.find((r) => r.key === "measurementRevision")?.value ?? 0;
  check(history >= sessions.size && measurements >= d.bodyMeasurements.length);
  const sortedProfiles = [...d.profileRevisions].sort((a, b) => a.revision - b.revision);
  sortedProfiles.forEach((r, i) => check(r.revision === i + 1 && r.payload.revision === r.revision && r.payload.id === sortedProfiles[0].payload.id));
  const sortedVersions = [...d.programVersions].sort((a, b) => a.revision - b.revision);
  sortedVersions.forEach((r, i) => {
    const v = r.payload; const prev = sortedVersions[i - 1]?.payload;
    check(r.id === v.id && r.revision === i + 1 && r.revision === v.revision && profiles.has(v.profileRevision)
      && v.previousId === (prev?.id ?? null) && (!prev || Date.parse(v.createdAt) >= Date.parse(prev.createdAt)));
  });
  for (const r of d.sessions) {
    const s = r.payload; const v = versions.get(s.programVersionId);
    check(s.id === r.id && s.status === r.status && v && Date.parse(s.startedAt) >= Date.parse(v.createdAt)
      && equal(workoutForPhase(v, s.templateId, s.phaseIndex), s.plannedSnapshot));
  }
  for (const r of d.coachRequests) {
    const q = r.payload;
    check(r.requestId === q.requestId && profiles.has(q.context.profileRevision) && q.context.historyRevision <= history);
    const profile = profiles.get(q.context.profileRevision); check(profile);
    const { id: profileId, revision: profileRevision, ...snapshot } = profile; void profileId; void profileRevision;
    check(equal(q.profile, snapshot));
    if (q.program) check(equal(q.program, versions.get(q.program.id)));
    for (const s of q.recentSessions) check(sessions.has(s.id)
      && equal(workoutForPhase(versions.get(s.programVersionId), s.templateId, s.phaseIndex), s.plannedSnapshot));
    check(q.context.programVersionId === (q.program?.id ?? null));
    // Old exports without local provenance remain readable; never synthesize it.
    if (r.baselineKey) check(q.mode === "review" && (r.baselineKey === q.context.programVersionId
      || accepted.get(r.baselineKey)?.programVersionId === q.context.programVersionId));
    if (r.measurementRevision !== undefined) check(q.measurements !== undefined && r.measurementRevision <= measurements);
    if (q.measurements !== undefined) check(r.measurementRevision !== undefined);
  }
  for (const r of d.coachResponses) {
    const q = requests.get(r.requestId); check(q); parseCoachResponseForRequest(r.payload, q);
    check(r.payload.requestId === r.requestId);
  }
  for (const r of d.coachAcceptances) {
    const a = r.payload; const q = requests.get(r.requestId); const v = versions.get(a.programVersionId);
    check(q && v && a.requestId === r.requestId && Date.parse(a.acceptedAt) >= Date.parse(q.createdAt));
    parseCoachResponseForRequest(a.response, q);
    const response = d.coachResponses.find((row) => row.requestId === r.requestId);
    check(response && equal(response.payload, a.response));
    if (a.response.decision === "propose_program") check(v.previousId === q.context.programVersionId
      && v.profileRevision === q.context.profileRevision
      && v.createdAt === a.acceptedAt && equal(programToDraft(v), a.response.proposedProgram));
  }
  const activeRow = d.programState.find((r) => r.key === "activeProgram");
  const active = activeRow?.key === "activeProgram" ? activeRow.payload : undefined;
  if (active) { const v = versions.get(active.programVersionId); check(v); selectNextWorkout(v, active); }
  const activeSessions = d.sessions.filter((r) => r.status === "active"); check(activeSessions.length <= 1);
  for (const r of activeSessions) {
    check(active && r.payload.programVersionId === active.programVersionId
      && versions.get(active.programVersionId)?.workouts[active.nextWorkoutIndex]?.id === r.payload.templateId
      && active.phaseIndex === r.payload.phaseIndex);
  }
  function baseline(key: string) { check(versions.has(key) || accepted.has(key)); }
  for (const r of d.programState) {
    if (r.key === "analysisBaseline") check(accepted.get(r.payload.requestId)?.programVersionId === r.payload.programVersionId && versions.has(r.payload.programVersionId));
    if (r.key === "analysisControl") {
      baseline(r.payload.baselineKey);
      r.payload.snooze?.sessionIds.forEach((id) => check(sessions.has(id)));
    }
    if (r.key === "analysisSnapshot") {
      baseline(r.payload.baselineKey);
      if (r.payload.profileRevision) check(profiles.has(r.payload.profileRevision));
      if (r.payload.baselineProfileRevision) check(profiles.has(r.payload.baselineProfileRevision));
      for (const fact of r.payload.facts) { const s = sessions.get(fact.sessionId); check(s); fact.setIds.forEach((id) => check(s.sets.some((set) => set.id === id))); }
    }
  }
  d.bodyMeasurements.forEach((r) => check(r.id === r.payload.id));
  check(backup.photosIncluded || d.progressPhotos.length === 0);
  for (const r of d.progressPhotos) {
    const p = r.payload; check(r.id === p.id);
    const bytes = decodePhoto(p.data); check(bytes.length === p.size && encodePhoto(bytes) === p.data);
    const dimensions = inspectPhoto(bytes, p.mime); check(dimensions.width === p.width && dimensions.height === p.height);
  }
  return backup;
}

export function encodePhoto(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function decodePhoto(data: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
}
export async function readBackupFile(file: Pick<Blob, "size" | "arrayBuffer">): Promise<FitnessBackup> {
  check(file.size > 0 && file.size <= MAX_BACKUP_BYTES, "Выберите резервную копию до 96 MiB");
  const bytes = await file.arrayBuffer(); check(bytes.byteLength <= MAX_BACKUP_BYTES, "Копия больше 96 MiB");
  let input: unknown;
  try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("Не удалось прочитать UTF-8 JSON резервной копии"); }
  const backup = validateBackup(input); await validateBackupPhotos(backup); return backup;
}

/** Native decode when available; the Node suite separately tests header/size limits. */
export async function validateBackupPhotos(backup: FitnessBackup): Promise<void> {
  for (const row of backup.data.progressPhotos) {
    const p = row.payload; const bytes = decodePhoto(p.data);
    // Canvas exports don't contain EXIF/XMP/IPTC/comment segments. Reject them
    // instead of reintroducing metadata or silently changing the backup bytes.
    const view = new DataView(bytes.buffer);
    for (let offset = 2; offset + 4 <= bytes.length;) {
      check(bytes[offset] === 255, "Повреждён JPEG");
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(offset); check(length >= 2 && offset + length <= bytes.length, "Повреждён JPEG");
      check(![0xe1, 0xed, 0xfe].includes(marker), "Фото содержит метаданные. Нужна копия с очищенными фото приложения.");
      offset += length;
    }
    if (typeof Image !== "undefined") {
      const url = URL.createObjectURL(new Blob([bytes], { type: p.mime }));
      try {
        const image = new Image(); image.src = url; await image.decode();
        check(image.naturalWidth === p.width && image.naturalHeight === p.height, "Размер декодированного фото не совпадает");
      } finally { URL.revokeObjectURL(url); }
    }
  }
}
