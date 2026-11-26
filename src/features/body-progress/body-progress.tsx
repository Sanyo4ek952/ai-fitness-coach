"use client";

import { liveQuery } from "dexie";
import { useEffect, useRef, useState } from "react";
import { createTrainingStorage, measurementKinds, measurementKindSchema, measurementLabels, prepareProgressPhoto,
  type ProgressPhoto, type TrainingStorage } from "@/entities/training";
import { measurementDateInput, parseMeasurementDate } from "./measurement-date";
import { Button, Input } from "@/shared/ui";

type Overview = Awaited<ReturnType<TrainingStorage["body"]["overview"]>>;
type Confirmation = { kind: "measurement"; id: string; label: string } | { kind: "photos"; ids: string[] };
const date = (value: string) => new Date(value).toLocaleString("ru-RU");
const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumSignificantDigits: 15 }).format(value);

export function BodyProgress() {
  const [state, setState] = useState<{ value: Overview } | { error: true } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState(false);
  const [kind, setKind] = useState<(typeof measurementKinds)[number]>("weight");
  const [measuredAt, setMeasuredAt] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [pendingPhoto, setPendingPhoto] = useState<ProgressPhoto>();
  const confirmationPanel = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(12);
  const photoInput = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (confirmation) confirmationPanel.current?.focus(); }, [confirmation]);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  useEffect(() => {
    const storage = createTrainingStorage(); let disposed = false;
    let subscription: { unsubscribe(): void } | undefined;
    void storage.open().then(() => {
      if (disposed) { storage.close(); return; }
      subscription = liveQuery(() => storage.body.overview()).subscribe({
        next: (value) => { if (!disposed) setState({ value }); },
        error: () => { if (!disposed) setState({ error: true }); },
      });
    }).catch(() => { if (!disposed) setState({ error: true }); });
    return () => { disposed = true; subscription?.unsubscribe(); storage.close(); };
  }, [attempt]);

  async function run(action: (body: TrainingStorage["body"]) => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const storage = createTrainingStorage();
    try { await storage.open(); await action(storage.body); }
    catch (cause) { setError(cause instanceof DOMException ? "Браузер отказал в обработке или сохранении. Проверьте свободное место и разрешения; повторите действие." : cause instanceof Error && cause.name === "Error" ? `Не удалось выполнить действие: ${cause.message}. Проверьте данные и повторите.` : "Проверьте значение, дату и файл. Запись не сохранена."); }
    finally { storage.close(); lock.current = false; setBusy(false); }
  }

  return <section className="panel stack body-progress" aria-label="Добровольные замеры и фото">
    <details><summary>Замеры и фото — по желанию</summary><div className="stack">
      <p>Можно пользоваться приложением без этих данных. Они хранятся в этом браузере. Замеры сами по себе не оценивают здоровье или достижение цели.</p>
      <p className="muted">Браузер или очистка данных могут удалить записи. Локальная база не зашифрована приложением. Резервное копирование фото пока не доступно: сохраните оригиналы отдельно.</p>
      <p ref={alert} role="alert" tabIndex={-1}>{error}</p><p role="status">{notice}</p>
      {state === null ? <p role="status">Читаем замеры и фото…</p> : "error" in state
        ? <><p role="alert">Не удалось прочитать замеры и фото. Данные не изменены.</p><Button className="secondary" onClick={() => { setState(null); setAttempt((value) => value + 1); }}>Повторить чтение замеров и фото</Button></>
        : <>
          <h2>Замеры</h2>
          <p>Масса — в кг, окружности — в см. Выберите только нужный показатель. До 1000 записей; единицы и показатели хранятся отдельно.</p>
          {!form && <Button className="secondary" disabled={busy} onClick={() => { setMeasuredAt(measurementDateInput()); setForm(true); }}>Добавить замер</Button>}
          {form && <form className="stack" onSubmit={(event) => { event.preventDefault(); void run(async (body) => {
            const timestamp = parseMeasurementDate(measuredAt);
            if (!value.trim()) throw new Error("Укажите значение");
            await body.addMeasurement({ id: crypto.randomUUID(), kind, value: Number(value.replace(",", ".")), unit: kind === "weight" ? "kg" : "cm", measuredAt: timestamp });
            setValue(""); setForm(false); setNotice("Замер сохранён на этом устройстве.");
          }); }}>
            <label>Показатель<select value={kind} disabled={busy} onChange={(event) => setKind(measurementKindSchema.parse(event.target.value))}>{measurementKinds.map((item) => <option key={item} value={item}>{measurementLabels[item]}</option>)}</select></label>
            <label>Значение ({kind === "weight" ? "кг" : "см"})<Input inputMode="decimal" required value={value} disabled={busy} onChange={(event) => setValue(event.target.value)} /></label>
            <label>Дата замера (ДД.ММ.ГГГГ)<Input type="text" placeholder="ДД.ММ.ГГГГ" required value={measuredAt} disabled={busy} onChange={(event) => setMeasuredAt(event.target.value)} /></label>
            <Button type="submit" className="primary" disabled={busy}>Сохранить замер</Button>
            <Button className="quiet" disabled={busy} onClick={() => setForm(false)}>Отменить ввод</Button>
          </form>}
          {state.value.measurements.length > 0 && <><ul className="body-records">{state.value.measurements.slice(0, limit).map((item) => <li key={item.id} className="stack">
            <p>{measurementLabels[item.kind]}: <strong>{number(item.value)} {item.unit === "kg" ? "кг" : "см"}</strong> · {date(item.measuredAt)}</p>
            <Button className="quiet" disabled={busy} onClick={() => setConfirmation({ kind: "measurement", id: item.id, label: `${measurementLabels[item.kind]}: ${number(item.value)} ${item.unit === "kg" ? "кг" : "см"} · ${date(item.measuredAt)}` })}>Удалить замер «{measurementLabels[item.kind]}» от {date(item.measuredAt)}</Button>
          </li>)}</ul>{limit < state.value.measurements.length && <Button className="secondary" onClick={() => setLimit((value) => value + 12)}>Показать ещё замеры</Button>}</>}
          <h2>Локальные фото</h2>
          <p>Добавляйте по одному JPEG или PNG до 5 МиБ, до 4096 пикселей по стороне и 12 Мп. До 20 фото. Сохраняется новая JPEG-копия до 1600 пикселей и 2 МиБ без исходного имени и EXIF. Оригинал остаётся у вас.</p>
          <p>Одинаковые свет и ракурс могут облегчить сравнение. Съёмка и определённый ракурс необязательны. Приложение не распознаёт лица и не определяет процент жира.</p>
          <Button className="secondary" disabled={busy || !!pendingPhoto || state.value.photos.length >= 20} onClick={() => photoInput.current?.click()}>Добавить локальное фото</Button>
          <input ref={photoInput} hidden aria-label="Файл локального фото" type="file" accept="image/jpeg,image/png" disabled={busy || !!pendingPhoto || state.value.photos.length >= 20} onChange={(event) => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
            if (file) void run(async (body) => { const photo = await prepareProgressPhoto(file, crypto.randomUUID(), new Date().toISOString()); setPendingPhoto(photo); await body.addPhoto(photo); setPendingPhoto(undefined); setNotice("Очищенная копия фото сохранена локально."); });
          }} />
          {pendingPhoto && <div className="stack"><p>Подготовленная копия ещё не сохранена. Можно повторить сохранение или отменить.</p>
            <Button className="secondary" disabled={busy} onClick={() => void run(async (body) => { await body.addPhoto(pendingPhoto); setPendingPhoto(undefined); setNotice("Фото сохранено локально."); })}>Повторить сохранение фото</Button>
            <Button className="quiet" disabled={busy} onClick={() => setPendingPhoto(undefined)}>Отменить добавление фото</Button>
          </div>}
          {state.value.photos.length > 0 && <><ul className="body-records">{state.value.photos.map((photo) => <li key={photo.id}><Photo photo={photo} busy={busy} onDelete={() => setConfirmation({ kind: "photos", ids: [photo.id] })} /></li>)}</ul>
            <Button className="quiet" disabled={busy} onClick={() => setConfirmation({ kind: "photos", ids: state.value.photos.map((photo) => photo.id) })}>Удалить все показанные фото ({state.value.photos.length})</Button></>}
          <p className="muted">Фото никогда не входят в JSON для ИИ. Замеры передаются только при отдельном выборе показателей в «Тренере». Удаление здесь не удаляет старые AI-запросы и внешние копии: они могут содержать ранее выбранные замеры.</p>
        </>}
      {confirmation && <div ref={confirmationPanel} tabIndex={-1} className="panel stack" role="group" aria-label="Подтверждение удаления">
        <p>{confirmation.kind === "measurement" ? `Удалить замер «${confirmation.label}» с этого устройства?` : `Удалить выбранные локальные фото (${confirmation.ids.length})?`} Это действие нельзя отменить. Внешние копии и оригиналы останутся.</p>
        <Button className="secondary" disabled={busy} onClick={() => void run(async (body) => {
          if (confirmation.kind === "measurement") await body.deleteMeasurement(confirmation.id); else await body.deletePhotos(confirmation.ids);
          setConfirmation(undefined); setNotice("Удаление завершено.");
        })}>Подтвердить удаление</Button>
        <Button className="quiet" disabled={busy} onClick={() => setConfirmation(undefined)}>Отменить удаление</Button>
      </div>}
    </div></details>
  </section>;
}

function Photo({ photo, busy, onDelete }: Readonly<{ photo: ProgressPhoto; busy: boolean; onDelete(): void }>) {
  const [show, setShow] = useState(false);
  const [share, setShare] = useState(false);
  const [notice, setNotice] = useState("");
  return <div className="stack"><p>Фото от {date(photo.createdAt)}</p>
    <Button className="secondary" disabled={busy} onClick={() => setShow((value) => !value)}>{show ? "Скрыть фото" : "Посмотреть фото"}</Button>
    {show && <PhotoImage photo={photo} />}
    <Button className="quiet" disabled={busy} onClick={onDelete}>Удалить фото от {date(photo.createdAt)}</Button>
    <Button className="quiet" disabled={busy} onClick={() => setShare((value) => !value)}>Выбрать это фото для ИИ</Button>
    {share && <div className="stack"><p>Вы выбрали только этот снимок. Внешний ИИ получит чувствительное изображение, если вы сами приложите файл в его чат. Проверьте условия сервиса; EXIF удалён, но содержание фото остаётся личным. Приложение ничего не отправляет.</p>
      <Button className="secondary" onClick={() => {
        try { downloadPhoto(photo); setNotice("Скачивание копии запрошено. Проверьте загрузки и самостоятельно решите, передавать ли файл ИИ."); }
        catch { setNotice("Не удалось скачать копию. Повторите действие."); }
      }}>Понимаю, скачать копию выбранного фото</Button>
      <Button className="quiet" onClick={() => setShare(false)}>Отменить выбор фото для ИИ</Button></div>}
    <p role="status">{notice}</p>
  </div>;
}
function PhotoImage({ photo }: Readonly<{ photo: ProgressPhoto }>) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(photo.blob);
    if (image.current) image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [photo.blob]);
  // Local object URL with explicit dimensions, no optimizer/network request.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} className="progress-photo" width={photo.width} height={photo.height} alt={`Выбранное вами фото от ${date(photo.createdAt)}`} />;
}

function downloadPhoto(photo: ProgressPhoto) {
  const url = URL.createObjectURL(photo.blob);
  try { const link = document.createElement("a"); link.href = url; link.download = `progress-photo-${photo.id}.jpg`; link.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
