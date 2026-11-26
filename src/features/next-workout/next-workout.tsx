"use client";

import "./workout.css";

import Link from "next/link";
import { liveQuery } from "dexie";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createTrainingStorage, ProgramDetails, phaseSessionTarget, ruleActionText, setPlanLabel, findExercise, restSecondsRemaining, StorageConflictError, type ProgramVersion, type TrainingStorage, type WorkoutSession, type WorkoutTemplate } from "@/entities/training";
import { Accordion, Button, Layers, WorkoutDumbbell } from "@/shared/ui";
import { SessionSets } from "./set-form";
import { type SessionAction } from "./session-controls";
import { targetText, clockText, countText, WorkoutDialog, WorkoutStateBrand, WorkoutStateIcon } from "./workout-ui";

type ActiveProgram = Awaited<ReturnType<TrainingStorage["programs"]["active"]>>;
type Overview = Awaited<ReturnType<TrainingStorage["sessions"]["overview"]>>;
type State = { status: "loading" } | { status: "error" } | { status: "ready"; overview: Overview };

export function NextWorkout({ children, storageName }: Readonly<{ children?: ReactNode; storageName?: string }> = {}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [openSessionId, setOpenSessionId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [finished, setFinished] = useState<WorkoutSession>();
  const [skipConfirmation, setSkipConfirmation] = useState<number>();
  const lock = useRef(false);
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  useEffect(() => {
    const storage = createTrainingStorage(storageName);
    let disposed = false;
    let subscription: { unsubscribe(): void } | undefined;
    void (async () => {
      try {
        await storage.open();
        if (disposed) { storage.close(); return; }
        subscription = liveQuery(() => storage.sessions.overview()).subscribe({
          next: (overview) => { if (!disposed) setState({ status: "ready", overview }); },
          error: () => { if (!disposed) setState({ status: "error" }); },
        });
      } catch { if (!disposed) setState({ status: "error" }); }
    })();
    return () => { disposed = true; subscription?.unsubscribe(); storage.close(); };
  }, [attempt, storageName]);

  async function act(action: (storage: TrainingStorage) => Promise<void>) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const storage = createTrainingStorage(storageName);
    try { await storage.open(); await action(storage); return true; }
    catch (cause) { setError(cause instanceof StorageConflictError ? cause.message : "Не удалось сохранить занятие. Проверьте локальное хранение и свободное место; повторите. Несохранённое действие не отмечено выполненным."); return false; }
    finally {
      storage.close();
      // The next screen can render before a native double-click ends. Keep its
      // controls disabled briefly so the second click cannot start the next session.
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      lock.current = false; setBusy(false);
    }
  }

  return <div className="workout-page">
    {!finished && !(state.status === "ready" && state.overview.session && state.overview.session.id === openSessionId) && <h1>Тренировка</h1>}
    {children}
    <p ref={alert} tabIndex={-1} role="alert">{error}</p><p className="sr-only" role="status">{notice}</p>
    {state.status === "loading" && <p role="status">Загружаем последовательность…</p>}
    {state.status === "error" && <section className="panel stack"><p role="alert">Не удалось прочитать программу. Проверьте локальное хранение и повторите. Сохранённые данные не изменены.</p><Button className="secondary" onClick={() => { setState({ status: "loading" }); setAttempt((value) => value + 1); }}>Повторить чтение</Button></section>}
    {state.status === "ready" && (finished ? <WorkoutResult session={finished} active={state.overview.active} onNext={() => setFinished(undefined)} /> : state.overview.session ? <SessionPanel key={state.overview.session.id} program={state.overview.active?.program} session={state.overview.session} revision={state.overview.historyRevision}
      onSave={(command) => act(async (storage) => { await storage.sessions.recordSet(command); setNotice("Подход сохранён на этом устройстве."); })}
      onAction={(command) => act(async (storage) => { await storage.sessions.action(command); setNotice("Действие сохранено. Программа не изменена."); })}
      onTimer={(command) => act(async (storage) => { await storage.sessions.timer(command); })}
      opened={openSessionId === state.overview.session.id} busy={busy} onContinue={() => setOpenSessionId(state.overview.session?.id)}
      onFinish={async () => { const { session, historyRevision } = state.overview; if (!session) return false;
        return act(async (storage) => { const result = await storage.sessions.finish({ sessionId: session.id, endedAt: new Date().toISOString(), expectedHistoryRevision: historyRevision });
          setFinished(result); setOpenSessionId(undefined); setNotice(result.status === "abandoned" ? "Занятие закрыто без результатов. Следующим осталось то же занятие." : "Занятие завершено. Следующее — по порядку программы."); });
      }} /> : state.overview.active ? <><ProgramOverview active={state.overview.active} programActions={<>
        <PhaseTransition active={state.overview.active} busy={busy} onConfirm={() => { const { active, historyRevision } = state.overview; if (!active) return; void act(async (storage) => { await storage.programs.advancePhase({ expectedCursor: active.cursor, expectedHistoryRevision: historyRevision, confirmed: true }); setNotice("Этап изменён по вашему подтверждению."); }); }} />
        {state.overview.progression.length > 0 && <Accordion title="Условия прогрессии выполнены"><ul>{state.overview.progression.map((p) => <li key={`${p.rule.id}:${p.exerciseId}`}>{findExercise(p.exerciseId, state.overview.active?.program.workouts.flatMap((w) => w.exercises).find((r) => r.exerciseId === p.exerciseId)?.definition)?.name} · {p.rule.description} → {ruleActionText(p.rule.action)}</li>)}</ul><p>План сохранён. Для изменения передайте результаты ИИ, затем подтвердите новую версию.</p><Link href="/coach/">К анализу →</Link></Accordion>}
</>}>
        {skipConfirmation === state.overview.historyRevision ? <section className="panel stack" aria-label="Подтверждение пропуска занятия"><h2>Пропустить целое занятие?</h2>
          <p>Сохраним отдельный пропуск без результатов и перейдём к следующему занятию. Если хотите отложить — просто вернитесь позже, очередь не изменится.</p>
          <Button className="secondary" disabled={busy} onClick={() => { const { active, historyRevision } = state.overview; if (!active) return;
            const command = { sessionId: crypto.randomUUID(), startedAt: new Date().toISOString(), expectedCursor: active.cursor, expectedHistoryRevision: historyRevision };
            void act(async (storage) => { await storage.sessions.skipWorkout(command); setSkipConfirmation(undefined); setNotice("Занятие пропущено без тренировочных результатов. Следующее — по порядку программы."); });
          }}>Подтвердить пропуск целого занятия</Button>
          <Button className="secondary" disabled={busy} onClick={() => setSkipConfirmation(undefined)}>Отмена пропуска занятия</Button>
        </section> : <Accordion className="workout-secondary-options" title="Другие действия"><Button className="secondary" disabled={busy} onClick={() => setSkipConfirmation(state.overview.historyRevision)}>Пропустить целое занятие</Button></Accordion>}
</ProgramOverview>
        <div className="workout-start-dock"><Button className="primary workout-start" disabled={busy} onClick={() => { const { active, historyRevision } = state.overview; if (!active) return;
          const command = { sessionId: crypto.randomUUID(), startedAt: new Date().toISOString(), expectedCursor: active.cursor, expectedHistoryRevision: historyRevision };
          void act(async (storage) => { const session = await storage.sessions.start(command); if (session.status === "active") { setOpenSessionId(session.id); setNotice("Занятие начато и сохранено на этом устройстве."); } else setNotice("Это занятие уже завершено. Посмотрите следующий шаг."); });
        }}>Начать тренировку</Button></div>

        </> : <WorkoutEmpty />)}
  </div>;
}

function PhaseTransition({ active, busy, onConfirm }: Readonly<{ active: NonNullable<ActiveProgram>; busy: boolean; onConfirm: () => void }>) {
  const index = active.cursor.phaseIndex ?? 0;
  const phase = active.program.phases?.[index];
  const next = active.program.phases?.[index + 1];
  if (!phase || !next) return null;
  const remaining = Math.max(0, phaseSessionTarget(phase) - (active.cursor.phaseSessions ?? 0));
  return <Accordion title="Перейти к следующему этапу"><p>Следующий этап: {next.title}. Нагрузка указана в подробностях программы. Переход сохранит порядок дней и сбросит счётчик занятий этапа. Прежние ответы ИИ потребуют нового запроса.</p>
    {phase.transition === "after_sessions" && remaining > 0 && <p>До перехода осталось занятий: {remaining}. Пропуски и занятия без результатов не учитываются.</p>}
    <Button className="secondary" disabled={busy || (phase.transition === "after_sessions" && remaining > 0)} onClick={onConfirm}>Подтверждаю нагрузку следующего этапа и переход</Button>
  </Accordion>;
}

export function WorkoutEmpty() {
  return <section className="workout-card workout-state-card workout-empty"><WorkoutStateBrand /><WorkoutStateIcon kind="calendar" /><h2>Программы пока нет</h2><p>Получите программу и подтвердите её перед началом.</p><Link className="primary" href="/coach/">Получить программу</Link></section>;
}

export function SessionPanel({ session, program, revision, opened, busy, onContinue, onFinish, onSave, onAction, onTimer }: Readonly<{
  program?: ProgramVersion;
  session: WorkoutSession; revision: number; opened: boolean; busy: boolean; onContinue: () => void; onFinish: () => Promise<boolean>; onSave: (command: unknown) => Promise<boolean>;
  onAction: SessionAction; onTimer: SessionAction;
}>) {
  const [confirming, setConfirming] = useState<number>();
  const [finishError, setFinishError] = useState("");
  const [resumeTime, setResumeTime] = useState<number>();
  const resumeDeadline = !opened ? session.restTimer?.deadline : undefined;
  useEffect(() => {
    if (!resumeDeadline) return;
    const tick = () => setResumeTime(Date.now());
    tick(); const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [resumeDeadline]);
  const nextTitle = program?.workouts[((program.workouts.findIndex((w) => w.id === session.templateId)) + 1) % program.workouts.length]?.title;
  const done = session.sets.filter((set) => set.status === "done").length;
  const total = session.plannedSnapshot.exercises.reduce((sum, row) => sum + row.sets, 0);
  if (!opened) return <section className="workout-card workout-state-card workout-resume">
    <div className="workout-resume-top"><WorkoutStateBrand />{session.restTimer && <span className="workout-status-pill">Отдых · {resumeTime === undefined ? "сохранён" : clockText(restSecondsRemaining(session.restTimer.deadline, resumeTime))}</span>}</div><WorkoutStateIcon kind="play" />
    <h2>Продолжим тренировку?</h2><p>{session.plannedSnapshot.title}</p><p>Сохранено {done} из {total} подходов</p>
    <Button className="primary" disabled={busy} onClick={onContinue}>Продолжить тренировку</Button>
  </section>;
  return <>
    <SessionSets session={session} revision={revision} busy={busy} onSave={onSave} onAction={onAction} onTimer={onTimer} onFinish={() => { setConfirming(revision); setFinishError(""); }}>
      {program && <Accordion className="workout-card workout-program-details" title="Рекомендации программы"><ProgramDetails program={program} /></Accordion>}
    </SessionSets>
    {confirming !== undefined && <WorkoutDialog title="Подтверждение завершения" className="workout-dialog-finish" onClose={() => setConfirming(undefined)}>
      {done < total && <span className="workout-status-pill">Неполная тренировка</span>}<h2>Завершить тренировку?</h2><p>Сохранено {done} из {total} подходов</p>
      <dl className="workout-card finish-counts"><div><dt>Выполнено:</dt><dd>{done}</dd></div><div><dt>Осталось:</dt><dd>{total - session.sets.length}</dd></div>{session.sets.length > done && <div><dt>Пропущено:</dt><dd>{session.sets.length - done}</dd></div>}</dl>
      <p>{done === 0 ? "Выполненных подходов нет. Сохраним занятие без результатов; следующим останется то же занятие." : `Невыполненные подходы не попадут в результаты. Следующим будет занятие ${nextTitle?.split(" · ")[0] ?? "по порядку программы"}.`}</p>
      {confirming !== revision && <p role="alert">Результаты изменились. Проверьте их и подтвердите завершение заново.</p>}
      {finishError && <p role="alert">{finishError}</p>}
      <Button className="primary" disabled={busy} onClick={async () => {
        if (confirming !== revision) { setConfirming(revision); return; }
        if (!await onFinish()) setFinishError("Не удалось завершить тренировку. Результаты сохранены, можно повторить.");
      }}>{confirming !== revision ? "Результаты проверены" : done === 0 ? "Завершить без результатов" : "Завершить тренировку"}</Button>
      <Button className="secondary" disabled={busy} onClick={() => setConfirming(undefined)}>Продолжить тренировку</Button>
    </WorkoutDialog>}
  </>;
}

export function WorkoutResult({ session, active, onNext }: Readonly<{ session: WorkoutSession; active: ActiveProgram; onNext: () => void }>) {
  const done = session.sets.filter((s) => s.status === "done");
  return <section className="workout-result">
    <WorkoutStateIcon kind="check" /><h1>Тренировка завершена</h1>
    <span className="workout-status-pill">{session.status === "partial" ? "Выполнена частично" : session.status === "abandoned" ? "Без результатов" : "Выполнена полностью"}</span>
    <section className="workout-card"><h2>{session.plannedSnapshot.title}</h2><p>{countText(done.length, ["подход сохранён", "подхода сохранено", "подходов сохранено"])}</p><p>{new Set(done.map((s) => s.plannedExerciseId)).size} из {session.plannedSnapshot.exercises.length} упражнений с результатами</p>
      <Accordion title="Посмотреть результаты"><ol>{session.sets.map((s) => <li key={s.id}>{findExercise(s.actualExerciseId, s.definition)?.name} · Подход {s.index} · {s.status === "skipped" ? "пропущен" : s.actual.type === "reps" ? `${s.actual.weightKg ?? "?"} кг × ${s.actual.reps}` : s.actual.type === "duration" ? `${s.actual.seconds} с` : `${s.actual.meters} м`}</li>)}</ol></Accordion>
    </section>
    <section className="workout-card"><p className="eyebrow">ДАЛЬШЕ ПО ПОРЯДКУ</p><h2>{active?.workout.title ?? "Следующая тренировка"}</h2><p>Начните, когда будете готовы</p><Button className="primary" onClick={onNext}>К следующей тренировке</Button></section>
  </section>;
}

export function ProgramOverview({ active, children, programActions }: Readonly<{ active: NonNullable<ActiveProgram>; children?: ReactNode; programActions?: ReactNode }>) {
  const { program, cursor, workout } = active;
  const phase = program.phases?.[cursor.phaseIndex ?? 0];
  const next = program.workouts[(cursor.nextWorkoutIndex + 1) % program.workouts.length];
  return <>
    <section className="workout-card workout-summary"><p className="eyebrow">СЛЕДУЮЩЕЕ ЗАНЯТИЕ</p><h2>{workout.title}</h2><p>{program.title}{phase ? ` · ${phase.title}` : ""}</p>
      <div className="workout-summary-stats"><span><WorkoutDumbbell width={26} height={24} aria-hidden="true" />{countText(workout.exercises.length, ["упражнение", "упражнения", "упражнений"])}</span><span><Layers size={22} aria-hidden="true" />{countText(workout.exercises.reduce((sum, row) => sum + row.sets, 0), ["подход", "подхода", "подходов"])}</span></div>
    </section>
    <h2 className="workout-plan-heading">План занятия</h2><WorkoutPlan workout={workout} />
    <Accordion className="workout-card workout-disclosure" title="Рекомендации программы"><ProgramDetails program={program} />{phase && <p>Пройдено {cursor.phaseSessions ?? 0} из {phaseSessionTarget(phase)} занятий этапа.</p>}{programActions}</Accordion>
    <Accordion className="workout-card workout-disclosure" title={`Порядок занятий · дальше ${next.title.split(" · ")[0]}`}><ol className="sequence">{program.workouts.map((template, index) => <li key={template.id}>{index + 1}. {template.title}{index === cursor.nextWorkoutIndex ? " · следующее" : ""}</li>)}</ol><p>Даты не обязательны. Перерыв не меняет порядок.</p>{children}</Accordion>
  </>;
}

function WorkoutPlan({ workout }: Readonly<{ workout: WorkoutTemplate }>) {
  return <ol className="workout-exercise-list" aria-label="План занятия">{workout.exercises.map((row, index) => {
    const load = findExercise(row.exerciseId, row.definition)?.load;
    const t = row.target;
    const summary = t.type === "reps" ? `${row.sets} × ${t.min}${t.min === t.max ? "" : `–${t.max}`} · ${t.weightKg === null ? "Вес подобрать" : `${t.weightKg} кг`}${load?.type === "assistance" ? " помощи" : load?.type === "external" && load.basis === "per-dumbbell" ? " / гантель" : ""}` : `${row.sets} × ${targetText(row)}`;
    return <li key={row.id}><details className="workout-plan-details"><summary><span className="exercise-number">{index + 1}</span><span><strong>{findExercise(row.exerciseId, row.definition)?.name ?? "Упражнение"}</strong><small>{summary}</small></span><span className="workout-row-chevron" aria-hidden="true">›</span></summary>
      <div className="workout-plan-extra"><p>{targetText(row)} · Отдых {row.restSec} с</p>{t.type === "reps" && <p>RIR: {row.rir ?? "неизвестен"}{row.rirMax === undefined ? "" : `–${row.rirMax}`}</p>}{t.type !== "reps" && t.intensity && <p>{t.intensity}</p>}{row.note && <p>{row.note}</p>}
        {row.setPlans && <ol>{row.setPlans.map((_, i) => <li key={i}>{setPlanLabel(row, i + 1)}</li>)}</ol>}
      </div></details></li>;
  })}</ol>;
}


