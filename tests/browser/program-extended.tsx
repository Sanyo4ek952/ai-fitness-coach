import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "../../app/globals.css";
import { createTrainingStorage, programFileSchema, programToDraft, validateBackup } from "@/entities/training";
import { OwnProgramImport } from "@/features/coach-exchange/own-program-import";
import { NextWorkout } from "@/features/next-workout";
import example from "../../examples/training-program.periodized.example.json";

const host = document.querySelector<HTMLDivElement>("#root")!;
const results = document.querySelector<HTMLPreElement>("#results")!;
const run = document.querySelector<HTMLButtonElement>("#run")!;
const root = createRoot(host);
const storage = createTrainingStorage();
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("UI timeout"); await new Promise((r) => setTimeout(r, 30)); }
}
function button(label: string) { const b = [...host.querySelectorAll("button")].find((b) => b.textContent === label); check(b, label); return b; }
function pass(label: string) { results.textContent += `PASS ${label}\n`; }
function mount() { root.render(<Theme><main style={{ maxWidth: 390, margin: "auto", padding: 12 }}><OwnProgramImport onApplied={() => {}} /><NextWorkout /></main></Theme>); }
const file = programFileSchema.parse({ ...example, program: { ...example.program, phases: example.program.phases.map((p) => ({ ...p, transition: "manual" })) } });

async function resume() {
  run.disabled = true; await storage.open();
  const saved = await storage.sessions.overview();
  check(saved.session?.sets.length === 1 && saved.active?.cursor.phaseIndex === 1, "Reload lost phase or set");
  check(programToDraft(saved.active.program).recommendations?.length === 7, "Reload lost details");
  mount(); await until(() => host.textContent?.includes("Есть незавершённое занятие") === true);
  pass("Перезагрузка: этап, семь рекомендаций, незавершённое занятие и факт сохранены");
  button("Продолжить тренировку").click(); await until(() => host.textContent?.includes("Сохранённый факт") === true);
  pass("Продолжение показывает сохранённый факт и оставшиеся подходы");
  results.textContent += "DONE 7/7 — synthetic DB retained"; storage.close();
}
if (new URL(location.href).searchParams.has("resume")) void resume().catch((e: unknown) => { results.textContent += `FAIL ${String(e)}`; storage.close(); });

run.addEventListener("click", () => {
  run.disabled = true; results.textContent = "";
  void (async () => {
    await storage.open(); check(!await storage.profiles.current() && !(await storage.programs.list()).length, "Not an empty synthetic origin");
    await storage.profiles.save({ id: crypto.randomUUID(), revision: 1, goal: "IMP-02 browser synthetic", experience: "advanced", sessionsPerWeek: 3,
      equipment: ["barbell", "rack", "bench", "dumbbells", "cable", "leg-press", "assisted-pull-up", "treadmill", "bodyweight", "machine"], nutritionOptIn: true });
    mount(); await until(() => !!host.querySelector('input[type="file"]'));
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const transfer = new DataTransfer(); transfer.items.add(new File([JSON.stringify(file)], "eight-weeks.json", { type: "application/json" })); input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => !!host.querySelector(".coach-selected-file"));
    check(!(await storage.programs.list()).length, "Selection writes");
    button("Посмотреть свою программу").click(); await until(() => host.querySelectorAll(".coach-day").length === 3);
    check(host.textContent?.includes("Новые упражнения (1)") && host.textContent.includes("Правила прогрессии"), "Preview details missing");
    check(!(await storage.programs.list()).length, "Preview writes"); pass("Три дня, восемь недель и новые упражнения: preview без записи");
    const boxes = host.querySelectorAll<HTMLInputElement>('.profile-choice input'); check(boxes.length === 2, "Separate consent missing");
    boxes[1].click(); await new Promise((r) => setTimeout(r, 50)); check(button("Принять свою программу").disabled, "New exercise consent bypassed");
    boxes[0].click(); await until(() => !button("Принять свою программу").disabled);
    button("Принять свою программу").click(); await until(() => host.textContent?.includes("Ваша программа принята") === true);
    check((await storage.programs.list()).length === 1, "Acceptance lost"); pass("Два отдельных согласия, одна версия, полный план в IndexedDB");
    await until(() => [...host.querySelectorAll("button")].some((b) => b.textContent === "Перейти к следующему этапу"));
    button("Перейти к следующему этапу").click(); await until(() => !![...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Подтверждаю нагрузку")));
    button("Подтверждаю нагрузку следующего этапа и переход").click(); await until(() => host.textContent?.includes("Этап изменён") === true);
    check((await storage.programs.active())?.cursor.phaseIndex === 1, "Phase not changed");
    check((await storage.programs.active())?.workout.exercises[1].target.type === "reps", "Target");
    pass("Переход этапа кнопкой подтверждения, параметры из overrides");
    await until(() => !button("Начать тренировку").disabled); button("Начать тренировку").click();
    await until(() => !!host.querySelector('input[aria-label="Вес, кг, подход 1"]'));
    const firstWeight = host.querySelector<HTMLInputElement>('input[aria-label="Вес, кг, подход 1"]');
    check(firstWeight?.value === "20", "Warmup weight not prefilled");
    await until(() => !button("Сохранить подход").disabled); button("Сохранить подход").click(); await until(() => host.textContent?.includes("Сохранённый факт") === true);
    await until(() => !!host.querySelector('input[aria-label="Вес, кг, подход 2"]'));
    const secondWeight = host.querySelector<HTMLInputElement>('input[aria-label="Вес, кг, подход 2"]'); check(secondWeight?.value === "", "Unknown working weight invented");
    check((await storage.sessions.overview()).session?.sets.length === 1, "Set not saved"); pass("Разминочный вес 20 кг, рабочий null, одно сохранение факта");
    const backup = await storage.backup.export(false); check(validateBackup(backup), "Backup invalid");
    check(backup.data.sessions[0].payload.phaseIndex === 1, "Backup phase missing"); pass("Backup сохраняет фазовый снимок активного занятия и все параметры");
    results.textContent += "RELOAD READY — 5/5; нажмите «Проверить перезагрузку»";
    const reload = document.createElement("button"); reload.textContent = "Проверить перезагрузку"; reload.onclick = () => { location.assign(new URL("?resume=1", location.href).href); }; results.after(reload);
  })().catch((e: unknown) => { results.textContent += `FAIL ${String(e)}`; }).finally(() => storage.close());
});
