"use client";

import { useRef, useState, type ReactNode } from "react";
import { actualTargetSchema, plannedSet, setPlanLabel, exerciseSetSchema, findExercise, type ExerciseSet, type PlannedExercise, type WorkoutSession } from "@/entities/training";
import { Accordion, Button, Input } from "@/shared/ui";
import { ExerciseActions, RestTimer, type SessionAction } from "./session-controls";
import { clockText, targetText, factText, countText, WorkoutStateBrand, WorkoutStateIcon } from "./workout-ui";
import { firstPendingSlot, nextSlotAfterRecording, type SessionSlot } from "./session-navigation";

type Save = (command: unknown) => Promise<boolean>;
type Slot = SessionSlot;
function initialSlot(session: WorkoutSession): Slot { return firstPendingSlot(session) ?? { rowId: session.plannedSnapshot.exercises[0].id, index: 1 }; }

export function SessionSets({ session, revision, busy, onSave, onAction, onTimer, onFinish, children }: Readonly<{
  session: WorkoutSession; revision: number; busy: boolean; onSave: Save; onAction: SessionAction; onTimer: SessionAction; onFinish?: () => void; children?: ReactNode;
}>) {
  const [slot, setSlot] = useState(() => initialSlot(session));
  const [drafts, setDrafts] = useState<readonly Slot[]>(() => session.sets.length === 0 || !session.sets.some((s) => s.plannedExerciseId === initialSlot(session).rowId && s.index === initialSlot(session).index) ? [initialSlot(session)] : []);
  const [autoRest, setAutoRest] = useState(true);
  const sessionRoot = useRef<HTMLElement>(null);
  const exercises = session.plannedSnapshot.exercises;
  const row = exercises.find((r) => r.id === slot.rowId) ?? exercises[0];
  const exerciseIndex = exercises.findIndex((r) => r.id === row.id);
  const selectedId = session.replacements?.find((item) => item.plannedExerciseId === row.id)?.actualExerciseId ?? row.exerciseId;
  const name = findExercise(selectedId, row.definition)?.name;
  const done = session.sets.filter((s) => s.status === "done").length;
  const total = exercises.reduce((sum, r) => sum + r.sets, 0);
  const plan = plannedSet(row, slot.index);
  const selectedFact = session.sets.find((s) => s.plannedExerciseId === row.id && s.index === slot.index);
  const nextSlot = selectedFact ? initialSlot(session) : slot;
  const nextRow = exercises.find((r) => r.id === nextSlot.rowId) ?? row;
  const nextPlan = plannedSet(nextRow, nextSlot.index);
  const nextSelectedId = session.replacements?.find((r) => r.plannedExerciseId === nextRow.id)?.actualExerciseId ?? nextRow.exerciseId;
  function select(next: Slot, edit = true) {
    setSlot(next);
    if (edit && !drafts.some((d) => d.rowId === next.rowId && d.index === next.index)) setDrafts((items) => [...items, next]);
  }
  function afterSave(saved: Slot, created: boolean) {
    setDrafts((items) => items.filter((d) => d.rowId !== saved.rowId || d.index !== saved.index));
    // Only our committed save advances selection. A remote update never closes a draft.
    const next = created ? nextSlotAfterRecording(session, saved) : undefined;
    if (next) {
      setSlot(next);
      setDrafts((items) => items.some((d) => d.rowId === next.rowId && d.index === next.index) ? items : [...items, next]);
      if (next.rowId !== saved.rowId) sessionRoot.current?.closest<HTMLElement>(".shell-scroll")?.scrollTo({ top: 0, behavior: "auto" });
    }
  }
  return <section ref={sessionRoot} className={`workout-session${session.restTimer ? " workout-rest-state" : ""}`} aria-label="Фактические подходы">
    <header className="session-heading"><div><h1>{session.plannedSnapshot.title}</h1><p>Упражнение {exerciseIndex + 1} из {exercises.length}</p></div><span className="rest-exercise-counter">{exerciseIndex + 1} из {exercises.length}<span aria-hidden="true">{exercises.map((r, i) => <i key={r.id} className={i <= exerciseIndex ? "is-current" : ""} />)}</span></span>{onFinish && <Button className="secondary finish-trigger" disabled={busy} onClick={onFinish}>Завершить</Button>}</header>
    <div className="session-progress" role="progressbar" aria-label="Выполненные подходы" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}><span style={{ width: `${done / total * 100}%` }} /></div><p className="session-count">{done} из {total} подходов</p>
    <section className="workout-card exercise-editor" aria-label={name}>
      <div className="exercise-editor-heading"><h2>{name}</h2><Accordion title="План и техника"><p>{setPlanLabel(row, slot.index)}</p>{row.note && <p>{row.note}</p>}{session.replacements?.some((r) => r.plannedExerciseId === row.id) && <p>Замена на это занятие. Исходное упражнение: {findExercise(row.exerciseId, row.definition)?.name}. Вес подберите заново.</p>}</Accordion></div>
      <p className="exercise-subtitle">{countText(row.sets, ["подход", "подхода", "подходов"])} · отдых {clockText(plan.restSec)}</p>
      {session.restTimer && <ol className="rest-exercise-sets" aria-label="Подходы во время отдыха">{Array.from({ length: row.sets }, (_, i) => i + 1).map((index) => {
        const fact = session.sets.find((set) => set.plannedExerciseId === row.id && set.index === index);
        return <li key={index}><button className={index === slot.index ? "is-current" : ""} disabled={busy} onClick={() => select({ rowId: row.id, index }, !fact)}><span className={fact?.status === "done" ? "set-dot is-done" : "set-dot"} aria-hidden="true">{fact?.status === "done" ? "✓" : fact?.status === "skipped" ? "−" : ""}</span><strong>Подход {index}</strong><span>{fact ? factText(fact) : targetText(plannedSet(row, index))}</span></button></li>;
      })}</ol>}
      <div className="set-plan"><p>ПЛАН ПОДХОДА {slot.index}</p><strong>{targetText(plan)}{plan.target.type === "reps" && plan.rir != null ? ` · RIR ${plan.rir}${plan.rirMax === undefined ? "" : `–${plan.rirMax}`}` : ""}</strong></div>
      <table className="set-table" aria-label="План и сохранённые подходы">
        <thead><tr className="set-table-head"><th scope="col">Подход</th><th scope="col">{row.target.type === "reps" ? "кг" : "План"}</th><th scope="col">{row.target.type === "reps" ? "Повторы" : row.target.type === "duration" ? "Секунды" : "Метры"}</th><th scope="col">Статус</th></tr></thead><tbody>
        {Array.from({ length: row.sets }, (_, i) => i + 1).map((index) => {
          const fact = session.sets.find((s) => s.plannedExerciseId === row.id && s.index === index);
          const t = fact?.status === "done" ? fact.actual : plannedSet(row, index).target;
          return <tr key={index} className={`set-table-row${slot.index === index ? " is-current" : ""}${fact?.status === "done" ? " is-saved" : ""}`}>
            <td><button className="set-select-slot" aria-label={`Подход ${index}, ${fact ? factText(fact) : "ввести результат"}`} disabled={busy || fact?.status === "skipped"} onClick={() => select({ rowId: row.id, index })}>{index}</button></td><td><span className="set-table-value">{t.type === "reps" ? t.weightKg ?? "—" : "—"}</span></td><td><span className="set-table-value">{fact?.status === "skipped" ? "—" : t.type === "reps" ? ("reps" in t ? t.reps : slot.index === index ? t.min : `${t.min}–${t.max}`) : t.type === "duration" ? t.seconds : t.meters}</span></td><td>{fact?.status === "done" ? <><span className="set-saved-check" aria-hidden="true">✓</span> Сохранён</> : fact?.status === "skipped" ? "Пропущен" : slot.index === index ? "Сейчас" : "—"}
            {fact?.status === "done" && <span className="sr-only">Сохранённый факт · {findExercise(fact.actualExerciseId, fact.definition)?.name}: {fact.actual.type === "reps" ? `${fact.actual.reps} повторений · ${fact.actual.weightKg} кг` : factText(fact)}</span>}
            </td></tr>;
        })}
      </tbody></table>
      {drafts.map((draft) => {
        const draftRow = exercises.find((r) => r.id === draft.rowId);
        if (!draftRow) return null;
        const draftSaved = session.sets.find((s) => s.plannedExerciseId === draft.rowId && s.index === draft.index);
        const actualId = session.replacements?.find((r) => r.plannedExerciseId === draft.rowId)?.actualExerciseId ?? draftRow.exerciseId;
        return <div key={`${draft.rowId}:${draft.index}`} hidden={slot.rowId !== draft.rowId || slot.index !== draft.index}>
          <SetForm row={plannedSet(draftRow, draft.index)} selectedId={actualId} index={draft.index} session={session} saved={draftSaved} revision={revision} busy={busy} autoRest={autoRest} setAutoRest={setAutoRest} onSave={onSave} onDone={(created) => afterSave(draft, created)} onCancel={() => setDrafts((items) => items.filter((d) => d !== draft))} />
        </div>;
      })}
      {!drafts.some((d) => d.rowId === row.id && d.index === slot.index) && <div className="stack">
        <p>{selectedFact ? factText(selectedFact) : "Ввод закрыт без сохранения."}</p>
        {selectedFact?.status !== "skipped" && <Button className="primary" disabled={busy} onClick={() => select(slot)}>{selectedFact ? "Исправить подход" : "Ввести подход"}</Button>}
      </div>}
    </section>
    {!firstPendingSlot(session) && onFinish && <section className="workout-card workout-complete"><h2>{done === total ? "Все упражнения выполнены" : "Все подходы отмечены"}</h2><p>Сохранено {done} из {total} подходов{session.sets.length > done ? `, пропущено ${session.sets.length - done}` : ""}.</p><Button className="primary" disabled={busy} onClick={onFinish}>Завершить тренировку</Button></section>}
    <section className="workout-card exercise-navigation"><Accordion key={row.id} title={`Все упражнения · ${exerciseIndex + 1} из ${exercises.length}`}><ol className="workout-exercise-list">{exercises.map((r, i) => <li key={r.id}><button className="workout-exercise-select" disabled={busy} aria-current={r.id === row.id ? "step" : undefined} onClick={() => {
      const index = Array.from({ length: r.sets }, (_, n) => n + 1).find((n) => !session.sets.some((s) => s.plannedExerciseId === r.id && s.index === n)) ?? 1;
      select({ rowId: r.id, index }, !session.sets.some((s) => s.plannedExerciseId === r.id && s.index === index));
    }}><span className="exercise-number">{i + 1}</span><span><strong>{findExercise(r.exerciseId, r.definition)?.name}</strong><small>{session.sets.filter((s) => s.plannedExerciseId === r.id && s.status === "done").length} из {r.sets} подходов</small></span><span>›</span></button></li>)}</ol>{children}</Accordion>
      <ExerciseActions row={row} session={session} revision={revision} busy={busy} onAction={onAction} />
    </section>
    <RestTimer session={session} busy={busy} onTimer={onTimer} restSec={plan.restSec} next={session.sets.length === total ? "Все подходы записаны" : `подход ${nextSlot.index} из ${nextRow.sets} · ${targetText(nextPlan)}`} nextName={findExercise(nextSelectedId, nextRow.definition)?.name} />
  </section>;
}

function StepField({ label, value, onChange, step, busy, inputLabel, numeric = false, placeholder }: Readonly<{
  label: string; value: string; onChange: (value: string) => void; step: number; busy: boolean; inputLabel: string; numeric?: boolean; placeholder?: string;
}>) {
  function adjust(direction: number) {
    const parsed = value.trim() === "" ? 0 : Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) onChange(String(Math.round(Math.max(0, parsed + direction * step) * 100) / 100));
  }
  return <label className="set-step-field"><span>{label}</span><span className="set-step-control"><button type="button" aria-label={`Уменьшить: ${label}`} disabled={busy} onClick={() => adjust(-1)}>−</button><Input aria-label={inputLabel} inputMode={numeric ? "numeric" : "decimal"} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} disabled={busy} /><button type="button" aria-label={`Увеличить: ${label}`} disabled={busy} onClick={() => adjust(1)}>+</button></span></label>;
}

function SetForm({ row, selectedId, index, session, saved, revision, busy, onSave, onDone, onCancel, autoRest, setAutoRest }: Readonly<{
  row: PlannedExercise; selectedId: string; index: number; session: WorkoutSession; saved?: ExerciseSet; revision: number; busy: boolean; onSave: Save; onDone: (created: boolean) => void; onCancel: () => void; autoRest: boolean; setAutoRest: (enabled: boolean) => void;
}>) {
  const [baseline] = useState(saved);
  const [exerciseId] = useState(baseline?.actualExerciseId ?? selectedId);
  const load = findExercise(exerciseId, row.definition)?.load;
  const target = baseline?.status === "done" ? baseline.actual : row.target;
  const [amount, setAmount] = useState(String(target.type === "reps" ? ("reps" in target ? target.reps : target.min) : target.type === "duration" ? target.seconds : target.meters));
  const [weight, setWeight] = useState(target.type === "reps" && target.weightKg !== null && (baseline || exerciseId === row.exerciseId) ? String(target.weightKg) : "");
  const [rir, setRir] = useState(baseline?.status === "done" && baseline.rir != null ? String(baseline.rir) : "");
  const [error, setError] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const identity = useRef<{ id: string; timestamp: string }>(undefined);
  const submitting = useRef(false);
  const label = row.target.type === "reps" ? "Повторы" : row.target.type === "duration" ? "Время, секунды" : "Дистанция, метры";
  return <form className={`set-form stack${saveFailed ? " set-save-failed" : ""}`} onSubmit={async (event) => {
    event.preventDefault();
    if (submitting.current) return;
    setError(""); setSaveFailed(false);
    const number = (value: string) => value.trim() === "" ? null : Number(value.replace(",", "."));
    const actual = actualTargetSchema.safeParse(row.target.type === "reps" ? { type: "reps", reps: number(amount), weightKg: number(weight) }
      : row.target.type === "duration" ? { type: "duration", seconds: number(amount) } : { type: "distance", meters: number(amount) });
    if (!actual.success) { setError("Проверьте фактическое значение и единицы. Пустой вес означает неизвестный."); return; }
    identity.current ??= baseline ? { id: baseline.id, timestamp: baseline.timestamp } : { id: crypto.randomUUID(), timestamp: new Date().toISOString() };
    const parsed = exerciseSetSchema.safeParse({ ...(baseline ?? { sessionId: session.id, plannedExerciseId: row.id, originalExerciseId: row.exerciseId, ...(row.definition ? { definition: row.definition } : {}), actualExerciseId: exerciseId, index }),
      ...identity.current, status: "done", actual: actual.data, ...(row.target.type === "reps" ? { rir: number(rir) } : {}) });
    if (!parsed.success) { setError("RIR — от 0 до 10 или пустое поле, если неизвестен."); return; }
    const now = Date.now();
    const auto = !baseline && autoRest && row.restSec > 0 ? { expectedTimer: session.restTimer ?? null, timer: { id: crypto.randomUUID(), startedAt: new Date(now).toISOString(), deadline: new Date(now + row.restSec * 1000).toISOString() } } : undefined;
    submitting.current = true;
    try {
      if (await onSave({ set: parsed.data, expectedSet: baseline ?? null, expectedHistoryRevision: revision, ...(auto ? { autoRest: auto } : {}) })) onDone(baseline === undefined);
      else { setSaveFailed(true); setError("Проверьте свободное место и повторите. Введённые значения сохранены в форме."); }
    } finally { submitting.current = false; }
  }}>
    {saveFailed && <><WorkoutStateBrand /><div className="set-save-error" role="alert"><WorkoutStateIcon kind="warning" /><h2>Подход не сохранён</h2><p>{error}</p></div></>}
    {load?.type === "assistance" && <p className="muted">Килограммы означают помощь тренажёра.</p>}
    {load?.type === "bodyweight" && <p className="muted">Килограммы — дополнительный вес, без массы тела.</p>}
    {load?.type === "external" && load.basis === "per-dumbbell" && <p className="muted">Укажите вес одной гантели.</p>}
    {!baseline && exerciseId !== selectedId && <p role="alert">Упражнение изменилось. Ваш ввод сохранён на экране. Закройте ввод и откройте новую форму для выбранной замены.</p>}
    {saved?.status === "skipped" && <p role="alert">Подход уже пропущен. Черновик остаётся; закрыть его можно кнопкой ниже.</p>}
    <div className="set-fields">{row.target.type === "reps" && <StepField label="Вес, кг" inputLabel={`Вес, кг, подход ${index}`} value={weight} onChange={setWeight} step={2.5} busy={busy} placeholder="Подобрать" />}
      <StepField label={label} inputLabel={`${label}, подход ${index}`} value={amount} onChange={setAmount} step={row.target.type === "distance" ? 10 : 1} busy={busy} numeric={row.target.type === "reps"} />
    </div>
    {row.target.type === "reps" && <Accordion className="set-rir" title="Запас повторов (RIR) · по желанию"><p>Сколько повторений осталось в запасе. Пусто — неизвестно; 0 — запаса нет.</p><label>RIR<Input aria-label={`RIR, подход ${index}`} inputMode="decimal" placeholder="Не знаю" value={rir} onChange={(event) => setRir(event.target.value)} disabled={busy} /></label></Accordion>}
    {error && !saveFailed && <p role="alert" tabIndex={-1}>{error}</p>}
    <Button type="submit" className="primary save-set" disabled={busy || saved?.status === "skipped" || (!baseline && exerciseId !== selectedId)}>{saveFailed ? "Повторить сохранение" : baseline ? "Сохранить исправление" : "Сохранить подход"}</Button>
    {!baseline && <label className="auto-rest"><span>После сохранения — отдых {clockText(row.restSec)}</span><span className="auto-rest-switch"><input type="checkbox" checked={autoRest} onChange={(event) => setAutoRest(event.target.checked)} disabled={busy || row.restSec === 0} /><span aria-hidden="true" />Автоотдых</span></label>}
    {(baseline || (error && !saveFailed) || (!baseline && exerciseId !== selectedId) || saved?.status === "skipped") && <Button className="secondary" disabled={busy} onClick={onCancel}>{baseline ? "Отменить исправление" : "Закрыть ввод без сохранения"}</Button>}
  </form>;
}
