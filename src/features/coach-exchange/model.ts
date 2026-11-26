import { ZodError } from "zod";
import { coachResponseSchema, programFileSchema, createProgramFileJsonSchema, exerciseCatalog, PROGRAM_INSTRUCTIONS, programToDraft, type ProgramVersion, type Exercise, type CoachRequest } from "@/entities/training";

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

// Decode strictly: replacement characters must never conceal a damaged file.
async function readJsonFile(file: Pick<Blob, "size" | "arrayBuffer">): Promise<unknown> {
  if (file.size > MAX_RESPONSE_BYTES) throw new Error("Файл больше 2 MiB. Выберите JSON-ответ меньшего размера.");
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_RESPONSE_BYTES) throw new Error("Файл больше 2 MiB.");
  let input: unknown;
  try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); }
  catch { throw new Error("Не удалось прочитать UTF-8 JSON. Нужен файл без Markdown и текста вне JSON."); }
  const queue: { value: unknown; depth: number }[] = [{ value: input, depth: 0 }];
  let count = 0;
  while (queue.length) {
    const item = queue.pop()!;
    if (++count > 100000 || item.depth > 64) throw new Error("Не удалось прочитать UTF-8 JSON: слишком сложная структура файла.");
    if (item.value !== null && typeof item.value === "object") for (const [key, value] of Object.entries(item.value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error(`Не удалось прочитать UTF-8 JSON: недопустимое поле ${key}.`);
      queue.push({ value, depth: item.depth + 1 });
    }
  }
  return input;
}

export async function readCoachFile(file: Pick<Blob, "size" | "arrayBuffer">) { return coachResponseSchema.parse(await readJsonFile(file)); }
export async function readProgramFile(file: Pick<Blob, "size" | "arrayBuffer">) {
  const input = await readJsonFile(file);
  const standalone = programFileSchema.safeParse(input);
  if (standalone.success) return standalone.data;
  // Only the explicit own-plan route may extract a plan from an old AI answer.
  // Its request/context/nutrition are never adopted as current analysis.
  const response = coachResponseSchema.safeParse(input);
  if (response.success && response.data.decision === "propose_program") {
    return programFileSchema.parse({ schemaVersion: 1, kind: "training_program", program: response.data.proposedProgram });
  }
  return programFileSchema.parse(input);
}

export function programImportInstructions(catalog: readonly Exercise[] = exerciseCatalog) {
  return JSON.stringify({
    instructions: "Оформи мою уже составленную программу в один UTF-8 JSON-файл по responseSchema. Не пересчитывай и не меняй упражнения, порядок дней, подходы, повторы, веса и отдых. Не добавляй упражнения и не заменяй их без моего разрешения. Верни только готовый файл kind=training_program, без Markdown, requestId и context. Используй ID из exerciseCatalog; если упражнения нет, добавь полное definition с новым стабильным ID. Не подменяй упражнение похожим. Неоднозначные сведения уточни. Неизвестный вес — null, известный нулевой вес — 0; для гантелей укажи вес одной гантели, для гравитрона — помощь. Для времени/дистанции используй соответствующий target. Все пояснения на русском. Мой исходный план я приложу отдельно.",
    programInstructions: PROGRAM_INSTRUCTIONS,
    responseSchema: createProgramFileJsonSchema(), exerciseCatalog: catalog,
  }, null, 2);
}

export function downloadProgramInstructions(catalog?: readonly Exercise[]) { downloadJson(programImportInstructions(catalog), "format-my-training-program.json"); }

export function exportProgram(program: ProgramVersion) {
  return programFileSchema.parse({ schemaVersion: 1, kind: "training_program", program: programToDraft(program) });
}

export function downloadProgram(program: ProgramVersion) { downloadJson(JSON.stringify(exportProgram(program), null, 2), "my-training-program.json"); }

export function importValidationMessage(error: ZodError): string {
  return error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "файл"}: ${issue.message}`).join("; ");
}

export function serializeRequest(request: CoachRequest): string { return JSON.stringify(request, null, 2); }

export function downloadRequest(request: CoachRequest): void {
  downloadJson(serializeRequest(request), `coach-request-${request.requestId}.json`);
}

function downloadJson(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  try {
    anchor.href = url; anchor.download = filename;
    document.body.append(anchor); anchor.click();
  } finally {
    anchor.remove();
    // Give the browser time to consume the object URL. This cannot confirm
    // whether the user ultimately saved the file in their download manager.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

export async function copyRequest(request: CoachRequest, write: (value: string) => Promise<void>): Promise<void> {
  await write(serializeRequest(request));
}
