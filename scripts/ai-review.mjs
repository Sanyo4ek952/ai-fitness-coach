import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

// A local CLI using the existing Vite transformer; no listener, model or DB.
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ root, configFile: false, appType: "custom",
  resolve: { alias: { "@": path.join(root, "src") } },
  server: { middlewareMode: true, watch: null, hmr: false } });
try {
  const { createAiReviewCases } = await server.ssrLoadModule("/tests/ai-review-fixtures.ts");
  const cases = createAiReviewCases();
  const [command, caseId, responsePath] = process.argv.slice(2);
  if (command === "generate") {
    const directory = path.join(root, "local-data", "ai-review");
    await mkdir(directory, { recursive: true });
    const manifest = [];
    for (const item of cases) {
      const json = JSON.stringify(item.request, null, 2);
      await writeFile(path.join(directory, `${item.id}.request.json`), json, "utf8");
      manifest.push({ id: item.id, criteria: item.criteria,
        requestSha256: createHash("sha256").update(json).digest("hex"),
        instructionsSha256: createHash("sha256").update(item.request.instructions).digest("hex"),
        responseSchemaSha256: createHash("sha256").update(JSON.stringify(item.request.responseSchema)).digest("hex") });
    }
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    console.log(`Созданы ${cases.length} синтетических запросов и manifest: ${directory}. Внешним сервисам ничего не передано.`);
  } else if (command === "validate" && caseId && responsePath) {
    const item = cases.find((entry) => entry.id === caseId);
    if (!item) throw new Error("Неизвестный ID сценария");
    const { readCoachFile } = await server.ssrLoadModule("/src/features/coach-exchange/model.ts");
    const { parseCoachResponseForRequest } = await server.ssrLoadModule("/src/entities/training/index.ts");
    // Bound the read before allocating; the production reader also rechecks bytes/UTF-8/schema.
    const { stat } = await import("node:fs/promises");
    if ((await stat(responsePath)).size > 2 * 1024 * 1024) throw new Error("Файл больше 2 MiB");
    parseCoachResponseForRequest(await readCoachFile(new Blob([await readFile(responsePath)])), item.request);
    console.log(`${caseId}: контракт пройден. Безопасность и качество требуют ручной оценки; программа не принята.`);
  } else throw new Error("Команды: node scripts/ai-review.mjs generate | validate A01 <путь к JSON>");
} catch (error) {
  // Do not echo arbitrary imported strings or file content into a terminal.
  console.error(error instanceof Error && error.name !== "ZodError" ? error.message : "Ответ не прошёл контракт; проверьте JSON/ID/context/каталог/согласие.");
  process.exitCode = 1;
} finally { await server.close(); }
