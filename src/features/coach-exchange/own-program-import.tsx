"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ZodError } from "zod";
import { createTrainingStorage, ExerciseDefinitionDetails, mergeExerciseCatalog, programDefinitions, programToDraft, StorageConflictError } from "@/entities/training";
import { Accordion, Button } from "@/shared/ui";
import { ProgramPlan } from "./coach-preview";
import { ProgramDiff } from "./program-diff";
import { downloadProgram, downloadProgramInstructions, importValidationMessage, readProgramFile } from "./model";

type Preview = Awaited<ReturnType<ReturnType<typeof createTrainingStorage>["programs"]["previewImport"]>>;

export function OwnProgramImport({ onApplied }: Readonly<{ onApplied: () => void }>) {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<Preview>();
  const [newExercisesReviewed, setNewExercisesReviewed] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const previewRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (preview) previewRef.current?.focus(); }, [preview]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (cause) {
      setError(cause instanceof StorageConflictError ? cause.message
        : cause instanceof ZodError ? `Программа несовместима: ${importValidationMessage(cause)}`
          : cause instanceof Error && (cause.message.startsWith("Файл больше") || cause.message.startsWith("Не удалось прочитать UTF-8")) ? cause.message
            : "Не удалось выполнить действие. Файл сохранён для повтора; программа и история не изменены.");
    } finally { lock.current = false; setBusy(false); }
  }

  return <section className="panel stack" aria-label="Своя готовая программа">
    <h2>Своя готовая программа</h2>
    <p>Тренировки уже составлены? Попросите ИИ оформить ваш план в файл. Исходный запрос из приложения не нужен.</p>
    <p className="muted">Можно выбрать и прежний ответ ИИ с готовым планом: возьмём только программу. Его анализ и советы не будут приняты.</p>
    <Accordion title="Как подготовить файл"><p>Скачайте формат, приложите его в чат вместе со своим планом и попросите оформить программу без изменения упражнений и нагрузки.</p><Button className="secondary" disabled={busy} onClick={() => void run(async () => { const storage = createTrainingStorage(); try { await storage.open(); const versions = await storage.programs.list(); downloadProgramInstructions(mergeExerciseCatalog(versions.flatMap(programDefinitions))); } finally { storage.close(); } setNotice("Скачивание формата запрошено. Приложите файл в чат с ИИ вместе со своей программой."); })}>Скачать формат для ИИ</Button><p className="muted">Формат содержит схему и каталог упражнений, без ваших личных данных. Это не запрос на новую программу.</p></Accordion>
    <label className="coach-file">Файл готовой программы<input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => {
      const selected = event.currentTarget.files?.[0]; event.currentTarget.value = "";
      if (!selected) return;
      setFile(selected); setPreview(undefined); setReviewed(false); setNewExercisesReviewed(false); setError(""); setNotice("");
    }} /></label>
    {file && <p className="coach-selected-file" role="status">Файл выбран: <strong>{file.name}</strong> · {new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(file.size / 1024)} КБ</p>}
    <Button className="primary" disabled={!file || busy} onClick={() => void run(async () => {
      if (!file) return;
      setPreview(undefined); setReviewed(false); setNewExercisesReviewed(false);
      const parsed = await readProgramFile(file);
      const storage = createTrainingStorage();
      try { await storage.open(); setPreview(await storage.programs.previewImport(parsed)); setReviewed(false); setNewExercisesReviewed(false); }
      finally { storage.close(); }
    })}>{busy ? "Проверяем…" : "Посмотреть свою программу"}</Button>
    <p ref={errorRef} role="alert" tabIndex={-1}>{error}</p><p role="status">{notice}</p>
    {preview && <section ref={previewRef} tabIndex={-1} className="stack" aria-label="Предпросмотр своей программы">
      <p className="badge">Ещё не применено</p>
      {preview.before && <Accordion title="Отличия от текущей программы"><ProgramDiff before={programToDraft(preview.before)} after={preview.file.program} /></Accordion>}
      <ProgramPlan program={preview.file.program} />
      {preview.newExercises.length > 0 && <section className="stack"><h3>Новые упражнения ({preview.newExercises.length})</h3><ul>{preview.newExercises.map((e) => <li key={e.id}>{e.name}<ExerciseDefinitionDetails exercise={e} /></li>)}</ul><label className="profile-choice"><input type="checkbox" checked={newExercisesReviewed} disabled={busy} onChange={(event) => setNewExercisesReviewed(event.target.checked)} /><span>Подтверждаю добавление этих упражнений с показанным оборудованием и способом учёта веса.</span></label></section>}
      <p className="muted">Проверены формат и оборудование, но не безопасность нагрузки. Принятие создаст новую версию и начнёт последовательность с первого дня. История сохранится.</p>
      <label className="profile-choice"><input type="checkbox" checked={reviewed} disabled={busy} onChange={(event) => setReviewed(event.target.checked)} /><span>Я просмотрел(а) все дни и отличия, подтверждаю упражнения и нагрузку с учётом своих ограничений.</span></label>
      <Button className="primary" disabled={busy || !reviewed || (preview.newExercises.length > 0 && !newExercisesReviewed)} onClick={() => void run(async () => {
        const storage = createTrainingStorage();
        try {
          await storage.open();
          await storage.programs.applyImport({ file: preview.file, expectedToken: preview.token, createdAt: new Date().toISOString(), reviewAcknowledged: reviewed, newExercisesAcknowledged: newExercisesReviewed });
          setPreview(undefined); setFile(undefined); setReviewed(false); setNewExercisesReviewed(false); onApplied();
          setNotice("Ваша программа принята. История сохранена; следующее занятие — первый день нового плана.");
        } finally { storage.close(); }
      })}>Принять свою программу</Button>
      <Button className="quiet" disabled={busy} onClick={() => { setPreview(undefined); setReviewed(false); setNewExercisesReviewed(false); }}>Отменить просмотр</Button>
    </section>}
    <Button className="secondary" disabled={busy} onClick={() => void run(async () => { const storage = createTrainingStorage(); try { await storage.open(); const active = await storage.programs.active(); if (!active) { setNotice("Пока нет принятой программы для экспорта."); return; } downloadProgram(active.program); setNotice("Скачивание полной программы запрошено."); } finally { storage.close(); } })}>Скачать действующую программу</Button>
    <Link className="quiet" href="/workout/">К тренировке →</Link>
  </section>;
}
