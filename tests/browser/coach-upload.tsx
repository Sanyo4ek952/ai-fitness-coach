import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "../../app/globals.css";
import { createTrainingStorage, profileSchema } from "@/entities/training";
import { CoachExchange } from "@/features/coach-exchange";
import { CoachPreview } from "@/features/coach-exchange/coach-preview";
import example from "../../examples/coach-response.example.json";

// Dedicated origin only. Refuse existing data rather than clearing the user's DB.
const host = document.querySelector<HTMLDivElement>("#root")!;
const results = document.querySelector<HTMLPreElement>("#results")!;
const run = document.querySelector<HTMLButtonElement>("#run")!;
const root = createRoot(host);
const storage = createTrainingStorage();
document.querySelector("#zoom")?.addEventListener("click", () => {
  document.documentElement.style.fontSize = document.documentElement.style.fontSize === "200%" ? "100%" : "200%";
});
document.querySelector("#preview")?.addEventListener("click", () => {
  void (async () => {
    await storage.open();
    check((await storage.profiles.current())?.goal === "Синтетическая проверка UX-04", "Not our synthetic profile");
    const request = await storage.coach.latestRequest(); check(request, "No synthetic request");
    const acceptance = await storage.coach.acceptance(request.requestId); check(acceptance, "Run the test first");
    root.render(<Theme><main style={{ maxWidth: 390, margin: "auto", padding: 12 }}><CoachPreview response={acceptance.response} /></main></Theme>);
  })().catch((cause: unknown) => { results.textContent = String(cause); }).finally(() => storage.close());
});
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("UI timeout");
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
function button(label: string) {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  check(found, `Missing button: ${label}`); return found;
}
function choose(file: File) {
  const input = host.querySelector<HTMLInputElement>('[aria-label="Загрузка ответа ИИ"] input[type="file"]'); check(input, "Missing input");
  const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
function pass(label: string) { results.textContent += `PASS ${label}\n`; }
run.addEventListener("click", () => {
  run.disabled = true; results.textContent = "";
  void (async () => {
    await storage.open();
    check(!await storage.profiles.current() && (await storage.programs.list()).length === 0 && !await storage.coach.latestRequest(), "Origin is not empty; refusing to seed");
    const profile = profileSchema.parse({ id: crypto.randomUUID(), revision: 1, goal: "Синтетическая проверка UX-04", experience: "unknown", sessionsPerWeek: null, equipment: ["dumbbells", "bench"], nutritionOptIn: false });
    await storage.profiles.save(profile);
    const request = await storage.coach.createInitialRequest(crypto.randomUUID(), new Date().toISOString());
    const response = { ...example, requestId: request.requestId, context: request.context,
      proposedProgram: { ...example.proposedProgram, workouts: Array.from({ length: 5 }, (_, i) => ({ ...example.proposedProgram.workouts[0], title: `Тренировка ${i + 1}` })) } };
    const file = new File([JSON.stringify(response)], "five-days.json", { type: "application/json" });
    root.render(<Theme><main style={{ maxWidth: 390, margin: "auto", padding: 12 }}><CoachExchange /></main></Theme>);
    await until(() => { const input = host.querySelector<HTMLInputElement>('[aria-label="Загрузка ответа ИИ"] input[type="file"]'); return !!input && !input.disabled; });
    choose(file);
    await until(() => !!host.querySelector(".coach-selected-file"));
    check(!await storage.coach.preview(request.requestId), "Selection must not import");
    check((await storage.programs.list()).length === 0, "Selection changed program");
    pass("Выбор файла показывает имя, без импорта и применения");
    button("Отправить").click(); button("Отправить").click();
    await until(() => !!host.querySelector(".coach-days"));
    check((await storage.programs.list()).length === 0, "Import applied program");
    check(document.activeElement?.getAttribute("aria-label") === "Проверенный ответ ИИ", "Preview focus");
    check(host.querySelectorAll(".coach-day").length === 5, "Missing days");
    check(button("Применить весь пакет").disabled, "Acceptance needs consent");
    pass("Отправка и двойной клик → предпросмотр пяти дней, фокус, без применения");
    const days = host.querySelectorAll<HTMLButtonElement>(".coach-day .accordion-trigger");
    check(days[0].getAttribute("aria-expanded") === "true" && days[4].getAttribute("aria-expanded") === "false", "Initial accordion state");
    days[4].click();
    await until(() => days[4].getAttribute("aria-expanded") === "true");
    pass("Пятый день раскрывается независимо от первого");
    await until(() => !button("Закрыть предпросмотр").disabled);
    choose(new File(["bad-json"], "broken.json"));
    await until(() => !host.querySelector(".coach-days"));
    button("Отправить").click();
    await until(() => !!host.querySelector('[role="alert"]')?.textContent);
    await until(() => !button("Отправить").disabled);
    check(host.querySelector(".coach-selected-file")?.textContent?.includes("broken.json"), "Error lost file");
    check((await storage.programs.list()).length === 0, "Error applied program");
    pass("Новый выбор скрывает старое предложение; ошибка сохраняет файл для повтора");
    choose(file); await until(() => !!host.querySelector(".coach-selected-file")?.textContent?.includes(file.name));
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === "coachResponses") throw new DOMException("Synthetic quota", "QuotaExceededError");
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
    try {
      button("Отправить").click();
      await until(() => !!host.querySelector('[role="alert"]')?.textContent);
      await until(() => !button("Отправить").disabled);
      check(!host.querySelector(".coach-days"), "False success after write failure");
      check(host.querySelector(".coach-selected-file"), "Write failure lost file");
    } finally { IDBObjectStore.prototype.put = original; }
    pass("Отказ записи не даёт ложного успеха и сохраняет файл");
    button("Отправить").click();
    await until(() => !!host.querySelector(".coach-days"));
    await until(() => !button("Закрыть предпросмотр").disabled);
    const consent = host.querySelector<HTMLInputElement>('.profile-choice input'); check(consent, "Missing consent"); consent.click();
    await until(() => !button("Применить весь пакет").disabled);
    button("Применить весь пакет").click();
    await until(() => !!host.textContent?.includes("Весь пакет принят и сохранён"));
    check((await storage.programs.list()).length === 1, "Acceptance failed");
    pass("Повтор → отдельное согласие → одна принятая программа");
    // Leave a read-only preview for visual inspection of the real component.
    const { coachResponseSchema } = await import("@/entities/training");
    root.render(<Theme><main style={{ maxWidth: 390, margin: "auto", padding: 12 }}><CoachPreview response={coachResponseSchema.parse(response)} /></main></Theme>);
    results.textContent += "DONE 6/6 — synthetic DB retained on dedicated test origin";
  })().catch((cause: unknown) => { results.textContent += `FAIL ${String(cause)}`; }).finally(() => storage.close());
});
