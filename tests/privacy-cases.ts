import { Dexie } from "dexie";
import { createTrainingStorage, type TrainingStorage } from "@/entities/training";
import { TrainingDatabase } from "@/shared/infrastructure/db";

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function rejects(action: () => Promise<unknown>) { let failed = false; try { await action(); } catch { failed = true; } check(failed, "Операция ошибочно разрешена"); }
async function withDB(run: (s: TrainingStorage, raw: TrainingDatabase, name: string) => Promise<void>) {
  const name = `m6-03-test-${crypto.randomUUID()}`; const s = createTrainingStorage(name); const raw = new TrainingDatabase(name);
  try { await s.open(); await raw.open(); await run(s, raw, name); }
  finally { s.close(); raw.close(); await Dexie.delete(name); }
}
async function profile(s: TrainingStorage) {
  return s.profiles.save({ id: crypto.randomUUID(), revision: 1, goal: "Синтетическая приватная цель", experience: "unknown", sessionsPerWeek: null, equipment: ["unknown"], nutritionOptIn: false });
}
async function rawSnapshot(db: TrainingDatabase) { return Promise.all(db.tables.map((t) => t.toArray())); }

export const privacyCases: readonly { name: string; run: () => Promise<void> }[] = [
  { name: "read-only preview/cancel and unchecked confirmation never erase", run: () => withDB(async (s, raw) => {
    await profile(s); const before = await rawSnapshot(raw); const p = await s.privacy.preview();
    check(p.counts.find((r) => r.name === "profileRevisions")?.count === 1, "Состав");
    await rejects(() => s.privacy.erase(p.expectedToken, false));
    await rejects(() => s.privacy.erase(p.expectedToken, "true"));
    check(JSON.stringify(await rawSnapshot(raw)) === JSON.stringify(before), "Запись до подтверждения");
  }) },
  { name: "erase every store including damaged historical sensitive envelopes and active session", run: () => withDB(async (s, raw, name) => {
    await profile(s); const backup = await s.backup.export(false); const restore = await s.backup.preview(backup);
    // Intentionally invalid historical data must not make privacy erasure impossible.
    for (const table of raw.tables.filter((t) => t.name !== "profileRevisions")) {
      await table.put({ id: crypto.randomUUID(), requestId: crypto.randomUUID(), key: `sensitive-${table.name}`, revision: 1,
        status: "active", payload: { secret: "Синтетические прежние сведения", blob: new Blob(["synthetic"]) }, value: "synthetic" });
    }
    const p = await s.privacy.preview(); await s.privacy.erase(p.expectedToken, true);
    for (const table of raw.tables) {
      const rows = await table.toArray(); check(rows.length === (table.name === "counters" ? 1 : 0), `Не очищено: ${table.name}`);
    }
    check(typeof (await raw.counters.get("restoreGeneration"))?.value === "string", "Нет поколения");
    await rejects(() => s.backup.restore(backup, restore.expectedToken, true));
    await rejects(() => profile(s));
    s.close(); await s.open(); await rejects(() => profile(s));
    const action = createTrainingStorage(name);
    try { await action.open(); await rejects(() => profile(action)); } finally { action.close(); }
    check(await s.backup.needsReload(), "Старая страница должна перезагрузиться");
  }) },
  { name: "concurrent write after preview blocks erase without partial deletion", run: () => withDB(async (s, raw) => {
    await profile(s); const p = await s.privacy.preview();
    await raw.counters.put({ key: "synthetic-timer", value: 2 }); const before = await rawSnapshot(raw);
    await rejects(() => s.privacy.erase(p.expectedToken, true));
    check(JSON.stringify(await rawSnapshot(raw)) === JSON.stringify(before), "Частичная очистка");
  }) },
  { name: "two erasures commit exactly once and stale restore previews cannot resurrect data", run: () => withDB(async (s, raw, name) => {
    await profile(s); const other = createTrainingStorage(name);
    try {
      await other.open(); const p = await s.privacy.preview(); const q = await other.privacy.preview();
      const results = await Promise.allSettled([s.privacy.erase(p.expectedToken, true), other.privacy.erase(q.expectedToken, true)]);
      check(results.filter((r) => r.status === "fulfilled").length === 1, "Ожидалось одно удаление");
      check(await raw.profileRevisions.count() === 0, "Профиль остался");
    } finally { other.close(); }
  }) },
];
