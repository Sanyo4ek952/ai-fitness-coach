import { Dexie } from "dexie";
import { createTrainingStorage, readBackupFile, validateBackup, type TrainingStorage, type FitnessBackup } from "@/entities/training";
import { TrainingDatabase } from "@/shared/infrastructure/db";
import example from "../examples/coach-response.example.json";

const time = "2026-11-25T10:00:00.000Z";
const later = "2026-11-25T10:01:00.000Z";
const id = () => crypto.randomUUID();
function check(value: unknown, message = "Проверка backup не выполнена"): asserts value { if (!value) throw new Error(message); }
function equal(a: unknown, b: unknown) { check(JSON.stringify(a) === JSON.stringify(b), "Данные различаются"); }
async function rejects(action: () => Promise<unknown>) { try { await action(); } catch { return; } throw new Error("Операция ошибочно разрешена"); }
async function withDB(action: (s: TrainingStorage, raw: TrainingDatabase, name: string) => Promise<void>) {
  const name = `m6-02-test-${id()}`; const s = createTrainingStorage(name); const raw = new TrainingDatabase(name);
  try { await s.open(); await raw.open(); await action(s, raw, name); }
  finally { s.close(); raw.close(); await Dexie.delete(name); }
}
async function profile(s: TrainingStorage) {
  return s.profiles.save({ id: id(), revision: 1, goal: "Синтетическая цель", experience: "unknown", sessionsPerWeek: null,
    equipment: ["dumbbells", "bench"], nutritionOptIn: false });
}
async function seeded(s: TrainingStorage) {
  await profile(s);
  const q = await s.coach.createInitialRequest(id(), time);
  await s.coach.accept(await s.coach.importResponse({ ...example, requestId: q.requestId, context: q.context }), time, true);
  const analysis = await s.analysis.refresh(time); check(analysis);
  await s.analysis.act({ kind: "manual", now: time, expectedToken: analysis.token });
  const a = await s.analysis.overview(time); check(a);
  const review = await s.coach.createReviewRequest(id(), time, a.token);
  const { proposedProgram, ...response } = example; check(proposedProgram);
  await s.coach.accept(await s.coach.importResponse({ ...response, requestId: review.requestId, context: review.context, decision: "keep" }), time, true);
  await s.analysis.refresh(time);
  await s.body.addMeasurement({ id: id(), kind: "weight", value: 70.5, unit: "kg", measuredAt: time });
  return s.backup.export(false);
}
function data(backup: FitnessBackup) { return backup.data; }

export const backupCases: readonly { name: string; run: () => Promise<void> }[] = [
  { name: "accepted proposal cannot be reassigned to a different position in the version chain", run: () => withDB(async (s) => {
    await profile(s);
    const q = await s.coach.createInitialRequest(id(), time);
    await s.coach.accept(await s.coach.importResponse({ ...example, requestId: q.requestId, context: q.context }), time, true);
    const first = (await s.programs.active())?.program; check(first);
    // append is persistence-only: a later identical plan is not the accepted initial plan.
    const second = await s.programs.append({ ...first, id: id(), revision: 2, previousId: first.id });
    const before = await s.backup.export(false);
    const tampered = { ...before, data: { ...before.data,
      coachAcceptances: before.data.coachAcceptances.map((r) => ({ ...r, payload: { ...r.payload, programVersionId: second.id } })),
      programState: before.data.programState.map((r) => r.key === "analysisBaseline"
        ? { ...r, payload: { ...r.payload, programVersionId: second.id } } : r),
    } };
    const preview = await s.backup.preview(before);
    await rejects(() => s.backup.preview(tampered));
    await rejects(() => s.backup.restore(tampered, preview.expectedToken, true));
    equal(data(await s.backup.export(false)), data(before));
  }) },
  { name: "empty backup, cancel preview and explicit confirmation", run: () => withDB(async (s) => {
    const b = await s.backup.export(false); equal(Object.values(b.data).flat(), []);
    const p = await s.backup.preview(b); equal((await s.backup.export(false)).data, b.data);
    await rejects(() => s.backup.restore(b, p.expectedToken, false));
    equal((await s.backup.export(false)).data, b.data);
  }) },
  { name: "full graph round-trip: immutable versions, keep baseline, control, snapshot and measurements", run: () => withDB(async (s, raw) => {
    const b = await seeded(s);
    const p = await s.backup.preview(b); await s.backup.restore(b, p.expectedToken, true);
    equal(data(await s.backup.export(false)), data(b));
    check((await raw.counters.get("restoreGeneration"))?.value);
    equal((await s.programs.active())?.cursor, b.data.programState.find((r) => r.key === "activeProgram")?.payload);
  }) },
  { name: "restored active workout retains fact, unknown weight/RIR, timer and cursor", run: () => withDB(async (s) => {
    await seeded(s); const o = await s.sessions.overview(); check(o.active);
    const active = await s.sessions.start({ sessionId: id(), startedAt: later, expectedCursor: o.active.cursor, expectedHistoryRevision: o.historyRevision });
    const row = active.plannedSnapshot.exercises[0];
    await s.sessions.recordSet({ expectedHistoryRevision: await s.sessions.historyRevision(), expectedSet: null,
      set: { id: id(), sessionId: active.id, plannedExerciseId: row.id, originalExerciseId: row.exerciseId, actualExerciseId: row.exerciseId,
        index: 1, status: "done", actual: { type: "reps", reps: 7, weightKg: null }, rir: null, timestamp: later } });
    await s.sessions.timer({ sessionId: active.id, expectedTimer: null, timer: { id: id(), startedAt: later, deadline: "2026-11-25T10:02:00.000Z" } });
    const b = await s.backup.export(false);
    await withDB(async (target) => {
      const p = await target.backup.preview(b); await target.backup.restore(b, p.expectedToken, true);
      equal(data(await target.backup.export(false)), data(b)); equal((await target.sessions.overview()).session, (await s.sessions.overview()).session);
    });
    await rejects(() => s.backup.preview(b));
  }) },
  { name: "update + rollback chain and old opted measurement request survive restore", run: () => withDB(async (s) => {
    const original = await seeded(s); const first = original.data.programVersions[0].id;
    const a = await s.analysis.overview(time); check(a);
    const q = await s.coach.createReviewRequest(id(), time, a.token, ["weight"]);
    await s.coach.accept(await s.coach.importResponse({ ...example, requestId: q.requestId, context: q.context,
      proposedProgram: { ...example.proposedProgram, title: "Обновлённый план" } }), time, true);
    const after = await s.analysis.overview(time); check(after);
    await s.programs.rollback({ sourceId: first, expectedToken: after.token, createdAt: time, reviewAcknowledged: true });
    await s.body.deleteMeasurement(original.data.bodyMeasurements[0].id);
    const b = await s.backup.export(false); check(b.data.programVersions.length === 3);
    const saved = b.data.coachRequests.find((r) => r.requestId === q.requestId);
    check(saved?.measurementRevision === 1 && saved.payload.measurements?.length === 1);
    check(b.data.counters.find((r) => r.key === "measurementRevision")?.value === 2);
    await withDB(async (target) => {
      const p = await target.backup.preview(b); await target.backup.restore(b, p.expectedToken, true);
      equal(data(await target.backup.export(false)), data(b));
    });
  }) },
  { name: "stale preview detects profile and measurement changes", run: () => withDB(async (s) => {
    const b = await seeded(s); const p = await s.backup.preview(b);
    const current = await s.profiles.current(); check(current); await s.profiles.save({ ...current, revision: 2, goal: "Изменено" });
    await rejects(() => s.backup.restore(b, p.expectedToken, true));
    check((await s.profiles.current())?.goal === "Изменено");
    const p2 = await s.backup.preview(b);
    await s.body.addMeasurement({ id: id(), kind: "waist", unit: "cm", value: 80, measuredAt: time });
    await rejects(() => s.backup.restore(b, p2.expectedToken, true)); check((await s.body.overview()).measurements.length === 2);
  }) },
  { name: "two competing restores: exactly one wins; stale connections and fresh actions blocked", run: () => withDB(async (s, raw, name) => {
    const b = await seeded(s); const other = createTrainingStorage(name); const fresh = createTrainingStorage(name);
    try {
      await other.open(); const p = await s.backup.preview(b);
      const result = await Promise.allSettled([s.backup.restore(b, p.expectedToken, true), other.backup.restore(b, p.expectedToken, true)]);
      check(result.filter((r) => r.status === "fulfilled").length === 1);
      const current = await s.profiles.current(); check(current);
      await rejects(() => other.profiles.save({ ...current, revision: 2, goal: "Устаревшая форма" }));
      await fresh.open(); await rejects(() => fresh.body.addMeasurement({ id: id(), kind: "weight", value: 71, unit: "kg", measuredAt: time }));
      equal(data(await s.backup.export(false)), data(b)); check(await raw.counters.get("restoreGeneration"));
    } finally { other.close(); fresh.close(); }
  }) },
  { name: "preview is read-only; restore creates a local generation outside exported DTO", run: () => withDB(async (s, raw) => {
    const b = await seeded(s); const p = await s.backup.preview(b);
    equal(data(await s.backup.export(false)), data(b));
    await s.backup.restore(b, p.expectedToken, true); equal(data(await s.backup.export(false)), data(b));
    check(await raw.counters.get("restoreGeneration"));
  }) },
  { name: "invalid kind/version/DB version, envelope keys and dangling relations reject without writes", run: () => withDB(async (s) => {
    const b = await seeded(s);
    const bad: unknown[] = [ { ...b, kind: "coach_response" }, { ...b, version: 2 }, { ...b, databaseVersion: 5 }, { ...b, extra: true },
      { ...b, data: { ...b.data, sessions: [{ id: id(), status: "active", payload: {} }] } },
      { ...b, data: { ...b.data, profileRevisions: [] } },
      { ...b, data: { ...b.data, coachRequests: [] } },
      { ...b, data: { ...b.data, coachAcceptances: [] } },
      { ...b, data: { ...b.data, programVersions: b.data.programVersions.map((r) => ({ ...r, id: id() })) } },
      { ...b, data: { ...b.data, programState: b.data.programState.map((r) => r.key === "activeProgram" ? { ...r, payload: { ...r.payload, nextWorkoutIndex: 13 } } : r) } },
      { ...b, data: { ...b.data, bodyMeasurements: b.data.bodyMeasurements.map((r) => ({ ...r, id: id() })) } },
    ];
    for (const value of bad) { await rejects(() => s.backup.preview(value)); equal(data(await s.backup.export(false)), data(b)); }
  }) },
  { name: "duplicate IDs and revision gaps rejected", run: () => withDB(async (s) => {
    const b = await seeded(s);
    for (const value of [ { ...b, data: { ...b.data, profileRevisions: [...b.data.profileRevisions, ...b.data.profileRevisions] } },
      { ...b, data: { ...b.data, programVersions: b.data.programVersions.map((r) => ({ ...r, revision: 2 })) } },
      { ...b, data: { ...b.data, bodyMeasurements: [...b.data.bodyMeasurements, ...b.data.bodyMeasurements] } } ]) {
      await rejects(async () => validateBackup(value));
    }
  }) },
  { name: "fatal UTF-8, broken JSON, oversized pre-read and prototype keys reject", run: () => withDB(async (s) => {
    const b = await s.backup.export(false);
    for (const bytes of [new Uint8Array([0xff]), new TextEncoder().encode("<script>evil()</script>"), new TextEncoder().encode(JSON.stringify(b).replace('"kind":', '"__proto__":{},"kind":'))]) {
      await rejects(() => readBackupFile(new Blob([bytes])));
    }
    let read = false;
    await rejects(() => readBackupFile({ size: 96 * 1024 * 1024 + 1, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } })); check(!read);
    let deep: unknown = {}; for (let i = 0; i < 100; i++) deep = { child: deep };
    await rejects(async () => validateBackup(deep));
    equal(data(await readBackupFile(new Blob([JSON.stringify(b)]))), data(b));
  }) },
];
