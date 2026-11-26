import { Dexie } from "dexie";
import { createTrainingStorage, prepareProgressPhoto } from "@/entities/training";
import { TrainingDatabase, storageSchemaV3 } from "@/shared/infrastructure/db";

const button = document.querySelector<HTMLButtonElement>("#run");
const results = document.querySelector("#results");
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function rejects(action: () => Promise<unknown>) { try { await action(); } catch { return; } throw new Error("Expected rejection"); }
async function image(type = "image/png") {
  const canvas = document.createElement("canvas"); canvas.width = 2400; canvas.height = 1200;
  const ctx = canvas.getContext("2d"); check(ctx, "canvas"); ctx.fillStyle = "#1b96b7"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("encode")), type));
}
async function decoded(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try { const img = new Image(); img.src = url; await img.decode(); return [img.naturalWidth, img.naturalHeight]; }
  finally { URL.revokeObjectURL(url); }
}
async function run() {
  if (!button || !results) return;
  button.disabled = true; results.textContent = "Выполняется…\n";
  const name = `m5-02-native-${crypto.randomUUID()}`;
  const storage = createTrainingStorage(name); const raw = new TrainingDatabase(name);
  const second = createTrainingStorage(name); const old = new Dexie(name); old.version(3).stores(storageSchemaV3);
  let passed = 0;
  async function test(label: string, action: () => Promise<void>) { await action(); passed++; results!.textContent += `PASS ${label}\n`; }
  try {
    await test("v3→v4: все старые таблицы неизменны", async () => {
      await old.open();
      for (const table of old.tables) await table.add({ [table.schema.primKey.name]: table.name === "profileRevisions" ? 1 : crypto.randomUUID(), payload: { synthetic: table.name }, ...(table.name === "programVersions" ? { revision: 1 } : {}) });
      const before = await Promise.all(old.tables.map(async (table) => ({ name: table.name, rows: await table.toArray() })));
      old.close(); await storage.open(); await raw.open();
      check(raw.verno === 4, "version");
      for (const table of before) check(JSON.stringify(await raw.table(table.name).toArray()) === JSON.stringify(table.rows), table.name);
    });
    const now = new Date().toISOString();
    const prepared = await prepareProgressPhoto(await image(), crypto.randomUUID(), now);
    await test("PNG→JPEG canvas 2400×1200→1600×800, native decode", async () => {
      check(prepared.mime === "image/jpeg" && prepared.width === 1600 && prepared.height === 800 && prepared.size < 2 * 1024 * 1024, "output");
      check(JSON.stringify(await decoded(prepared.blob)) === "[1600,800]", "decode");
    });
    await test("JPEG source and EXIF segment stripped from fresh copy", async () => {
      const source = new Uint8Array(await (await image("image/jpeg")).arrayBuffer());
      const marker = new Uint8Array([255, 225, 0, 17, 69, 120, 105, 102, 0, 0, 83, 89, 78, 84, 72, 69, 84, 73, 67]);
      const bytes = new Uint8Array(source.length + marker.length); bytes.set(source.slice(0, 2)); bytes.set(marker, 2); bytes.set(source.slice(2), 2 + marker.length);
      const clean = await prepareProgressPhoto(new Blob([bytes], { type: "image/jpeg" }), crypto.randomUUID(), now);
      check(!new TextDecoder("latin1").decode(await clean.blob.arrayBuffer()).includes("Exif"), "EXIF retained");
      await decoded(clean.blob);
    });
    await test("native Blob round-trip and reopen", async () => {
      await storage.body.addPhoto(prepared); storage.close(); await storage.open();
      const saved = (await storage.body.overview()).photos[0]; check(saved.blob instanceof Blob && saved.size === prepared.size, "blob");
      check(JSON.stringify(await decoded(saved.blob)) === "[1600,800]", "stored decode");
    });
    await test("SVG masquerade and broken PNG rejected without save", async () => {
      await rejects(() => prepareProgressPhoto(new Blob(["<svg onload='bad()'/>"] , { type: "image/png" }), crypto.randomUUID(), now));
      const broken = new Uint8Array(await (await image()).arrayBuffer()); broken[broken.length - 30] ^= 255;
      await rejects(() => prepareProgressPhoto(new Blob([broken.slice(0, 40)], { type: "image/png" }), crypto.randomUUID(), now));
      check(await raw.progressPhotos.count() === 1, "false save");
    });
    await test("quota injection rolls back measurement and counter", async () => {
      const original = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function(...args) { if (this.name === "bodyMeasurements") throw new DOMException("Synthetic quota", "QuotaExceededError"); return original.apply(this, args); };
      try { await rejects(() => storage.body.addMeasurement({ id: crypto.randomUUID(), kind: "weight", value: 70.5, unit: "kg", measuredAt: now })); }
      finally { IDBObjectStore.prototype.add = original; }
      check(await raw.bodyMeasurements.count() === 0 && await storage.body.revision() === 0, "rollback");
    });
    await test("second connection: exact selected IDs delete, new photo retained", async () => {
      await second.open(); const added = { ...prepared, id: crypto.randomUUID() }; await second.body.addPhoto(added);
      await storage.body.deletePhotos([prepared.id]);
      check((await second.body.overview()).photos[0]?.id === added.id && await raw.progressPhotos.count() === 1, "delete selection");
    });
    results.textContent += `ИТОГ: ${passed}/7 успешно. Только синтетическая временная БД.\n`;
  } catch (cause) { results.textContent += `FAIL ${cause instanceof Error ? cause.message : String(cause)}\n`; }
  finally { old.close(); second.close(); storage.close(); raw.close(); await Dexie.delete(name); button.disabled = false; }
}
button?.addEventListener("click", () => { void run(); });
