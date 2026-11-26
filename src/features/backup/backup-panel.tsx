"use client";

import { useEffect, useRef, useState } from "react";
import { createTrainingStorage, readBackupFile, type TrainingStorage } from "@/entities/training";
import { Button } from "@/shared/ui";
import { downloadBackup } from "./download";

type Preview = Awaited<ReturnType<TrainingStorage["backup"]["preview"]>>;
export function BackupPanel() {
  const [photos, setPhotos] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  useEffect(() => { if (preview) panel.current?.focus(); }, [preview]);

  async function run(action: (storage: TrainingStorage) => Promise<void>) {
    if (lock.current || restored) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const storage = createTrainingStorage();
    try { await storage.open(); await action(storage); }
    catch (cause) {
      setError(cause instanceof Error && cause.name === "Error" ? cause.message
        : "Не удалось обработать копию. Проверьте формат, версию, свободное место и разрешение локального хранения. Текущие данные не заменены.");
    } finally { storage.close(); lock.current = false; setBusy(false); }
  }

  return <section className="panel stack" aria-labelledby="backup-title">
    <h2 id="backup-title">Резервная копия</h2>
    <p>Браузер может удалить локальные данные. Сохраняйте копию в надёжном месте и проверяйте её восстановление.</p>
    <p>Файл содержит профиль и все его ревизии, программы, историю, замеры, заметки и старые пакеты ИИ с добровольными сведениями. Он не зашифрован. Приложение никуда его не отправляет.</p>
    <label className="profile-choice"><input type="checkbox" checked={photos} disabled={busy || restored} onChange={(e) => setPhotos(e.target.checked)} /> Включить все локальные фото в копию</label>
    <div className="stack"><Button disabled={busy || restored} onClick={() => void run(async (s) => {
      downloadBackup(await s.backup.export(photos)); setNotice("Скачивание запрошено. Проверьте файл в папке загрузок.");
    })}>Скачать резервную копию</Button></div>
    <p>Восстановление полностью заменит текущие данные, программу и историю. Фото заменяются тоже: копия без фото удалит текущие снимки. Объединения нет. Сначала скачайте текущую копию; завершите активное занятие и закройте другие вкладки приложения.</p>
    <input ref={input} type="file" accept=".json,application/json" hidden disabled={busy || restored} onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = "";
      setPreview(undefined); setConfirmed(false);
      if (file) void run(async (s) => { setPreview(await s.backup.preview(await readBackupFile(file))); });
    }} />
    <Button variant="soft" disabled={busy || restored} onClick={() => input.current?.click()}>Выбрать копию для восстановления</Button>
    {preview && !restored && <div ref={panel} tabIndex={-1} className="panel" aria-labelledby="restore-title">
      <h3 id="restore-title">Проверенная копия</h3>
      <p>Создана: {new Date(preview.backup.createdAt).toLocaleString("ru-RU")}. Формат 1.</p>
      <p>Текущие данные → в копии:</p>
      <ul>
        <li>Ревизии профиля: {preview.current.profiles} → {preview.backup.data.profileRevisions.length}</li>
        <li>Версии программы: {preview.current.versions} → {preview.backup.data.programVersions.length}</li>
        <li>Занятия: {preview.current.sessions} → {preview.backup.data.sessions.length}</li>
        <li>Замеры: {preview.current.measurements} → {preview.backup.data.bodyMeasurements.length}</li>
        <li>Фото: {preview.current.photos} → {preview.backup.data.progressPhotos.length} ({preview.backup.photosIncluded ? "включены" : "не включены"})</li>
      </ul>
      <p>Цель в копии: {preview.backup.data.profileRevisions.at(-1)?.payload.goal ?? "нет профиля"}.</p>
      <p>Активное занятие в копии: {preview.backup.data.sessions.some((r) => r.status === "active") ? "будет восстановлено вместе с фактами и таймером" : "нет"}.</p>
      <label className="profile-choice"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} /> Подтверждаю полную замену программы, истории и фото данными этой копии</label>
      <div className="stack"><Button color="red" disabled={busy || !confirmed} onClick={() => void run(async (s) => {
        await s.backup.restore(preview.backup, preview.expectedToken, confirmed);
        setRestored(true); setPreview(undefined); setConfirmed(false); setNotice("Данные восстановлены. Перезагрузите страницу, чтобы продолжить с восстановленными данными.");
      })}>Заменить данные этой копией</Button>
        <Button variant="soft" disabled={busy} onClick={() => { setPreview(undefined); setConfirmed(false); }}>Отмена</Button></div>
    </div>}
    {error && <p role="alert" ref={alert} tabIndex={-1}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {restored && <Button onClick={() => window.location.reload()}>Перезагрузить страницу</Button>}
  </section>;
}
