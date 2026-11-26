import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IDBObjectStore } from "fake-indexeddb";
import { Dexie } from "dexie";
import { createTrainingStorage, validateBackup, readBackupFile } from "@/entities/training";
import { TrainingDatabase, storageSchemaV1 } from "@/shared/infrastructure/db";
import { BackupPanel } from "@/features/backup";
import { backupCases } from "./backup-cases";
afterEach(() => vi.restoreAllMocks());
for (const test of backupCases) it(`M6-02 ${test.name}`, test.run);

it("SSR: optional photo consent, privacy/replacement warning, no DB/file access", () => {
  const html = renderToStaticMarkup(createElement(BackupPanel));
  expect(html).toContain("не зашифрован"); expect(html).toContain("Фото заменяются тоже");
  expect(html).not.toContain('checked=""'); expect(html).not.toContain("Заменить данные этой копией");
});

it("injected fake-IDB write quota at the final photo store rolls back all stores, then retry", async () => {
  const name = `m6-02-quota-${crypto.randomUUID()}`; const s = createTrainingStorage(name); const raw = new TrainingDatabase(name);
  try {
    await s.open(); await raw.open();
    const p = { id: crypto.randomUUID(), revision: 1, goal: "Текущая цель", experience: "unknown", sessionsPerWeek: null, equipment: ["unknown"], nutritionOptIn: false };
    await s.profiles.save(p);
    const jpeg = new Uint8Array([255,216,255,192,0,8,8,0,2,0,3,1,255,217]); const blob = new Blob([jpeg], { type: "image/jpeg" });
    await s.body.addPhoto({ id: crypto.randomUUID(), createdAt: "2026-11-25T00:00:00Z", mime: blob.type, size: blob.size, width: 3, height: 2, blob });
    const withPhoto = await s.backup.export(true); const without = await s.backup.export(false);
    expect(without.data.progressPhotos).toEqual([]); expect(withPhoto.data.progressPhotos).toHaveLength(1);
    const incoming = validateBackup({ ...withPhoto, data: { ...withPhoto.data, profileRevisions: withPhoto.data.profileRevisions.map((r) => ({ ...r, payload: { ...r.payload, goal: "Цель копии" } })) } });
    const preview = await s.backup.preview(incoming);
    const original = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
      if (this.name === "progressPhotos") throw new DOMException("Synthetic quota", "QuotaExceededError");
      return original.apply(this, args);
    });
    await expect(s.backup.restore(incoming, preview.expectedToken, true)).rejects.toThrow();
    expect((await s.backup.export(true)).data).toEqual(withPhoto.data);
    vi.restoreAllMocks(); await s.backup.restore(incoming, preview.expectedToken, true);
    expect((await s.backup.export(true)).data).toEqual(incoming.data);
    expect(new Uint8Array(await (await s.body.overview()).photos[0].blob.arrayBuffer())).toEqual(jpeg);
  } finally { s.close(); raw.close(); await Dexie.delete(name); }
});

it("backup without photos explicitly replaces and removes current photos", async () => {
  const name = `m6-02-no-photo-${crypto.randomUUID()}`; const s = createTrainingStorage(name);
  try {
    await s.open(); const copy = await s.backup.export(false);
    const blob = new Blob([new Uint8Array([255,216,255,192,0,8,8,0,2,0,3,1,255,217])], { type: "image/jpeg" });
    await s.body.addPhoto({ id: crypto.randomUUID(), createdAt: "2026-11-25T00:00:00Z", mime: blob.type, size: blob.size, width: 3, height: 2, blob });
    const p = await s.backup.preview(copy); expect(p.current.photos).toBe(1);
    await s.backup.restore(copy, p.expectedToken, true); expect((await s.body.overview()).photos).toEqual([]);
  } finally { s.close(); await Dexie.delete(name); }
});

it("v1 IndexedDB upgrade exports a valid v1 backup, no invented activation or counters", async () => {
  const name = `m6-02-migration-${crypto.randomUUID()}`; const old = new Dexie(name); old.version(1).stores(storageSchemaV1);
  const s = createTrainingStorage(name);
  try {
    await old.open();
    await old.table("profileRevisions").add({ revision: 1, payload: { id: crypto.randomUUID(), revision: 1, goal: "Синтетическая цель",
      experience: "unknown", equipment: ["unknown"], sessionsPerWeek: null, nutritionOptIn: false } });
    old.close(); await s.open(); const copy = await s.backup.export(false);
    expect(copy.data.profileRevisions).toHaveLength(1); expect(copy.data.programState).toEqual([]); expect(copy.data.counters).toEqual([]);
    const p = await s.backup.preview(copy); await s.backup.restore(copy, p.expectedToken, true);
    expect((await s.backup.export(false)).data).toEqual(copy.data);
  } finally { old.close(); s.close(); await Dexie.delete(name); }
});

it("malformed stored analysis provenance/snapshot/measurementRevision rejects the full graph", async () => {
  const name = `m6-02-provenance-${crypto.randomUUID()}`; const s = createTrainingStorage(name); const raw = new TrainingDatabase(name);
  try {
    await s.open(); await raw.open();
    const empty = await s.backup.export(false);
    for (const state of [
      { key: "analysisBaseline", payload: { requestId: crypto.randomUUID(), programVersionId: crypto.randomUUID() } },
      { key: "analysisSnapshot", payload: { baselineKey: crypto.randomUUID(), reasonCodes: [], facts: [] } },
      { key: "analysisControl", payload: { baselineKey: crypto.randomUUID(), manual: false, snooze: null } },
    ]) {
      await expect(s.backup.preview({ ...empty, data: { ...empty.data, programState: [state] } })).rejects.toThrow();
    }
    expect((await s.backup.export(false)).data).toEqual(empty.data);
  } finally { s.close(); raw.close(); await Dexie.delete(name); }
});

it("photo data limits, malformed base64, wrong dimensions and metadata rejected", async () => {
  const name = `m6-02-photo-${crypto.randomUUID()}`; const s = createTrainingStorage(name);
  try {
    await s.open(); const empty = await s.backup.export(false);
    const p = { id: crypto.randomUUID(), createdAt: "2026-11-25T00:00:00Z", mime: "image/jpeg", size: 1, width: 1, height: 1, data: "AA==" };
    for (const photo of [p, { ...p, data: "<svg/>" }, { ...p, size: 2 * 1024 * 1024 + 1 }]) {
      await expect(s.backup.preview({ ...empty, photosIncluded: true, data: { ...empty.data, progressPhotos: [{ id: p.id, payload: photo }] } })).rejects.toThrow();
    }
    const withExif = new Uint8Array([255,216,255,225,0,8,69,120,105,102,0,0,255,192,0,8,8,0,2,0,3,1,255,217]);
    const metadataPhoto = { ...p, size: withExif.length, width: 3, height: 2, data: btoa(String.fromCharCode(...withExif)) };
    await expect(s.backup.preview({ ...empty, photosIncluded: true, data: { ...empty.data, progressPhotos: [{ id: p.id, payload: metadataPhoto }] } })).rejects.toThrow("метаданные");
    await expect(readBackupFile(new Blob([JSON.stringify({ ...empty, photosIncluded: false, data: { ...empty.data, progressPhotos: [{ id: p.id, payload: p }] } })]))).rejects.toThrow();
  } finally { s.close(); await Dexie.delete(name); }
});
