import { Dexie } from "dexie";
import { createTrainingStorage, prepareProgressPhoto, readBackupFile } from "@/entities/training";
import { backupCases } from "../backup-cases";

const button = document.querySelector<HTMLButtonElement>("#run"); const results = document.querySelector("#results");
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }
async function photoCase() {
  const name = `m6-02-native-${crypto.randomUUID()}`; const s = createTrainingStorage(name);
  const target = createTrainingStorage(`${name}-target`);
  const original = IDBObjectStore.prototype.add;
  try {
    await s.open(); await target.open();
    const canvas = document.createElement("canvas"); canvas.width = 60; canvas.height = 40;
    const context = canvas.getContext("2d"); check(context, "canvas"); context.fillStyle = "#0680ab"; context.fillRect(0, 0, 60, 40);
    const source = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("canvas")), "image/png"));
    const photo = await prepareProgressPhoto(source, crypto.randomUUID(), new Date().toISOString());
    await s.body.addPhoto(photo);
    const backup = await s.backup.export(true); const file = new Blob([JSON.stringify(backup)]);
    const parsed = await readBackupFile(file); const p = await target.backup.preview(parsed);
    IDBObjectStore.prototype.add = function (...args: Parameters<typeof original>) {
      if (this.name === "progressPhotos") throw new DOMException("Synthetic quota", "QuotaExceededError");
      return original.apply(this, args);
    };
    let rejected = false; try { await target.backup.restore(parsed, p.expectedToken, true); } catch { rejected = true; }
    check(rejected && (await target.body.overview()).photos.length === 0, "quota rollback");
    IDBObjectStore.prototype.add = original;
    await target.backup.restore(parsed, p.expectedToken, true);
    const restored = (await target.body.overview()).photos[0]; check(restored, "restored photo");
    check(JSON.stringify(Array.from(new Uint8Array(await restored.blob.arrayBuffer()))) === JSON.stringify(Array.from(new Uint8Array(await photo.blob.arrayBuffer()))), "blob byte roundtrip");
    const url = URL.createObjectURL(restored.blob);
    try { const img = new Image(); img.src = url; await img.decode(); check(img.naturalWidth === 60 && img.naturalHeight === 40, "decode"); }
    finally { URL.revokeObjectURL(url); }
    check((await s.backup.export(false)).data.progressPhotos.length === 0, "photo opt out");
  } finally { IDBObjectStore.prototype.add = original; s.close(); target.close(); await Dexie.delete(name); await Dexie.delete(`${name}-target`); }
}
button?.addEventListener("click", () => {
  if (!results || !button) return;
  button.disabled = true; results.textContent = "Выполняется…\n";
  void (async () => {
    let passed = 0;
    for (const item of [...backupCases, { name: "native JPEG/base64/Blob/file round-trip + quota rollback/retry", run: photoCase }]) {
      await item.run(); passed++; results.textContent += `PASS ${item.name}\n`;
    }
    results.textContent += `PASS ${passed}/${backupCases.length + 1}\n`;
  })().catch((cause: unknown) => { results.textContent += `FAIL ${cause instanceof Error ? cause.stack : String(cause)}\n`; }).finally(() => { button.disabled = false; });
});
