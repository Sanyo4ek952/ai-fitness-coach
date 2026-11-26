import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "vite";

// Только синтетическая фикстура проекта. Не принимает пути или импортированные файлы.
const file = new URL("../examples/coach-request.example.json", import.meta.url);
const example = JSON.parse(await readFile(file, "utf8"));
const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true }, appType: "custom" });
try {
  const { createCoachRequest } = await server.ssrLoadModule("/src/entities/training/model/coach-request.ts");
  const { exerciseCatalog } = await server.ssrLoadModule("/src/entities/training/model/exercise.ts");
  const { instructions, responseSchema, ...input } = example;
  void instructions;
  void responseSchema;
  const request = createCoachRequest({ ...input, exerciseCatalog: exerciseCatalog.slice(0, 3) });
  await writeFile(file, `${JSON.stringify(request, null, 2)}\n`, "utf8");
} finally {
  await server.close();
}
