"use client";

import Link from "next/link";
import { liveQuery } from "dexie";
import { useEffect, useRef, useState } from "react";
import { createTrainingStorage, StorageConflictError, type AnalysisResult, type TrainingStorage } from "@/entities/training";
import { Accordion, Button } from "@/shared/ui";

type Overview = Awaited<ReturnType<TrainingStorage["analysis"]["overview"]>>;

export function AnalysisSignal({ coach = false }: Readonly<{ coach?: boolean }>) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; value: Overview }>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [snapshotError, setSnapshotError] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    const storage = createTrainingStorage();
    let disposed = false;
    let subscription: { unsubscribe(): void } | undefined;
    let refresh = () => {};
    void (async () => {
      try {
        await storage.open();
        if (disposed) { storage.close(); return; }
        refresh = () => {
          subscription?.unsubscribe();
          subscription = liveQuery(() => storage.analysis.overview(new Date().toISOString())).subscribe({
            next: (value) => {
              if (!disposed) setState({ status: "ready", value });
              void storage.analysis.refresh(new Date().toISOString()).then(
                () => { if (!disposed) setSnapshotError(""); },
                () => { if (!disposed) setSnapshotError("Не удалось сохранить локальный сигнал. Показаны причины из сохранённых фактов; повторите проверку."); },
              );
            },
            error: () => { if (!disposed) setState({ status: "error" }); },
          });
        };
        refresh();
      } catch { if (!disposed) setState({ status: "error" }); }
    })();
    const onReturn = () => { if (document.visibilityState === "visible") refresh(); };
    const interval = window.setInterval(onReturn, 60000);
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => { disposed = true; subscription?.unsubscribe(); window.clearInterval(interval);
      window.removeEventListener("focus", onReturn); document.removeEventListener("visibilitychange", onReturn); storage.close(); };
  }, [attempt]);

  async function act(kind: "manual" | "snooze") {
    if (lock.current || state.status !== "ready" || !state.value) return;
    lock.current = true; setBusy(true); setError("");
    const storage = createTrainingStorage();
    try {
      await storage.open();
      await storage.analysis.act({ kind, now: new Date().toISOString(), expectedToken: state.value.token });
    } catch (cause) { setError(cause instanceof StorageConflictError ? cause.message : "Не удалось сохранить выбор. Повторите; отсрочка не подтверждена."); }
    finally {
      storage.close();
      // After commit the manual/snooze buttons can move into each other's place.
      // Keep the second native click from applying the opposite action.
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      lock.current = false; setBusy(false);
    }
  }

  if (state.status === "loading") return null;
  if (state.status === "error") return <section className="panel stack" aria-label="Анализ"><p>Не удалось прочитать сигналы анализа. Тренировка остаётся доступна.</p><Button className="secondary" onClick={() => setAttempt((value) => value + 1)}>Повторить чтение сигналов</Button></section>;
  if (!state.value) return null;
  const value = state.value;
  if (!coach && !value.needsAnalysis && !value.deferred && !snapshotError) return null;
  return <section className="panel stack" aria-label="Локальный анализ">
    <AnalysisSummary value={value} />
    {error && <p role="alert">{error}</p>}
    {snapshotError && <><p role="alert">{snapshotError}</p><Button className="secondary" onClick={() => setAttempt((value) => value + 1)}>Повторить сохранение сигнала</Button></>}
    {value.needsAnalysis && !value.reasonCodes.includes("safety") && <Button className="secondary" disabled={busy} onClick={() => void act("snooze")}>Отложить на два занятия</Button>}
    {coach ? <>
      <Button className="secondary" disabled={busy || (value.reasonCodes.includes("manual") && !value.deferred)} onClick={() => void act("manual")}>Запросить анализ вручную</Button>
      <p className="muted">Здесь сохраняется локальный сигнал. Файл повторного анализа можно подготовить в разделе передачи запроса ниже. Тренироваться можно сейчас.</p>
    </> : <Link className="quiet" href="/coach/">Посмотреть анализ →</Link>}
  </section>;
}

export function AnalysisSummary({ value }: Readonly<{ value: AnalysisResult }>) {
  return <>
    <h2>{value.deferred ? "Анализ отложен" : value.needsAnalysis ? "Есть повод для анализа" : "Анализ по необходимости"}</h2>
    {value.deferred ? <p>До напоминания — ещё {value.remaining} занятия с результатами. Новый существенный сигнал появится раньше.</p>
      : value.signals.length ? <p role={value.reasonCodes[0] === "safety" ? "alert" : undefined}>{value.signals[0].message}</p> : <p>Сейчас локальных сигналов нет. Можно запросить анализ самостоятельно.</p>}
    <p>Текущая программа не меняется. Анализ не блокирует тренировку.</p>
    {value.signals.length > 0 && <Accordion title="Причины и факты анализа">
      <ul>{value.signals.map((signal) => <li key={signal.key}><p>{signal.message}</p>
        {signal.evidence.length > 0 && <ul>{signal.evidence.map((fact) => <li key={fact.sessionId}>
          <p className="coach-id">Занятие: {fact.sessionId}</p><p className="coach-id">Подходы: {fact.setIds.join(", ")}</p>
        </li>)}</ul>}
      </li>)}</ul>
    </Accordion>}
  </>;
}
