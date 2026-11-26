"use client";

import { useEffect, useRef, useState } from "react";
import { createTrainingStorage, type TrainingStorage } from "@/entities/training";
import { Button } from "@/shared/ui";
import { storagePersistence, type PersistenceStatus } from "./storage-persistence";

type Preview = Awaited<ReturnType<TrainingStorage["privacy"]["preview"]>>;
const labels: Readonly<Record<string, string>> = {
  profileRevisions: "Ревизии профиля", programVersions: "Версии программы", sessions: "Занятия, включая активное",
  counters: "Технические счётчики", coachRequests: "Запросы ИИ со снимками сведений", coachResponses: "Ответы ИИ",
  coachAcceptances: "Подтверждения ИИ", programState: "Курсор и состояние анализа", bodyMeasurements: "Замеры", progressPhotos: "Фото",
};
const statuses: Record<PersistenceStatus, string> = {
  unsupported: "Браузер не поддерживает запрос защиты хранения.",
  persistent: "Браузер сообщил, что постоянное хранение разрешено.",
  "best-effort": "Постоянное хранение не разрешено. Данные хранятся в обычном режиме и могут быть удалены браузером.",
};

export function PrivacyPanel() {
  const [status, setStatus] = useState<PersistenceStatus>();
  const [storageError, setStorageError] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erased, setErased] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const persistenceLock = useRef(false);
  const persistenceSequence = useRef(0);
  const alert = useRef<HTMLParagraphElement>(null);
  const storageAlert = useRef<HTMLParagraphElement>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  useEffect(() => { if (storageError) storageAlert.current?.focus(); }, [storageError]);
  useEffect(() => { if (preview) confirmation.current?.focus(); }, [preview]);
  useEffect(() => {
    let disposed = false;
    const sequence = ++persistenceSequence.current;
    void storagePersistence(navigator.storage).then((value) => { if (!disposed && sequence === persistenceSequence.current) setStatus(value); })
      .catch(() => { if (!disposed && sequence === persistenceSequence.current) setStorageError("Не удалось проверить режим хранения. Повторите проверку."); });
    return () => { disposed = true; };
  }, []);

  async function persistence(request: boolean) {
    if (persistenceLock.current) return;
    ++persistenceSequence.current;
    persistenceLock.current = true; setRequesting(true); setStorageError("");
    try { setStatus(await storagePersistence(navigator.storage, request)); }
    catch { setStorageError("Браузер не смог проверить или изменить режим хранения. Данные не удалены. Повторите проверку."); }
    finally { persistenceLock.current = false; setRequesting(false); }
  }
  async function run(action: (storage: TrainingStorage) => Promise<void>) {
    if (lock.current || erased) return;
    lock.current = true; setBusy(true); setError("");
    const storage = createTrainingStorage();
    try { await storage.open(); await action(storage); }
    catch (cause) {
      setError(cause instanceof Error && cause.name === "Error" ? cause.message
        : "Не удалось удалить данные или прочитать их состав. Удаление не завершено, прежние данные сохранены. Проверьте доступ к локальному хранилищу и повторите.");
    } finally { storage.close(); lock.current = false; setBusy(false); }
  }
  return <section className="panel stack privacy-panel" aria-labelledby="privacy-title">
    <h2 id="privacy-title">Приватность и хранение</h2>
    <p>Данные хранятся в этом браузере без регистрации и шифрования приложением. Доступ зависит от защиты устройства. Скрытой отправки и трекеров нет. Передача запроса или выбранного фото внешнему ИИ — ваше отдельное действие.</p>
    <p>Сохранённые запросы, ответы, подтверждения и старые ревизии могут содержать прежние добровольные сведения даже после изменения профиля или удаления замера.</p>
    <p role="status">{storageError ? "Режим хранения не проверен." : status ? statuses[status] : "Проверяем режим хранения…"}</p>
    <p>Защита хранения не заменяет резервную копию и не гарантирует сохранность: очистка сайта, приватный режим, потеря устройства или действия пользователя могут удалить данные.</p>
    <div className="stack">
      <Button variant="soft" disabled={requesting || status === "unsupported" || status === "persistent"} onClick={() => void persistence(true)}>Запросить защиту хранения</Button>
      <Button variant="soft" disabled={requesting} onClick={() => void persistence(false)}>Повторить проверку хранения</Button>
    </div>
    {storageError && <p role="alert" ref={storageAlert} tabIndex={-1}>{storageError}</p>}
    <h3>Удалить все данные этого браузера</h3>
    <p>Будут удалены профиль со всеми ревизиями, программы, история, активное занятие с таймером, замеры, фото и все сохранённые пакеты ИИ. Восстановление возможно только из вашей внешней резервной копии.</p>
    <p>Скачанные файлы, оригиналы фото, копии в других браузерах и данные во внешних чатах останутся — удалите их отдельно. Старая резервная копия может вернуть удалённые сведения. Закройте остальные вкладки, особенно со старой версией приложения. Оболочка для офлайн останется, она не содержит ваших записей.</p>
    {!preview && !erased && <Button ref={trigger} color="red" variant="soft" disabled={busy} onClick={() => void run(async (s) => { setConfirmed(false); setPreview(await s.privacy.preview()); })}>Проверить состав перед удалением</Button>}
    {preview && !erased && <div ref={confirmation} tabIndex={-1} className="panel stack" aria-labelledby="erase-title">
      <h3 id="erase-title">Подтверждение полного удаления</h3>
      <ul>{preview.counts.map(({ name, count }) => <li key={name}>{labels[name] ?? name}: {count}</li>)}</ul>
      <p>Активное занятие тоже будет потеряно. Отмена сохранит данные. После удаления потребуется перезагрузка, несохранённый ввод пропадёт.</p>
      <label className="profile-choice"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} /> Подтверждаю удаление всех локальных данных, включая историю и фото</label>
      <Button color="red" disabled={!confirmed || busy} onClick={() => void run(async (s) => {
        await s.privacy.erase(preview.expectedToken, confirmed); setErased(true); setPreview(undefined); setConfirmed(false);
      })}>Удалить все локальные данные</Button>
      <Button variant="soft" disabled={busy} onClick={() => { setPreview(undefined); setConfirmed(false); setError(""); requestAnimationFrame(() => trigger.current?.focus()); }}>Отмена</Button>
    </div>}
    {error && <p ref={alert} role="alert" tabIndex={-1}>{error}</p>}
    {erased && <p role="status">Локальные данные удалены. Внешние копии остались. Перезагрузите страницу перед продолжением.</p>}
    {erased && <Button onClick={() => window.location.reload()}>Перезагрузить страницу</Button>}
  </section>;
}
