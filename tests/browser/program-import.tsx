import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "../../app/globals.css";
import { createTrainingStorage } from "@/entities/training";
import { OwnProgramImport } from "@/features/coach-exchange/own-program-import";
import example from "../../examples/training-program.example.json";

const host = document.querySelector<HTMLDivElement>("#root")!;
const results = document.querySelector<HTMLPreElement>("#results")!;
const run = document.querySelector<HTMLButtonElement>("#run")!;
const root = createRoot(host);
const storage = createTrainingStorage();
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 8000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("UI timeout"); await new Promise((resolve) => setTimeout(resolve, 30)); }
}
function button(label: string) { const found = [...host.querySelectorAll("button")].find((item) => item.textContent === label); check(found, label); return found; }
function choose(file: File) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]'); check(input, "file input");
  const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
function pass(label: string) { results.textContent += `PASS ${label}\n`; }
run.addEventListener("click", () => {
  run.disabled = true; results.textContent = "";
  void (async () => {
    await storage.open();
    check(!await storage.profiles.current() && (await storage.programs.list()).length === 0 && !await storage.coach.latestRequest(), "Not an empty test origin");
    const profile = { id: crypto.randomUUID(), revision: 1, goal: "IMP-01 synthetic", experience: "unknown", sessionsPerWeek: null, equipment: ["dumbbells", "bench"], nutritionOptIn: false };
    await storage.profiles.save(profile);
    let applied = 0;
    root.render(<Theme><main style={{ maxWidth: 390, margin: "auto", padding: 12 }}><OwnProgramImport onApplied={() => { applied += 1; }} /></main></Theme>);
    await until(() => !!host.querySelector('input[type="file"]'));
    const data = { ...example, program: { ...example.program, workouts: Array.from({ length: 5 }, (_, i) => ({ ...example.program.workouts[0], title: `Мой день ${i + 1}` })) } };
    const file = new File([JSON.stringify(data)], "my-program.json", { type: "application/json" });
    choose(file); await until(() => !!host.querySelector(".coach-selected-file"));
    check((await storage.programs.list()).length === 0, "Selection writes");
    button("Посмотреть свою программу").click();
    await until(() => host.querySelectorAll(".coach-day").length === 5);
    check(document.activeElement?.getAttribute("aria-label") === "Предпросмотр своей программы", "Preview focus");
    check((await storage.programs.list()).length === 0 && !await storage.coach.latestRequest(), "Preview writes or requires request");
    check(button("Принять свою программу").disabled, "Confirmation missing");
    pass("Выбор/просмотр пяти дней без requestId и без записи программы");
    await storage.profiles.save({ ...profile, revision: 2 });
    host.querySelector<HTMLInputElement>('.profile-choice input')!.click();
    await until(() => !button("Принять свою программу").disabled);
    button("Принять свою программу").click();
    await until(() => !!host.querySelector('[role="alert"]')?.textContent);
    check((await storage.programs.list()).length === 0, "Stale preview applied");
    pass("Изменение профиля блокирует устаревшее подтверждение");
    button("Посмотреть свою программу").click();
    await until(() => !host.querySelector('[role="alert"]')?.textContent);
    await until(() => { const input = host.querySelector<HTMLInputElement>('.profile-choice input'); return !!input && !input.checked; });
    host.querySelector<HTMLInputElement>('.profile-choice input')!.click();
    await until(() => !button("Принять свою программу").disabled);
    button("Принять свою программу").click(); button("Принять свою программу").click();
    await until(() => !!host.textContent?.includes("Ваша программа принята"));
    check((await storage.programs.list()).length === 1 && applied === 1, "Duplicate apply");
    check((await storage.programs.active())?.workout.title === "Мой день 1", "Wrong next day");
    pass("Повторная проверка/согласие/двойной клик → одна версия и первый день");
    choose(new File(["not json"], "bad.json"));
    await until(() => !!host.querySelector(".coach-selected-file"));
    button("Посмотреть свою программу").click();
    await until(() => !!host.querySelector('[role="alert"]')?.textContent);
    check(host.querySelector(".coach-selected-file")?.textContent?.includes("bad.json"), "File lost");
    check((await storage.programs.list()).length === 1, "Bad file changed program");
    pass("Плохой JSON сохраняет файл и принятую программу");
    choose(file); await until(() => !!host.querySelector(".coach-selected-file")?.textContent?.includes(file.name));
    button("Посмотреть свою программу").click();
    await until(() => host.querySelectorAll(".coach-day").length === 5);
    check(host.textContent?.includes("Отличия от текущей программы"), "Diff missing");
    pass("Замена программы показывает вычисленные отличия");
    results.textContent += "DONE 5/5 — synthetic DB retained";
  })().catch((cause: unknown) => { results.textContent += `FAIL ${String(cause)}`; }).finally(() => storage.close());
});
