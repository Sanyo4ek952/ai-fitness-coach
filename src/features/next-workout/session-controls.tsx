"use client";

import { useEffect, useState } from "react";
import { findExercise, replacementOptions, restSecondsRemaining, type PlannedExercise, type WorkoutSession } from "@/entities/training";
import { Button } from "@/shared/ui";
import { clockText, WorkoutDialog, WorkoutStateBrand } from "./workout-ui";

export type SessionAction = (command: unknown) => Promise<boolean>;

export function RestTimer({ session, busy, onTimer, restSec = 0, next = "", nextName = "" }: Readonly<{
  session: WorkoutSession; busy: boolean; onTimer: SessionAction; restSec?: number; next?: string; nextName?: string;
}>) {
  const [now, setNow] = useState<number>();
  const [full, setFull] = useState(false);
  const [timerError, setTimerError] = useState("");
  const timer = session.restTimer;
  const deadline = timer?.deadline;
  useEffect(() => {
    if (!deadline) return;
    const tick = () => setNow(Date.now());
    const interval = window.setInterval(tick, 250);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    tick();
    return () => { window.clearInterval(interval); window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", tick); };
  }, [deadline]);
  const seconds = deadline && now !== undefined ? restSecondsRemaining(deadline, now) : undefined;
  const total = timer ? (Date.parse(timer.deadline) - Date.parse(timer.startedAt)) / 1000 : 1;
  const fraction = seconds === undefined ? 0 : Math.min(1, seconds / total);

  async function change(delta?: number) {
    setTimerError("");
    const timestamp = Date.now();
    const remaining = delta === undefined ? 0 : Math.min(600, Math.max(0, (deadline ? restSecondsRemaining(deadline, timestamp) : restSec) + delta));
    const nextDeadline = timestamp + remaining * 1000;
    const startedAt = timer ? Math.max(Date.parse(timer.startedAt), nextDeadline - 600000) : timestamp;
    const nextTimer = remaining > 0 ? { id: crypto.randomUUID(), startedAt: new Date(startedAt).toISOString(), deadline: new Date(nextDeadline).toISOString() } : null;
    if (await onTimer({ sessionId: session.id, expectedTimer: timer ?? null, timer: nextTimer })) {
      setNow(Date.now());
      if (!nextTimer) setFull(false);
    } else setTimerError("Не удалось изменить таймер. Проверьте текущее время и повторите действие.");
  }
  const readout = <span role="timer" aria-live="off" className="rest-digits">{seconds === undefined ? <span className="rest-loading">Восстанавливаем время…</span> : clockText(seconds)}</span>;
  const adjustments = <div className="rest-adjust"><Button className="secondary" disabled={busy || seconds === undefined || seconds === 0} onClick={() => { void change(-15); }}>−15 с</Button><Button className="secondary" disabled={busy || seconds === undefined || seconds === 600} onClick={() => { void change(15); }}>+15 с</Button></div>;
  const expired = <div className="rest-expired"><WorkoutStateBrand /><p className="rest-expired-label">ОТДЫХ</p>{readout}<h2>Можно продолжать</h2><p>{nextName}{next ? ` · ${next.replace(/ · .*/, "")}` : ""}</p><Button className="primary" disabled={busy} onClick={() => { void change(); }}>К упражнению</Button><p role="status"><span className="sr-only">Отдых завершён. </span>Начните, когда будете готовы</p></div>;
  return <>
    <section className={`workout-card rest-dock${timer ? " rest-running" : ""}`} aria-label="Таймер отдыха">
      {!timer ? <><strong>Отдых не запущен</strong><Button className="secondary" disabled={busy || restSec === 0} onClick={() => { void change(0); }}>Запустить {clockText(restSec)}</Button></> : seconds === 0 ? expired : <>
        <h2>Отдых</h2><button className="rest-expand" aria-label="Открыть крупный таймер" onClick={() => setFull(true)}>{readout}</button>
        <p role="status">{seconds === 0 ? "Отдых завершён. Продолжайте, когда готовы." : next ? `Далее: ${next.replace(/ из \d+/, "")}` : "Продолжайте, когда будете готовы."}</p>
        <div className="rest-track" aria-hidden="true"><span style={{ width: `${fraction * 100}%` }} /></div>
        {adjustments}<div className="rest-links"><button className="workout-text-button" onClick={() => setFull(true)}>Крупный таймер ↗</button><button className="workout-text-button" disabled={busy} onClick={() => { void change(); }}>Закончить отдых</button></div>
      </>}
      {timerError && <p role="alert">{timerError}</p>}
    </section>
    {full && timer && <WorkoutDialog title="Крупный таймер отдыха" full onClose={() => setFull(false)}>{seconds === 0 ? <>{expired}{timerError && <p role="alert">{timerError}</p>}</> : <>
      <button className="workout-back" onClick={() => setFull(false)}>‹ К упражнению</button><h2 className="rest-full-title">ОТДЫХ</h2>
      <div className="rest-ring"><svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="90" /><circle className="rest-ring-value" cx="100" cy="100" r="90" pathLength="100" strokeDasharray={`${fraction * 100} 100`} /></svg><div>{readout}<span>из {clockText(Math.round(total)).replace(/^0/, "")}</span></div></div>
      {adjustments}<section className="workout-card rest-next"><p className="eyebrow">СЛЕДУЮЩИЙ ПОДХОД</p><h3>{nextName || "Продолжение тренировки"}</h3><p>{next ? next.charAt(0).toUpperCase() + next.slice(1) : "Посмотрите план занятия"}</p></section>
      {seconds === 0 && <p role="status">Отдых завершён. Начните, когда будете готовы.</p>}
      {timerError && <p role="alert">{timerError}</p>}
      <Button className="primary" disabled={busy} onClick={() => { void change(); }}>Закончить отдых</Button><p className="rest-background-note">В фоне звук может быть недоступен</p>
    </>}</WorkoutDialog>}
  </>;
}

export function ExerciseActions({ row, session, revision, busy, onAction }: Readonly<{
  row: PlannedExercise; session: WorkoutSession; revision: number; busy: boolean; onAction: SessionAction; onTimer?: SessionAction;
}>) {
  const [opened, setOpened] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [confirmation, setConfirmation] = useState<{ revision: number; exerciseId?: string }>();
  const selected = session.replacements?.find((item) => item.plannedExerciseId === row.id);
  const remaining = Array.from({ length: row.sets }, (_, index) => index + 1).filter((index) => !session.sets.some((set) => set.plannedExerciseId === row.id && set.index === index));
  const options = replacementOptions(row.exerciseId);
  return <>
    <button className="workout-text-button exercise-actions-trigger" onClick={() => setOpened(true)}>Заменить или пропустить ›</button>
    {opened && <WorkoutDialog title="Действия упражнения" sheet onClose={() => setOpened(false)}>
      <div className="sheet-handle" aria-hidden="true" /><h2>{findExercise(row.exerciseId, row.definition)?.name}</h2><p className="muted">Только для текущего занятия</p>
      <button className="workout-menu-row" disabled={busy || remaining.length === 0 || Boolean(selected)} onClick={() => setReplacing(!replacing)}>Заменить упражнение <span>›</span></button>
      {selected && <p>Выбрано: {findExercise(selected.actualExerciseId)?.name}. Вес подберите заново. Повторная замена недоступна.</p>}
      {replacing && <div className="stack"><p>Выберите знакомый подходящий вариант с учётом ваших ограничений.</p>{options.length === 0 && <p>Совместимых вариантов нет. Можно пропустить упражнение.</p>}{options.map((exercise) => <Button key={exercise.id} className="secondary" disabled={busy} onClick={() => setConfirmation({ revision, exerciseId: exercise.id })}>{exercise.name}</Button>)}</div>}
      <button className="workout-menu-row" disabled={busy || remaining.length === 0} onClick={() => setConfirmation({ revision })}>Пропустить оставшиеся подходы <span>›</span></button>
      <p className="muted">План программы останется прежним.</p>
      {confirmation?.revision === revision && <section className="workout-card stack" aria-label="Подтверждение действия упражнения">
        <p>{confirmation.exerciseId ? `Заменить ${findExercise(row.exerciseId, row.definition)?.name} → ${findExercise(confirmation.exerciseId)?.name}? Вес подберите заново.` : `Пропустить оставшиеся подходы (${remaining.length})? Они не считаются выполненными.`}</p>
        <Button className="primary" disabled={busy} onClick={async () => {
          setActionError("");
          const timestamp = new Date().toISOString();
          const command = confirmation.exerciseId
            ? { kind: "replace", sessionId: session.id, expectedHistoryRevision: revision, replacement: { plannedExerciseId: row.id, originalExerciseId: row.exerciseId, actualExerciseId: confirmation.exerciseId, timestamp } }
            : { kind: "skipSets", sessionId: session.id, expectedHistoryRevision: revision, sets: remaining.map((index) => ({ id: crypto.randomUUID(), sessionId: session.id, plannedExerciseId: row.id, originalExerciseId: row.exerciseId, ...(row.definition ? { definition: row.definition } : {}), actualExerciseId: selected?.actualExerciseId ?? row.exerciseId, index, timestamp, status: "skipped" })) };
          if (await onAction(command)) { setConfirmation(undefined); setOpened(false); }
          else setActionError("Не удалось сохранить действие. Проверьте текущее занятие и повторите; подтверждение остаётся открытым.");
        }}>Подтвердить {confirmation.exerciseId ? "замену" : "пропуск упражнения"}</Button><Button className="secondary" disabled={busy} onClick={() => setConfirmation(undefined)}>Отмена</Button>
      </section>}
      {confirmation && confirmation.revision !== revision && !busy && <p role="alert">Занятие изменилось. Выберите действие заново.</p>}
      {actionError && <p role="alert">{actionError}</p>}
      <Button className="secondary" disabled={busy} onClick={() => setOpened(false)}>Вернуться к подходу</Button>
    </WorkoutDialog>}
  </>;
}
