/* eslint-disable @next/next/no-img-element -- Test-only raster references must not be optimized or resampled by next/image. */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "../../app/globals.css";
import { AppShellFrame } from "@/widgets/app-shell";
import { ProgramOverview, SessionPanel, WorkoutResult, WorkoutEmpty } from "@/features/next-workout/next-workout";
import { RestTimer } from "@/features/next-workout/session-controls";
import { Button } from "@/shared/ui";
import { createInitialProgramCursor, programVersionSchema, workoutSessionSchema, recordWorkoutSet, applySessionAction, updateRestTimer, findExercise, type Exercise } from "@/entities/training";
import "./workout-compare.css";

// A visual fixture only: the real frame/features render validated synthetic
// snapshots. There is no default DB connection, export or user-data mutation.
const definitions: readonly Exercise[] = [
  { id: "ux06-leg-press", name: "Жим ногами", equipment: ["leg-press"], measurement: "reps", load: { type: "external", unit: "kg", basis: "machine-stack" }, muscleGroups: ["legs", "glutes"] },
  findExercise("lat-pulldown")!, findExercise("db-overhead-press")!,
  { id: "ux06-row", name: "Горизонтальная тяга", equipment: ["cable"], measurement: "reps", load: { type: "external", unit: "kg", basis: "machine-stack" }, muscleGroups: ["back"] },
];
const program = programVersionSchema.parse({ id: crypto.randomUUID(), revision: 1, previousId: null, profileRevision: 1, createdAt: "2026-11-26T10:00:00Z", title: "Базовая программа · Этап 1", goalInterpretation: "Визуальная проверка", reviewAfterSessions: 20,
  workouts: ["А · Всё тело", "Б · Всё тело"].map((title) => ({ id: crypto.randomUUID(), title, exercises: definitions.map((definition, i) => ({ id: crypto.randomUUID(), exerciseId: definition.id, definition, sets: 3, target: { type: "reps", min: i === 3 ? 12 : 10, max: i === 2 ? 10 : 12, weightKg: [80, 35, 12, 30][i] }, restSec: 120, rir: 2 })) })) });
const workout = program.workouts[0];
const active = { program, workout, cursor: createInitialProgramCursor(program) };
const modes = [["overview", "01 · До старта"], ["active", "02 · Подход"], ["rest", "03 · Отдых"], ["full", "03 · Крупный таймер"], ["actions", "04 · Действия"], ["finish", "04 · Подтверждение"], ["result", "04 · Итог"], ["empty", "05 · Нет программы"], ["resume", "05 · Возврат"], ["error", "05 · Ошибка записи"], ["expired", "05 · Отдых окончен"]] as const;
type Mode = typeof modes[number][0];
function isMode(value: string | null): value is Mode { return modes.some(([key]) => key === value); }
function fixture(rest: boolean) {
  const id = crypto.randomUUID(); const row = workout.exercises[0]; const now = Date.now();
  return workoutSessionSchema.parse({ id, programVersionId: program.id, templateId: workout.id, plannedSnapshot: workout, startedAt: new Date(now - 600000).toISOString(), endedAt: null, status: "active",
    sets: Array.from({ length: rest ? 2 : 1 }, (_, i) => ({ id: crypto.randomUUID(), sessionId: id, plannedExerciseId: row.id, originalExerciseId: row.exerciseId, actualExerciseId: row.exerciseId, definition: row.definition, index: i + 1, timestamp: new Date(now - 120000 + i * 30000).toISOString(), status: "done", actual: { type: "reps", weightKg: 80, reps: i === 0 ? 12 : 11 } })),
    ...(rest ? { restTimer: { id: crypto.randomUUID(), startedAt: new Date(now - 36000).toISOString(), deadline: new Date(now + 84000).toISOString() } } : {}) });
}

function fixtureFor(mode: Mode) {
  const base = fixture(["rest", "full", "resume", "expired"].includes(mode));
  if (mode === "expired") return workoutSessionSchema.parse({ ...base, restTimer: { ...base.restTimer, startedAt: new Date(Date.now() - 121000).toISOString(), deadline: new Date(Date.now() - 1000).toISOString() } });
  if (mode !== "finish" && mode !== "result") return base;
  const sets = workout.exercises.flatMap((row, i) => Array.from({ length: i < 2 ? 3 : i === 2 ? 2 : 0 }, (_, n) => ({ id: crypto.randomUUID(), sessionId: base.id, plannedExerciseId: row.id, originalExerciseId: row.exerciseId, actualExerciseId: row.exerciseId, definition: row.definition, index: n + 1, timestamp: new Date().toISOString(), status: "done", actual: { type: "reps", weightKg: row.target.type === "reps" ? row.target.weightKg : null, reps: 10 } })));
  return workoutSessionSchema.parse({ ...base, sets, ...(mode === "result" ? { status: "partial", endedAt: new Date().toISOString() } : {}) });
}

function Preview({ initialMode }: Readonly<{ initialMode: Mode }>) {
  const [mode, setMode] = useState(initialMode);
  const [session, setSession] = useState(() => fixtureFor(initialMode));
  const [revision, setRevision] = useState(1);
  const [opened, setOpened] = useState(initialMode !== "resume");
  const [failSave, setFailSave] = useState(initialMode === "error");
  useEffect(() => {
    const selector = initialMode === "actions" ? ".exercise-actions-trigger" : initialMode === "finish" ? ".finish-trigger" : initialMode === "full" ? ".rest-expand" : initialMode === "error" ? ".save-set" : undefined;
    if (selector) document.querySelector<HTMLButtonElement>(selector)?.click();
  }, [initialMode]);
  const onSave = async (command: unknown) => { if (failSave) { setFailSave(false); return false; } try { setSession(recordWorkoutSet(session, command)); setRevision(revision + 1); return true; } catch { return false; } };
  const onAction = async (command: unknown) => { try { setSession(applySessionAction(session, command)); setRevision(revision + 1); return true; } catch { return false; } };
  const onTimer = async (command: unknown) => { try { setSession(updateRestTimer(session, command)); return true; } catch { return false; } };
  const content = mode === "empty" ? <WorkoutEmpty /> : mode === "expired" ? <RestTimer session={session} busy={false} onTimer={onTimer} next="подход 3 из 3" nextName="Жим ногами" /> : mode === "result" ? <WorkoutResult session={session} active={{ ...active, workout: program.workouts[1] }} onNext={() => setMode("overview")} /> : mode === "overview" ? <><h1>Тренировка</h1><ProgramOverview active={active} /><div className="workout-start-dock"><Button className="primary workout-start" onClick={() => { setSession(fixture(false)); setOpened(true); setMode("active"); }}>Начать тренировку</Button></div></> : <SessionPanel session={session} program={program} revision={revision} opened={opened} busy={false} onContinue={() => setOpened(true)} onSave={onSave} onAction={onAction} onTimer={onTimer} onFinish={async () => { setSession(workoutSessionSchema.parse({ ...session, endedAt: new Date().toISOString(), status: "partial" })); setMode("result"); return true; }} />;
  const cardOnly = ["empty", "resume", "error", "expired"].includes(initialMode);
  return <Theme appearance="dark" accentColor="blue" grayColor="slate" radius="large">{cardOnly ? <div className={`workout-shell preview-card preview-card-${initialMode}`}><div className="workout-page">{content}</div></div> : <AppShellFrame activePath="/workout"><div className="workout-page">{content}</div></AppShellFrame>}</Theme>;
}

function Comparison() {
  const [mode, setMode] = useState<Mode>("overview");
  const [largeText, setLargeText] = useState(false);
  const board = ["overview"].includes(mode) ? "01-before-workout" : mode === "active" ? "02-record-set" : ["rest", "full"].includes(mode) ? "03-rest-timer" : ["actions", "finish", "result"].includes(mode) ? "04-actions-finish" : "05-return-errors";
  return <div className={`comparison-page comparison-${mode}${largeText ? " comparison-large-text" : ""}`}>
    <header className="comparison-toolbar"><h1>Референс / рабочие компоненты</h1><p>Все блоки пяти утверждённых листов. Ширина390px, только вымышленные данные. Системные строки и внешние подписи исключены. Справа можно нажимать кнопки; данные этой страницы хранятся только в памяти.</p><div>{modes.map(([key, label]) => <button key={key} aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>)}</div><button aria-pressed={largeText} onClick={() => setLargeText(!largeText)}>Проверка 360px / текст 200%</button></header>
    <div className="comparison-columns"><section><h2>Утверждённый референс</h2><div className={`reference-crop reference-${mode}`}><img alt={`Утверждённый макет: ${mode}`} src={`/docs/design/workout-ux05/${board}.png`} /></div></section>
      <section><h2>Текущий интерфейс</h2><iframe key={`${mode}:${largeText}`} title="Работающий интерфейс тренировки" className="comparison-live" style={largeText ? { width: 360, height: 800 } : undefined} src={`?preview=${mode}${largeText ? "&text=200" : ""}`} /></section></div>
  </div>;
}
const requested = new URLSearchParams(location.search).get("preview");
if (isMode(requested) && new URLSearchParams(location.search).get("text") === "200") document.documentElement.style.fontSize = "200%";
createRoot(document.querySelector("#comparison-root")!).render(isMode(requested) ? <Preview initialMode={requested} /> : <Comparison />);
