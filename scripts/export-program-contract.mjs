import { createServer } from "vite";
import { readFile, writeFile } from "node:fs/promises";

// Generate artifacts from the runtime Zod schemas; never maintain a parallel contract.
const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: "custom" });
try {
  const { createProgramFileJsonSchema } = await server.ssrLoadModule("/src/entities/training/model/program-import.ts");
  const { createCoachResponseJsonSchema } = await server.ssrLoadModule("/src/entities/training/model/coach-response.ts");
  await writeFile("examples/training-program.schema.json", JSON.stringify(createProgramFileJsonSchema(), null, 2) + "\n");
  const request = JSON.parse(await readFile("examples/coach-request.example.json", "utf8"));
  request.responseSchema = createCoachResponseJsonSchema();
  await writeFile("examples/coach-request.example.json", JSON.stringify(request, null, 2) + "\n");
} finally { await server.close(); }
