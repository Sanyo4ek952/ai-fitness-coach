import "fake-indexeddb/auto";
import { Dexie } from "dexie";
import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TrainingDatabase } from "@/shared/infrastructure/db";
import { createTrainingStorage } from "@/entities/training";
import { PrivacyPanel } from "@/features/privacy";
import { storagePersistence } from "@/features/privacy/storage-persistence";
import { privacyCases } from "./privacy-cases";

afterEach(() => vi.restoreAllMocks());
for (const item of privacyCases) it(item.name, item.run);

it("a new page module adopts deletion generation and can create a new profile; old page remains blocked", async () => {
  const name = `m6-03-new-page-${crypto.randomUUID()}`; const oldPage = createTrainingStorage(name);
  try {
    await oldPage.open(); const p = await oldPage.privacy.preview(); await oldPage.privacy.erase(p.expectedToken, true);
    // Simulate a new JS page lifetime without weakening the production guard.
    vi.resetModules();
    const freshModule = await import("@/entities/training/api/storage");
    const newPage = freshModule.createTrainingStorage(name);
    try {
      await newPage.open(); expect(await newPage.backup.needsReload()).toBe(false);
      await newPage.profiles.save({ id: crypto.randomUUID(), revision: 1, goal: "Новая синтетическая цель", experience: "unknown", sessionsPerWeek: null, equipment: ["unknown"], nutritionOptIn: false });
      expect((await newPage.backup.export(false)).data.profileRevisions).toHaveLength(1);
      expect(await oldPage.backup.needsReload()).toBe(true);
      await expect(oldPage.privacy.erase((await oldPage.privacy.preview()).expectedToken, true)).rejects.toThrow();
    } finally { newPage.close(); }
  } finally { oldPage.close(); await Dexie.delete(name); }
});

it("last tombstone write failure rolls back all clears; explicit retry succeeds", async () => {
  const name = `m6-03-rollback-${crypto.randomUUID()}`; const s = createTrainingStorage(name); const raw = new TrainingDatabase(name);
  try {
    await s.open(); await raw.open();
    await raw.profileRevisions.put({ revision: 1, payload: { secret: "synthetic" } });
    await raw.progressPhotos.put({ id: "synthetic-photo", payload: new Blob(["synthetic-photo"]) });
    const p = await s.privacy.preview(); const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
      if (this.name === "counters") throw new DOMException("Synthetic failure", "QuotaExceededError");
      return original.apply(this, args);
    });
    await expect(s.privacy.erase(p.expectedToken, true)).rejects.toThrow();
    expect(await raw.profileRevisions.count()).toBe(1); expect(await raw.progressPhotos.count()).toBe(1);
    expect(await s.backup.needsReload()).toBe(false);
    vi.restoreAllMocks(); await s.privacy.erase(p.expectedToken, true);
    expect(await raw.profileRevisions.count()).toBe(0); expect(await raw.progressPhotos.count()).toBe(0);
  } finally { s.close(); raw.close(); await Dexie.delete(name); }
});

it("persistent storage feature detection, read-only check, refusal, grant and rejection", async () => {
  expect(await storagePersistence(undefined, true)).toBe("unsupported");
  expect(await storagePersistence({}, true)).toBe("unsupported");
  const persist = vi.fn(async () => false); const persisted = vi.fn(async () => false);
  expect(await storagePersistence({ persisted, persist })).toBe("best-effort"); expect(persist).not.toHaveBeenCalled();
  expect(await storagePersistence({ persisted, persist }, true)).toBe("best-effort");
  expect(await storagePersistence({ persisted }, true)).toBe("unsupported");
  expect(await storagePersistence({ persisted: async () => true, persist }, true)).toBe("persistent");
  expect(persist).toHaveBeenCalledTimes(1);
  expect(await storagePersistence({ persisted, persist: async () => true }, true)).toBe("persistent");
  await expect(storagePersistence({ persisted: async () => { throw new DOMException("Denied", "SecurityError"); } })).rejects.toThrow();
  await expect(storagePersistence({ persisted, persist: async () => { throw new Error("failure"); } }, true)).rejects.toThrow();
});

it("privacy UI explains historical/external copies, no automatic deletion or consent", () => {
  const html = renderToStaticMarkup(<PrivacyPanel />);
  expect(html).toContain("старые ревизии"); expect(html).toContain("внешних чатах");
  expect(html).toContain("не гарантирует сохранность"); expect(html).toContain("Проверить состав перед удалением");
  expect(html).not.toContain('type="checkbox"'); expect(html).not.toContain("Подтверждение полного удаления");
});
