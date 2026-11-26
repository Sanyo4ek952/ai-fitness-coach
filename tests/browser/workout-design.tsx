import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "../../app/globals.css";
import "@/features/next-workout/workout.css";
import { createTrainingStorage, findExercise, type Exercise } from "@/entities/training";
import { AppShellFrame } from "@/widgets/app-shell";
import { NextWorkout } from "@/features/next-workout";

const host = document.querySelector<HTMLDivElement>("#root")!;
const results = document.querySelector<HTMLPreElement>("#results")!;
const root = createRoot(host);
const storageName = "ux05-approved-design-synthetic-v3";
const storage = createTrainingStorage(storageName);
const goal = "UX-05 — только синтетическая проверка";
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
// Presentation shell uses the production classes; no onboarding or default DB reads.
let mountId = 0;
function mount() { root.render(<Theme appearance="dark" accentColor="blue" grayColor="slate" radius="large"><AppShellFrame activePath="/workout"><NextWorkout key={++mountId} storageName={storageName} /></AppShellFrame></Theme>); }
function pass(text: string) { results.textContent += `PASS ${text}\n`; }
async function finishRest() { if (host.querySelector(".rest-running")) { const label = host.querySelector(".rest-expired") ? "К упражнению" : "Закончить отдых"; await until(() => !button(label).disabled); button(label).click(); await until(() => !host.querySelector(".rest-running")); } }
function button(text: string) { const b = [...host.querySelectorAll("button")].find((b) => b.textContent === text && b.checkVisibility()); check(b, `Нет кнопки ${text}`); return b; }
async function until(predicate: () => boolean) { const deadline = Date.now() + 10000; while (!predicate()) { if (Date.now() > deadline) throw new Error("UI timeout"); await new Promise((r) => setTimeout(r, 35)); } }
function input(label: string) { const value = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`); check(value, `Нет поля ${label}`); return value; }
function fill(field: HTMLInputElement, value: string) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }
async function owned() { await storage.open(); check((await storage.profiles.current())?.goal === goal, "Чужие данные: отказ"); }
const definitions: readonly Exercise[] = [
  { id: "ux05-leg-press", name: "Жим ногами", measurement: "reps", equipment: ["leg-press"], load: { type: "external", unit: "kg", basis: "machine-stack" }, muscleGroups: ["legs", "glutes"] },
  findExercise("lat-pulldown")!,
  findExercise("db-overhead-press")!,
  { id: "ux05-row", name: "Горизонтальная тяга", measurement: "reps", equipment: ["cable"], load: { type: "external", unit: "kg", basis: "machine-stack" }, muscleGroups: ["back"] },
];
document.querySelector("#seed")!.addEventListener("click", () => { void (async () => {
  check(location.port === "4195", "Неверный origin"); await storage.open(); check(!await storage.profiles.current() && !(await storage.programs.list()).length && !(await storage.sessions.list()).length, "Origin не пуст: ничего не заменено");
  await storage.profiles.save({ id: crypto.randomUUID(), revision: 1, goal, experience: "unknown", sessionsPerWeek: null, equipment: ["leg-press", "cable", "dumbbells", "bench"], nutritionOptIn: false });
  const exercises = definitions.map((definition, i) => ({ exerciseId: definition.id, definition, sets: 3, target: { type: "reps", min: i === 2 ? 10 : i === 3 ? 12 : 10, max: i === 2 ? 10 : 12, weightKg: [80, 35, 12, 30][i] }, restSec: 120, rir: 2 }));
  const preview = await storage.programs.previewImport({ schemaVersion: 1, kind: "training_program", program: { title: "Базовая программа · Этап 1", goalInterpretation: "Синтетический пример", reviewAfterSessions: 20, workouts: [{ title: "А · Всё тело", exercises }, { title: "Б · Всё тело", exercises }] } });
  await storage.programs.applyImport({ file: preview.file, expectedToken: preview.token, createdAt: new Date().toISOString(), reviewAcknowledged: true, newExercisesAcknowledged: true });
  mount(); results.textContent = "Пример готов. Никаких личных данных.\n";
})().catch((e: unknown) => { results.textContent = String(e); }).finally(() => storage.close()); });
document.querySelector("#show")!.addEventListener("click", () => { void owned().then(mount).catch((e: unknown) => { results.textContent = String(e); }).finally(() => storage.close()); });
document.querySelector("#zoom")!.addEventListener("click", () => { document.documentElement.style.fontSize = document.documentElement.style.fontSize === "200%" ? "100%" : "200%"; });
document.querySelector("#narrow")!.addEventListener("click", () => { const shell = host.querySelector<HTMLElement>(".app-shell"); if (shell) shell.style.width = shell.style.width === "360px" ? "390px" : "360px"; });
document.querySelector("#hide")!.addEventListener("click", () => { document.querySelector<HTMLElement>("#tools")!.style.display = "none"; });
document.querySelector("#run")!.addEventListener("click", () => { void (async () => {
  await owned(); results.textContent = ""; mount();
  await until(() => !![...host.querySelectorAll("button")].find((b) => b.textContent === "Начать тренировку"));
  check(!(await storage.sessions.overview()).session, "Начните на готовом предпросмотре"); button("Начать тренировку").click();
  await until(() => !!host.querySelector('input[aria-label="Вес, кг, подход 1"]'));
  check(input("Вес, кг, подход 1").value === "80", "Вес плана");
  fill(input("Вес, кг, подход 1"), "82,5"); fill(input("Повторы, подход 1"), "11");
  button("Все упражнения · 1 из 4").click(); await until(() => !!host.querySelector(".workout-exercise-select"));
  await until(() => host.querySelectorAll<HTMLButtonElement>(".workout-exercise-select")[1]?.disabled === false);
  host.querySelectorAll<HTMLButtonElement>(".workout-exercise-select")[1].click(); await until(() => host.querySelector(".exercise-editor h2")?.textContent === "Тяга верхнего блока");
  button("Все упражнения · 2 из 4").click(); host.querySelectorAll<HTMLButtonElement>(".workout-exercise-select")[0].click(); await until(() => host.querySelector(".exercise-editor h2")?.textContent === "Жим ногами");
  check(input("Вес, кг, подход 1").value === "82,5", "Черновик потерян"); pass("Черновик сохраняется при переключении упражнений");
  const before = await storage.sessions.overview();
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value, key) { if (this.name === "counters") throw new DOMException("Synthetic quota", "QuotaExceededError"); return key === undefined ? original.call(this, value) : original.call(this, value, key); };
  try { await until(() => !button("Сохранить подход").disabled); button("Сохранить подход").click(); await until(() => host.textContent?.includes("Подход не сохранён") === true); } finally { IDBObjectStore.prototype.put = original; }
  const failed = await storage.sessions.overview(); check(JSON.stringify(before.session) === JSON.stringify(failed.session) && before.historyRevision === failed.historyRevision, "Частичный commit");
  check(input("Вес, кг, подход 1").value === "82,5" && !failed.session?.restTimer, "Потерян ввод / ложный таймер"); pass("Отказ counters откатывает подход/отдых, форма сохранена");
  await until(() => !button("Повторить сохранение").disabled); button("Повторить сохранение").click(); await until(() => !!host.querySelector('input[aria-label="Вес, кг, подход 2"]'));
  const saved = (await storage.sessions.overview()).session; check(saved?.sets.length === 1 && saved.restTimer, "Автоотдых не записан"); pass("Повтор: один подход и автоотдых атомарно");
  const timer = saved.restTimer; const oldDeadline = Date.parse(timer.deadline);
  await until(() => !button("+15 с").disabled); button("+15 с").click(); await until(() => button("+15 с").disabled); await until(() => !button("+15 с").disabled);
  const adjusted = (await storage.sessions.overview()).session?.restTimer; check(adjusted && Math.abs(Date.parse(adjusted.deadline) - oldDeadline - 15000) < 1100, "+15 секунд"); pass("Изменение отдыха не меняет историю подходов");
  mount(); await until(() => !!host.querySelector(".workout-resume"));
  check(host.querySelector(".workout-resume")?.textContent?.includes("Сохранено 1 из 12"), "Возврат потерял результат");
  check(host.querySelector(".workout-resume .workout-status-pill"), "Нет сохранённого отдыха");
  button("Продолжить тренировку").click(); await until(() => !!host.querySelector(".rest-running"));
  check(input("Вес, кг, подход 2").value === "80", "Возврат не выбрал следующий подход"); pass("Повторное открытие: карточка возврата, сохранённый отдых и следующий подход");
  button("Крупный таймер ↗").click(); await until(() => !!document.querySelector('dialog[open][aria-label="Крупный таймер отдыха"]')); pass("Крупный таймер открыт как модальный диалог");
  document.querySelector<HTMLButtonElement>("dialog .workout-back")!.click(); await until(() => !document.querySelector("dialog[open]"));
  const active = (await storage.sessions.overview()).session; check(active, "Нет сессии");
  await storage.sessions.timer({ sessionId: active.id, expectedTimer: active.restTimer, timer: { id: crypto.randomUUID(), startedAt: new Date().toISOString(), deadline: new Date(Date.now() + 100).toISOString() } });
  await until(() => host.textContent?.includes("Отдых завершён") === true); check((await storage.sessions.overview()).session?.sets.length === 1, "Истечение создало факт"); pass("Ноль таймера не создаёт подход");
  for (const index of [2, 3]) {
    await finishRest();
    await until(() => !!host.querySelector(`input[aria-label="Вес, кг, подход ${index}"]`));
    await until(() => !button("Сохранить подход").disabled); button("Сохранить подход").click();
    await until(() => host.querySelector(".set-plan p")?.textContent !== `ПЛАН ПОДХОДА ${index}` || host.querySelector(".exercise-editor h2")?.textContent !== "Жим ногами");
  }
  await until(() => host.querySelector(".exercise-editor h2")?.textContent === "Тяга верхнего блока");
  check(input("Вес, кг, подход 1").value === "35", "Следующее упражнение не предзаполнено");
  check((await storage.sessions.overview()).session?.sets.length === 3, "Потеря фактов при переходе");
  pass("Последний подход автоматически открывает упражнение 2, факты и автоотдых сохранены");
  await finishRest();
  button("Заменить или пропустить ›").click(); await until(() => !!document.querySelector("dialog[open].workout-dialog-sheet"));
  check(document.querySelector("dialog")?.textContent?.includes("План программы останется прежним"), "Нет границы действия");
  await until(() => !button("Вернуться к подходу").disabled); button("Вернуться к подходу").click(); await until(() => !document.querySelector("dialog[open]"));
  check((await storage.sessions.overview()).session?.sets.length === 3 && input("Вес, кг, подход 1").value === "35", "Отмена меню изменила данные"); pass("Действия упражнения: открытие/возврат сохраняют факты и ввод");
  await until(() => !button("Завершить").disabled); button("Завершить").click(); await until(() => !!document.querySelector('dialog[open][aria-label="Подтверждение завершения"]'));
  const finish = [...document.querySelectorAll<HTMLButtonElement>("dialog button")].find((b) => b.textContent === "Завершить тренировку"); check(finish, "Нет подтверждения"); await until(() => !finish.disabled);
  IDBObjectStore.prototype.put = function(value, key) { if (this.name === "counters") throw new DOMException("Synthetic quota", "QuotaExceededError"); return key === undefined ? original.call(this, value) : original.call(this, value, key); };
  try { finish.click(); await until(() => document.querySelector("dialog")?.textContent?.includes("Не удалось завершить тренировку") === true); } finally { IDBObjectStore.prototype.put = original; }
  check((await storage.sessions.overview()).session?.status === "active" && !host.querySelector(".workout-result"), "Ложный итог после отказа"); pass("Ошибка завершения: диалог открыт, занятие активно, ложного итога нет");
  await until(() => !finish.disabled); finish.click();
  await until(() => !!host.querySelector(".workout-result")); const history = await storage.sessions.list(); check(history.find((s) => s.id === active.id)?.status === "partial", "Неполный статус"); pass("Подтверждение → commit → итог неполной тренировки");
  button("К следующей тренировке").click(); await until(() => !!host.querySelector(".workout-summary")); check(!(await storage.sessions.overview()).session, "Ложный автозапуск"); pass("Следующее занятие открывается без автозапуска");
  results.textContent += "DONE 12/12";
})().catch((e: unknown) => { results.textContent += `FAIL ${String(e)}`; }).finally(() => storage.close()); });

