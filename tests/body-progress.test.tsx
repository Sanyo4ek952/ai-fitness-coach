import "fake-indexeddb/auto";
import { Dexie, liveQuery } from "dexie";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bodyMeasurementSchema, coachRequestSchema, createTrainingStorage, progressPhotoSchema, selectMeasurements } from "@/entities/training";
import { inspectPhoto, prepareProgressPhoto, MAX_SOURCE_BYTES } from "@/entities/training/model/photo";
import { TrainingDatabase, storageSchemaV3 } from "@/shared/infrastructure/db";
import { BodyProgress } from "@/features/body-progress";
import { CoachExchange } from "@/features/coach-exchange";
import { runStorageCase } from "./storage-cases";
import { measurementDateInput, parseMeasurementDate } from "@/features/body-progress/measurement-date";
import example from "../examples/coach-response.example.json";

const id = () => crypto.randomUUID();
const now = "2026-11-25T00:00:00Z";
const profile = { id: id(), revision: 1, goal: "Синтетическая цель", experience: "unknown", sessionsPerWeek: null, equipment: ["dumbbells", "bench"], nutritionOptIn: false };
const measurement = (kind = "weight", value = 70.5, measuredAt = now) => ({ id: id(), kind, value, unit: kind === "weight" ? "kg" : "cm", measuredAt });
const jpeg = new Uint8Array([255, 216, 255, 192, 0, 8, 8, 0, 2, 0, 3, 1, 255, 217]);
const photo = () => { const blob = new Blob([jpeg], { type: "image/jpeg" }); return { id: id(), createdAt: now, mime: "image/jpeg", size: blob.size, width: 3, height: 2, blob }; };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("M5-02 schemas and export window", () => {
  it("local calendar date round-trip, rejects overflow and invalid date format", () => {
    const local = new Date(2026, 10, 25, 19, 30);
    expect(measurementDateInput(local)).toBe("25.11.2026");
    expect(new Date(parseMeasurementDate("25.11.2026")).getDate()).toBe(25);
    for (const input of ["31.02.2026", "25.13.2026", "2026-11-25", "25.11.26", ""]) expect(() => parseMeasurementDate(input)).toThrow();
  });
  it.each([0, -1, NaN, Infinity, 501])("invalid measurement %s", (value) => expect(bodyMeasurementSchema.safeParse(measurement("weight", value)).success).toBe(false));
  it("strict units/kinds, dates, technical bounds and small decimals", () => {
    expect(bodyMeasurementSchema.parse(measurement("waist", 0.001)).value).toBe(0.001);
    for (const input of [{ ...measurement(), unit: "cm" }, measurement("waist", 301), measurement("fat"), { ...measurement(), extra: true }, measurement("weight", 70, "2026-02-30T00:00:00Z")]) expect(bodyMeasurementSchema.safeParse(input).success).toBe(false);
  });
  it("90 days inclusive; explicit relevance, no future, deterministic, no mutation", () => {
    const start = new Date(Date.parse(now) - 90 * 86400000).toISOString();
    const items = [measurement("weight", 70, start), measurement("waist", 80), measurement("weight", 71), measurement("weight", 72, "2026-11-26T00:00:00Z"), measurement("weight", 73, "2026-08-26T23:59:59Z")];
    const before = JSON.stringify(items); const chosen = selectMeasurements(items, ["weight"], now);
    expect(chosen.map((item) => item.value)).toEqual([71, 70]); expect(selectMeasurements([...items].reverse(), ["weight"], now)).toEqual(chosen);
    expect(selectMeasurements(items, [], now)).toEqual([]); expect(JSON.stringify(items)).toBe(before);
    expect(() => selectMeasurements([items[0], items[0]], ["weight"], now)).toThrow();
  });
  it("SSR keeps section optional, no compulsory form, no photos or database access", () => {
    const html = renderToStaticMarkup(createElement(BodyProgress));
    expect(html).toContain("Замеры и фото — по желанию"); expect(html).toContain("<details>");
    expect(html).not.toContain("<form"); expect(html).not.toContain("<img"); expect(html).toContain("не зашифрована");
    const coach = renderToStaticMarkup(createElement(CoachExchange));
    expect(coach).toContain("Загружаем локальный обмен"); expect(coach).not.toContain("Замеры в этом экспорте"); expect(coach).not.toContain("checked=");
  });
});

describe("M5-02 transactions", () => {
  it("reopen, delete once, separate revision; all prior tables unchanged", () => runStorageCase({ name: "body", async run({ storage: s, raw, name, track }) {
    await s.profiles.save(profile);
    const tables = raw.tables.filter((table) => !["bodyMeasurements", "progressPhotos", "counters"].includes(table.name));
    const before = await Promise.all(tables.map((table) => table.toArray()));
    const m = measurement(); await s.body.addMeasurement(m); await s.body.addPhoto(photo()); s.close();
    const other = track(createTrainingStorage(name)); await other.open();
    expect((await other.body.overview()).measurements).toEqual([m]); expect((await other.body.overview()).photos).toHaveLength(1);
    await other.body.deleteMeasurement(m.id); await other.body.deleteMeasurement(m.id);
    expect(await other.body.revision()).toBe(2); expect(await other.sessions.historyRevision()).toBe(0);
    expect(await Promise.all(tables.map((table) => table.toArray()))).toEqual(before);
  } }));
  it("duplicate and failed writes roll back counter; keep original", () => runStorageCase({ name: "atomic", async run({ storage: s, raw }) {
    const m = measurement(); await s.body.addMeasurement(m);
    await expect(s.body.addMeasurement({ ...m, value: 99 })).rejects.toThrow(); expect(await s.body.revision()).toBe(1);
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(...args) { if (this.name === "bodyMeasurements") throw new DOMException("Synthetic quota", "QuotaExceededError"); return original.apply(this, args); };
    try { await expect(s.body.addMeasurement(measurement())).rejects.toThrow(); } finally { IDBObjectStore.prototype.add = original; }
    expect(await s.body.revision()).toBe(1); expect((await s.body.overview()).measurements).toEqual([m]);
    await raw.counters.delete("measurementRevision"); await expect(s.body.overview()).rejects.toThrow();
    await expect(s.body.addMeasurement(measurement())).rejects.toThrow(); expect(await raw.bodyMeasurements.count()).toBe(1);
  } }));
  it("two connections serialize revision and duplicate ID without lost records", () => runStorageCase({ name: "race", async run({ storage: s, name, track }) {
    const other = track(createTrainingStorage(name)); await other.open(); const m = measurement();
    const results = await Promise.allSettled([s.body.addMeasurement(m), other.body.addMeasurement(m)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await Promise.all([s.body.addMeasurement(measurement()), other.body.addMeasurement(measurement())]);
    expect(await s.body.revision()).toBe(3); expect((await s.body.overview()).measurements).toHaveLength(3);
  } }));
  it("photo deletion uses displayed IDs only; no measurement/history changes", () => runStorageCase({ name: "delete", async run({ storage: s }) {
    const a = photo(), b = photo(); await s.body.addPhoto(a); await s.body.addPhoto(b);
    await s.body.deletePhotos([a.id]); expect((await s.body.overview()).photos.map((item) => item.id)).toEqual([b.id]);
    await s.body.deletePhotos([b.id]); expect((await s.body.overview()).photos).toEqual([]);
    expect(await s.body.revision()).toBe(0); expect(await s.sessions.historyRevision()).toBe(0);
  } }));
  it("failed delete leaves record and revision; malformed envelope rejects entire overview", () => runStorageCase({ name: "delete-fail", async run({ storage: s, raw }) {
    const m = measurement(); await s.body.addMeasurement(m); const original = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function(...args) { if (this.name === "bodyMeasurements") throw new Error("Synthetic failure"); return original.apply(this, args); };
    try { await expect(s.body.deleteMeasurement(m.id)).rejects.toThrow(); } finally { IDBObjectStore.prototype.delete = original; }
    expect(await s.body.revision()).toBe(1); expect((await s.body.overview()).measurements).toEqual([m]);
    await raw.bodyMeasurements.put({ id: id(), payload: m }); await expect(s.body.overview()).rejects.toThrow("ключ");
  } }));
  it("bulk photo delete failure rolls back all selected blobs", () => runStorageCase({ name: "photo-delete-fail", async run({ storage: s, raw }) {
    const a = photo(), b = photo(); await s.body.addPhoto(a); await s.body.addPhoto(b);
    const original = IDBObjectStore.prototype.delete; let calls = 0;
    IDBObjectStore.prototype.delete = function(...args) { if (this.name === "progressPhotos" && ++calls === 2) throw new Error("Synthetic failure"); return original.apply(this, args); };
    try { await expect(s.body.deletePhotos([a.id, b.id])).rejects.toThrow(); } finally { IDBObjectStore.prototype.delete = original; }
    expect(await raw.progressPhotos.count()).toBe(2);
  } }));
  it("photo limits, invalid MIME/size/dimensions; no false save", () => runStorageCase({ name: "limits", async run({ storage: s, raw }) {
    await expect(s.body.addPhoto({ ...photo(), width: 4 })).rejects.toThrow();
    expect(progressPhotoSchema.safeParse({ ...photo(), mime: "image/svg+xml" }).success).toBe(false);
    expect(progressPhotoSchema.safeParse({ ...photo(), size: 999 }).success).toBe(false);
    for (let n = 0; n < 20; n++) await s.body.addPhoto(photo());
    await expect(s.body.addPhoto(photo())).rejects.toThrow("20 фото"); expect(await raw.progressPhotos.count()).toBe(20);
    await raw.bodyMeasurements.bulkAdd(Array.from({ length: 1000 }, () => { const payload = measurement(); return { id: payload.id, payload }; }));
    await raw.counters.put({ key: "measurementRevision", value: 1000 });
    await expect(s.body.addMeasurement(measurement())).rejects.toThrow("1000"); expect(await s.body.revision()).toBe(1000);
  } }));
  it("live query observes another connection's committed measurement", () => runStorageCase({ name: "live", async run({ storage: s, name, track }) {
    const other = track(createTrainingStorage(name)); await other.open();
    let sub: { unsubscribe(): void } | undefined;
    try { await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("liveQuery timeout")), 2000);
      sub = liveQuery(() => s.body.overview()).subscribe({ next(value) { if (value.measurements.length === 1) { clearTimeout(timeout); resolve(); } }, error: reject });
      void other.body.addMeasurement(measurement()).catch(reject);
    }); } finally { sub?.unsubscribe(); }
  } }));
});

describe("M5-02 AI consent and stale facts", () => {
  it("default excludes body/photos, selected types only, strict DTO", () => runStorageCase({ name: "consent", async run({ storage: s, raw }) {
    await s.profiles.save(profile); await s.body.addMeasurement(measurement()); await s.body.addMeasurement(measurement("waist", 80)); await s.body.addPhoto(photo());
    const plain = await s.coach.createInitialRequest(id(), now); expect(plain).not.toHaveProperty("measurements");
    const chosen = await s.coach.createInitialRequest(id(), now, ["waist"]); expect(chosen.measurements?.map((item) => item.kind)).toEqual(["waist"]);
    expect(JSON.stringify(chosen)).not.toMatch(/image\/jpeg|EXIF|filename|progressPhotos|measurementRevision/);
    expect(coachRequestSchema.safeParse({ ...chosen, photos: [] }).success).toBe(false);
    expect(coachRequestSchema.safeParse({ ...chosen, measurements: [measurement("weight", 70, "2026-11-26T00:00:00Z")] }).success).toBe(false);
    expect((await raw.coachRequests.get(chosen.requestId))?.measurementRevision).toBe(2);
  } }));
  it("opted request invalidated on add/delete; plain request remains valid", () => runStorageCase({ name: "stale", async run({ storage: s }) {
    await s.profiles.save(profile); const m = measurement(); await s.body.addMeasurement(m);
    const opted = await s.coach.createInitialRequest(id(), now, ["weight"]);
    const plain = await s.coach.createInitialRequest(id(), now);
    await s.body.deleteMeasurement(m.id);
    await expect(s.coach.importResponse({ ...example, requestId: opted.requestId, context: opted.context })).rejects.toThrow("Замеры изменились");
    await expect(s.coach.importResponse({ ...example, requestId: plain.requestId, context: plain.context })).resolves.toBeDefined();
  } }));
  it("review measurement mutation after preview prevents acceptance; old versions remain", () => runStorageCase({ name: "review-stale", async run({ storage: s, raw }) {
    await s.profiles.save(profile); const first = await s.coach.createInitialRequest(id(), now);
    const accepted = await s.coach.importResponse({ ...example, requestId: first.requestId, context: first.context }); await s.coach.accept(accepted, now, true);
    const before = await raw.programVersions.toArray(); const analysis = await s.analysis.overview(now); if (!analysis) throw new Error("analysis");
    const review = await s.coach.createReviewRequest(id(), now, analysis.token, ["weight"]);
    expect(review.measurements).toEqual([]);
    const response = await s.coach.importResponse({ schemaVersion: 1, kind: "coach_response", requestId: review.requestId, context: review.context,
      decision: "keep", summary: "Оставить", reasons: ["Синтетика"], nutritionTips: [] });
    await s.body.addMeasurement(measurement());
    await expect(s.coach.accept(response, now, true)).rejects.toThrow("Замеры изменились");
    expect(await raw.programVersions.toArray()).toEqual(before); expect(await raw.coachAcceptances.count()).toBe(1);
  } }));
});

describe("M5-02 upgrade", () => {
  it("v3 to v4 preserves every old store byte for byte; adds empty body stores", async () => {
    const name = `m5-02-migration-${id()}`; const old = new Dexie(name); old.version(3).stores(storageSchemaV3);
    const next = new TrainingDatabase(name);
    try {
      await old.open();
      for (const table of old.tables) {
        const key = table.schema.primKey.name;
        await table.add({ [key]: key === "revision" ? 1 : id(), payload: { synthetic: table.name }, ...(table.name === "programVersions" ? { revision: 1 } : {}) });
      }
      const before = await Promise.all(old.tables.map(async (table) => [table.name, await table.toArray()])); old.close();
      await next.open(); expect(next.verno).toBe(4);
      for (const [name, rows] of before) { if (typeof name !== "string") throw new Error("table"); expect(await next.table(name).toArray()).toEqual(rows); }
      expect(await next.bodyMeasurements.count()).toBe(0); expect(await next.progressPhotos.count()).toBe(0);
    } finally { old.close(); next.close(); await Dexie.delete(name); }
  });
});

describe("M5-02 image boundary and lifecycle", () => {
  it("PNG signature/dimensions; rejects animation and malformed chunks before decode", () => {
    const bytes = new Uint8Array(45); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); const view = new DataView(bytes.buffer);
    view.setUint32(8, 13); view.setUint32(12, 0x49484452); view.setUint32(16, 600); view.setUint32(20, 400);
    view.setUint32(37, 0x49454e44);
    expect(inspectPhoto(bytes, "image/png")).toEqual({ width: 600, height: 400 });
    view.setUint32(37, 0x6163544c); expect(() => inspectPhoto(bytes, "image/png")).toThrow("статичное");
    view.setUint32(33, 999); expect(() => inspectPhoto(bytes, "image/png")).toThrow("Повреждён");
  });
  it("JPEG dimensions; rejects masquerading SVG, corrupted header, huge dimensions", () => {
    expect(inspectPhoto(jpeg, "image/jpeg")).toEqual({ width: 3, height: 2 });
    expect(() => inspectPhoto(new TextEncoder().encode("<svg onload='bad()'/>"), "image/jpeg")).toThrow();
    expect(() => inspectPhoto(jpeg, "image/png")).toThrow();
    const huge = jpeg.slice(); huge[7] = 255; expect(() => inspectPhoto(huge, "image/jpeg")).toThrow();
  });
  it("oversized or empty source rejected before decoding", async () => {
    await expect(prepareProgressPhoto(new Blob([]), id(), now)).rejects.toThrow("5 МиБ");
    await expect(prepareProgressPhoto(new Blob([new Uint8Array(MAX_SOURCE_BYTES + 1)]), id(), now)).rejects.toThrow("5 МиБ");
  });
  it("decode failure revokes object URL, creates no record", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    vi.stubGlobal("Image", class { src = ""; async decode() { throw new Error("decode failure"); } });
    await expect(prepareProgressPhoto(new Blob([jpeg], { type: "image/jpeg" }), id(), now)).rejects.toThrow("decode failure"); expect(revoke).toHaveBeenCalledTimes(1);
  });
  it("canvas copy only, strips original metadata; output errors revoke URL", async () => {
    const clean = new Blob([jpeg], { type: "image/jpeg" });
    vi.stubGlobal("Image", class { src = ""; naturalWidth = 3; naturalHeight = 2; async decode() {} });
    const drawImage = vi.fn(); const toBlob = vi.fn((callback: BlobCallback) => callback(clean));
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage }), toBlob }) });
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const saved = await prepareProgressPhoto(new Blob([jpeg], { type: "image/jpeg" }), id(), now);
    expect(saved.blob).toBe(clean); expect(drawImage).toHaveBeenCalledTimes(1); expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.85); expect(revoke).toHaveBeenCalledTimes(1);
    toBlob.mockImplementation((callback: BlobCallback) => callback(null));
    await expect(prepareProgressPhoto(clean, id(), now)).rejects.toThrow(); expect(revoke).toHaveBeenCalledTimes(2);
  });
});
