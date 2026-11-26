"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { findExercise, type PlannedExercise, type ExerciseSet } from "@/entities/training";
import { WorkoutDumbbell } from "@/shared/ui";

export function WorkoutStateBrand() {
  return <div className="workout-state-brand"><WorkoutDumbbell width={28} height={24} aria-hidden="true" /><span>AI Fitness Coach</span></div>;
}

export function WorkoutStateIcon({ kind }: Readonly<{ kind: "calendar" | "play" | "warning" | "check" }>) {
  return <svg className={`workout-state-icon workout-state-icon-${kind}`} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === "calendar" ? <><rect x="10" y="15" width="44" height="40" rx="6" /><path d="M10 27h44M21 8v15M43 8v15" /></> : kind === "warning" ? <><path d="m28 10-22 38a5 5 0 0 0 4 8h44a5 5 0 0 0 4-8L36 10a5 5 0 0 0-8 0Z" /><path d="M32 26v12M32 47h.01" /></> : <><circle cx="32" cy="32" r="28" />{kind === "play" ? <path d="m26 20 18 12-18 12Z" fill="currentColor" strokeWidth="1" /> : <path d="m18 33 10 10 20-24" />}</>}</svg>;
}

export function clockText(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function countText(count: number, forms: readonly [string, string, string]) {
  const last = count % 10;
  const form = count % 100 >= 11 && count % 100 <= 14 ? forms[2] : last === 1 ? forms[0] : last >= 2 && last <= 4 ? forms[1] : forms[2];
  return `${count} ${form}`;
}

export function targetText(row: PlannedExercise) {
  const t = row.target;
  if (t.type === "duration") return `${t.seconds}${t.maxSeconds === undefined ? "" : `–${t.maxSeconds}`} с`;
  if (t.type === "distance") return `${t.meters} м`;
  const load = findExercise(row.exerciseId, row.definition)?.load;
  const unit = load?.type === "external" && load.basis === "per-dumbbell" ? "кг / гантель" : load?.type === "assistance" ? "кг помощи" : "кг";
  return `${t.weightKg === null ? "Вес подобрать" : `${t.weightKg} ${unit}`} × ${t.min}${t.min === t.max ? "" : `–${t.max}`}`;
}

export function factText(set: ExerciseSet) {
  if (set.status === "skipped") return "Пропущен — не результат";
  const a = set.actual;
  return a.type === "reps" ? `${a.weightKg === null ? "Вес неизвестен" : `${a.weightKg} кг`} × ${a.reps}` : a.type === "duration" ? `${a.seconds} с` : `${a.meters} м`;
}

export function WorkoutDialog({ title, children, onClose, full = false, sheet = false, className = "" }: Readonly<{
  title: string; children: ReactNode; onClose: () => void; full?: boolean; sheet?: boolean; className?: string;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.focus({ preventScroll: true });
    if (dialog) dialog.scrollTop = 0;
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} tabIndex={-1} className={`workout-dialog${full ? " workout-dialog-full" : ""}${sheet ? " workout-dialog-sheet" : ""} ${className}`} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    {children}
  </dialog>;
}
