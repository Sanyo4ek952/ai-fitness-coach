"use client";

import Link from "next/link";
import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { createTrainingStorage, type ExerciseProgress, type ProgressPoint, type TrainingStorage } from "@/entities/training";
import { Button } from "@/shared/ui";

type Overview = Awaited<ReturnType<TrainingStorage["progress"]["overview"]>>;
const numberFormat = new Intl.NumberFormat("ru-RU", { maximumSignificantDigits: 15 });
const number = (value: number) => numberFormat.format(value);
const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function TrainingProgress() {
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; value: Overview }>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const storage = createTrainingStorage();
    let disposed = false;
    let subscription: { unsubscribe(): void } | undefined;
    void (async () => {
      try {
        await storage.open();
        if (disposed) { storage.close(); return; }
        subscription = liveQuery(() => storage.progress.overview()).subscribe({
          next: (value) => { if (!disposed) setState({ status: "ready", value }); },
          error: () => { if (!disposed) setState({ status: "error" }); },
        });
      } catch { if (!disposed) setState({ status: "error" }); }
    })();
    return () => { disposed = true; subscription?.unsubscribe(); storage.close(); };
  }, [attempt]);

  return <div className="stack training-progress">
    <div><h1>Прогресс</h1><p className="muted">Ваша цель и сохранённая работа в зале.</p></div>
    {state.status === "loading" ? <p role="status">Читаем историю на этом устройстве…</p>
      : state.status === "error" ? <section className="panel stack"><p role="alert">Не удалось прочитать прогресс. Данные не изменены. Повторите чтение.</p>
        <Button className="secondary" onClick={() => { setState({ status: "loading" }); setAttempt((value) => value + 1); }}>Повторить чтение</Button></section>
      : <ProgressSummary value={state.value} />}
  </div>;
}

export function ProgressSummary({ value }: Readonly<{ value: Overview }>) {
  const { counts } = value;
  return <>
    <section className="panel stack" aria-label="Цель и занятия">
      <h2>Ваша цель</h2>
      {value.goal ? <p>{value.goal}</p> : <p>Цель пока не сохранена. <Link href="/profile/">Открыть профиль</Link></p>}
      <p className="muted">Показываем выполненную работу за всё время, включая прежние версии программы. Эти цифры сами по себе не измеряют достижение цели, рост силы или изменение тела.</p>
      <dl className="progress-counts">
        <div><dt>Полных занятий</dt><dd>{counts.completed}</dd></div>
        <div><dt>Частичных занятий</dt><dd>{counts.partial}</dd></div>
        <div><dt>Пропущено целиком</dt><dd>{counts.skipped}</dd></div>
      </dl>
      {(counts.active > 0 || counts.abandoned > 0) && <p className="muted">Вне итогов: в процессе — {counts.active}, закрыто без завершения — {counts.abandoned}.</p>}
    </section>
    {value.exercises.length === 0 ? <section className="panel stack"><h2>История появится после занятия</h2>
      <p>После завершения полного или частичного занятия здесь будут выполненные подходы. Дополнительные сведения для этого не нужны.</p>
      <Link className="quiet" href="/workout/">К тренировке →</Link></section>
      : <><p className="muted">Графики учитывают только выполненные подходы полных и частичных занятий. Пропуски и незавершённые занятия не добавляют объём. Упражнения и единицы показаны отдельно.</p>
        {value.exercises.map((item) => <ExerciseHistory key={item.exercise.id} item={item} />)}</>}
  </>;
}

const loadLabels = {
  total: "Вес снаряда целиком", "per-dumbbell": "Вес одной гантели", "machine-stack": "Указанный вес тренажёра",
  "added-weight": "Добавочный вес к массе тела", "machine-assistance": "Помощь тренажёра",
};

function ExerciseHistory({ item }: Readonly<{ item: ExerciseProgress }>) {
  const [limit, setLimit] = useState(12);
  const points = item.points.slice(-12);
  const max = Math.max(...points.map((point) => point.total));
  return <section className="panel stack" aria-label={item.exercise.name}>
    <h2>{item.exercise.name}</h2>
    <p>За всё время: {number(item.total)} {item.unit} · подходов: {item.doneSetCount} · занятий: {item.points.length}</p>
    {item.exercise.load.type !== "none" && <p className="muted">{loadLabels[item.exercise.load.basis]}. Неизвестный вес не равен нулю. Сумма повторов при разных весах и RIR — объём работы, а не сравнение силы. Помощь тренажёра не считается отягощением.</p>}
    {points.length >= 2 ? <figure className="progress-chart">
      <figcaption>Работа по занятиям ({item.unit}) · Последние {points.length}; от ранних к поздним.</figcaption>
      <ol>{points.map((point) => <li key={point.sessionId}>
        <span>{date(point.endedAt)}{point.status === "partial" ? " · частично" : ""}</span>
        <div className="progress-bar-track" aria-hidden="true"><div className="progress-bar" style={{ width: `${point.total / max * 100}%` }} /></div>
        <strong>{number(point.total)} {item.unit}</strong>
      </li>)}</ol>
    </figure> : <p className="muted">Пока одно занятие с этим упражнением; результат — ниже.</p>}
    <details className="progress-details"><summary>Подходы по занятиям{item.exercise.measurement === "reps" ? " — вес и RIR" : ""}</summary>
      <ol className="progress-facts">{item.points.slice(-limit).reverse().map((point) => <PointFacts key={point.sessionId} point={point} />)}</ol>
      {limit < item.points.length && <Button className="secondary" onClick={() => setLimit((count) => count + 12)}>Показать ещё до 12 занятий</Button>}
    </details>
  </section>;
}

function PointFacts({ point }: Readonly<{ point: ProgressPoint }>) {
  return <li><p><time dateTime={point.endedAt}>{date(point.endedAt)}</time> · {point.status === "partial" ? "частичное" : "полное"} занятие</p>
    <ul>{point.sets.map((set) => <li key={set.id}>
      {set.actual.type === "reps" ? <>{set.actual.reps} повт. · {set.actual.weightKg === null ? "вес неизвестен" : `${number(set.actual.weightKg)} кг`} · RIR {set.rir == null ? "неизвестен" : set.rir}</>
        : set.actual.type === "duration" ? `${number(set.actual.seconds)} с` : `${number(set.actual.meters)} м`}
      {set.actualExerciseId !== set.originalExerciseId && " · замена упражнения"}
    </li>)}</ul>
  </li>;
}
