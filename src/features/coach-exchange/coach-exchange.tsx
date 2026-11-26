"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { importValidationMessage } from "./model";
import { ZodError } from "zod";
import { liveQuery } from "dexie";
import { createTrainingStorage, measurementKinds, measurementLabels, StorageConflictError, type CoachAcceptance, type CoachRequest, type CoachResponse, type ProgramVersion, type Profile } from "@/entities/training";
import { Accordion, Button } from "@/shared/ui";
import { copyRequest, downloadRequest, readCoachFile } from "./model";
import { CoachPreview } from "./coach-preview";
import { ProgramVersions } from "./program-versions";
import { NutritionTips } from "./nutrition-tips";
import { OwnProgramImport } from "./own-program-import";

export function CoachExchange({ children, preparation, preparedProfile, onEditPreparation }: Readonly<{
  children?: ReactNode; preparation?: ReactNode;
  preparedProfile?: Readonly<{ id: string; revision: number }>;
  onEditPreparation?: () => void;
}>) {
  const [currentProfile, setCurrentProfile] = useState<Profile>();
  const [selectedMeasurements, setSelectedMeasurements] = useState<readonly (typeof measurementKinds)[number][]>([]);
  const [request, setRequest] = useState<CoachRequest>();
  const [response, setResponse] = useState<CoachResponse>();
  const [selectedFile, setSelectedFile] = useState<File>();
  const [acceptance, setAcceptance] = useState<CoachAcceptance>();
  const [hasProgram, setHasProgram] = useState(false);
  const [currentProgram, setCurrentProgram] = useState<ProgramVersion>();
  const [versions, setVersions] = useState<readonly ProgramVersion[]>([]);
  const [analysisToken, setAnalysisToken] = useState<string>();
  const [contextReady, setContextReady] = useState(false);
  const [nutrition, setNutrition] = useState<Awaited<ReturnType<ReturnType<typeof createTrainingStorage>["coach"]["nutrition"]>>>();
  const [reviewed, setReviewed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const alert = useRef<HTMLDivElement>(null);
  const preparedSummary = useRef<HTMLElement>(null);
  const preview = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const storage = createTrainingStorage();
    void (async () => {
      try {
        await storage.open();
        const latest = await storage.coach.latestRequest();
        if (active) setRequest(latest);
        if (latest) {
          const accepted = await storage.coach.acceptance(latest.requestId);
          if (active) setAcceptance(accepted);
          if (!accepted) {
            const saved = await storage.coach.preview(latest.requestId);
            if (active) setResponse(saved);
          }
        }
      } catch (cause) { if (active) setError(message(cause)); }
      finally { storage.close(); if (active) setLoaded(true); }
    })();
    return () => { active = false; storage.close(); };
  }, []);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  useEffect(() => { if (response) preview.current?.focus(); }, [response]);
  useEffect(() => {
    let active = true;
    const storage = createTrainingStorage();
    let subscription: { unsubscribe(): void } | undefined;
    void storage.open().then(() => {
      if (!active) { storage.close(); return; }
      subscription = liveQuery(async () => ({ overview: await storage.analysis.overview(new Date().toISOString()),
        current: await storage.programs.active(), versions: await storage.programs.list(), nutrition: await storage.coach.nutrition(), profile: await storage.profiles.current() })).subscribe({
        next(value) { if (active) { setCurrentProfile(value.profile); setNutrition(value.nutrition); setAnalysisToken(value.overview?.token); setHasProgram(value.current !== undefined); setCurrentProgram(value.current?.program); setVersions(value.versions); setContextReady(true); } },
        error(cause: unknown) { if (active) { setNutrition(undefined); setContextReady(false); setAnalysisToken(undefined); setError(message(cause)); } },
      });
    }).catch((cause: unknown) => { if (active) setError(message(cause)); });
    return () => { active = false; subscription?.unsubscribe(); storage.close(); };
  }, []);

  const initialReady = !!currentProfile && preparedProfile?.id === currentProfile.id && preparedProfile.revision === currentProfile.revision;
  useEffect(() => { if (initialReady) preparedSummary.current?.focus(); }, [initialReady]);

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); return true; }
    catch (cause) { setError(message(cause)); return false; }
    finally { await new Promise((resolve) => setTimeout(resolve, 500)); lock.current = false; setBusy(false); }
  }

  async function exportRequest(copy: boolean) {
    const storage = createTrainingStorage();
    try {
      await storage.open();
      if (!hasProgram) {
        const profile = await storage.profiles.current();
        if (!profile || preparedProfile?.id !== profile.id || preparedProfile.revision !== profile.revision) {
          throw new StorageConflictError("Перед первым запросом проверьте и сохраните ответы в анкете. Профиль мог измениться в другой вкладке.");
        }
      }
      const requestId = crypto.randomUUID(); const now = new Date().toISOString();
      const saved = hasProgram
        ? await storage.coach.createReviewRequest(requestId, now, analysisToken ?? "", selectedMeasurements)
        : await storage.coach.createInitialRequest(requestId, now, selectedMeasurements);
      if (!hasProgram && saved.context.profileRevision !== preparedProfile?.revision) {
        throw new StorageConflictError("Профиль изменился во время подготовки запроса. Проверьте ответы ещё раз перед передачей ИИ.");
      }
      setRequest(saved); setResponse(undefined); setSelectedFile(undefined); setAcceptance(undefined); setReviewed(false);
      if (copy) {
        await copyRequest(saved, (value) => navigator.clipboard.writeText(value));
        setNotice("Запрос с инструкцией скопирован. Передайте его выбранному ИИ самостоятельно.");
      } else {
        downloadRequest(saved);
        setNotice("Запрос сохранён локально, скачивание запрошено у браузера. Проверьте папку загрузок.");
      }
    } finally { storage.close(); }
  }

  async function submitFile() {
    if (!selectedFile) return;
    const parsed = await readCoachFile(selectedFile);
    const storage = createTrainingStorage();
    try {
      await storage.open();
      const imported = await storage.coach.importResponse(parsed);
      const saved = await storage.coach.getRequest(imported.requestId);
      setRequest(saved); setResponse(imported); setSelectedFile(undefined); setAcceptance(undefined); setReviewed(false);
      setNotice("Ответ проверен и сохранён для просмотра. Программа не применена.");
    } finally { storage.close(); }
  }

  return <>
    <p className="eyebrow">Программа под вашим контролем</p><h1>Тренер</h1>
    <p className="intro">Сохранённая цель.<br />Осознанный выбор.</p>
    {children}
    <div ref={alert} tabIndex={-1} role="alert">{error}</div><p role="status" className="notice">{notice}</p>
    {!loaded && <p role="status">Загружаем локальный обмен…</p>}
    {loaded && contextReady && <OwnProgramImport onApplied={() => { setResponse(undefined); setSelectedFile(undefined); setReviewed(false); setAcceptance(undefined); }} />}
    {hasProgram && <section className="panel stack"><h2>Программа принята</h2><p>Последовательность сохранена на этом устройстве. Можно передать её с результатами для повторного анализа.</p><Link className="primary" href="/workout/">К следующему занятию →</Link>
      {acceptance && acceptance.programVersionId === currentProgram?.id && <Accordion title="Принятый пакет"><p>{acceptance.response.summary}</p><ul>{acceptance.response.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul></Accordion>}
    </section>}
    {contextReady && !hasProgram && !initialReady && <section className="stack" aria-label="Анкета перед первым планом">{preparation ?? <p><Link href="/profile/">Заполнить профиль для программы →</Link></p>}</section>}
    {contextReady && !hasProgram && initialReady && <section ref={preparedSummary} tabIndex={-1} className="panel stack"><h2>Ответы для первого плана сохранены</h2><p>Цель: {currentProfile?.goal}</p><p>В запрос войдут ваши сохранённые ответы. Пропущенные сведения останутся неизвестными: ИИ не должен их придумывать.</p><Button className="secondary" onClick={onEditPreparation} disabled={busy}>Дополнить ответы</Button></section>}
    {hasProgram && nutrition && <NutritionTips {...nutrition} />}
    {(hasProgram || initialReady) && <section className="panel stack"><h2>1. Передать запрос ИИ</h2>
      <p>В файл войдут сохранённые цель, опыт, частота, оборудование и заполненные добровольные сведения, согласие на питание, каталог упражнений, инструкция и схема ответа.</p>
      {hasProgram ? <><p>Повторный запрос включает активную программу, до 20 последних завершённых и частичных занятий всех версий: снимки плана, подходы, фактические веса, добровольный RIR, отметки боли, заметки и замены. Также входят причины анализа и агрегаты всей завершённой/частичной истории по фактическому упражнению и единице.</p><p>Агрегаты считают подходы, занятия и повторы/секунды/метры. Они не оценивают рост силы и не суммируют веса. Активные, брошенные и пропущенные занятия, фото и контакты не включаются.</p><p className="muted">Экспорт не снимает сигнал анализа. Импортируйте ответ ниже и подтвердите просмотренный пакет. Сначала завершите активное занятие.</p></> : <p>Это начальный запрос: программа и история пусты. Фото и контакты не включаются.</p>}
      <fieldset className="measurement-consent stack" disabled={busy}><legend>Замеры в этом экспорте — только по желанию</legend>
        <p>Выберите показатели, относящиеся к вашей цели. Войдут сохранённые замеры выбранных типов за последние 90 дней (кг/см и даты). Без выбора замеры не включаются. Внешний сервис увидит эти личные сведения, если вы передадите ему файл.</p>
        {measurementKinds.map((kind) => <label key={kind}><input type="checkbox" checked={selectedMeasurements.includes(kind)} onChange={(event) => setSelectedMeasurements((selected) => event.target.checked ? [...selected, kind] : selected.filter((item) => item !== kind))} />{measurementLabels[kind]}</label>)}
      </fieldset>
      <p className="muted">Приложение ничего не отправляет в сеть. Файл содержит личные сведения: передавайте его только выбранному вами сервису.</p>
      <Link className="quiet" href="/profile/">Посмотреть или изменить профиль →</Link>
      <Button className="primary" disabled={busy || !loaded || !contextReady || (hasProgram && !analysisToken)} onClick={() => void run(() => exportRequest(false))}>{hasProgram ? "Скачать запрос повторного анализа" : "Скачать запрос для ИИ"}</Button>
      <Button className="secondary" disabled={busy || !loaded || !contextReady || (hasProgram && !analysisToken)} onClick={() => void run(() => exportRequest(true))}>Скопировать запрос с инструкцией</Button>
      {request && <Accordion title="Сохранённый запрос"><p className="coach-id">{request.requestId}</p><p>Ревизия профиля: {request.context.profileRevision}. Создан: {new Date(request.createdAt).toLocaleString("ru-RU")}.</p><p>Замеров в сохранённом запросе: {request.measurements?.length ?? 0}. Фото отсутствуют.</p><p>Каждый новый экспорт создаёт отдельный запрос; ответы проверяются по своему сохранённому ID и текущим данным.</p></Accordion>}
    </section>}
    {!contextReady && loaded && error && <Button className="quiet" onClick={() => window.location.reload()}>Повторить чтение страницы</Button>}
    <section className="panel stack" aria-label="Загрузка ответа ИИ"><h2>2. Загрузить ответ ИИ</h2><p>Выберите UTF-8 JSON-файл из чата с ИИ размером до 2 MiB.</p>
      <label className="coach-file">Ответ ИИ<input type="file" accept=".json,application/json" disabled={busy || !loaded || !contextReady} onChange={(event) => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
        if (!file) return;
        setSelectedFile(file); setResponse(undefined); setReviewed(false); setError(""); setNotice("");
      }} /></label>
      {selectedFile && <div className="coach-selected-file stack" role="status"><strong>{selectedFile.name}</strong><span>Файл выбран · {new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(selectedFile.size / 1024)} КБ</span></div>}
      <Button className="primary" disabled={!selectedFile || busy || !loaded || !contextReady} onClick={() => void run(submitFile)}>Отправить</Button>
      <p className="muted">По кнопке проверим файл на этом устройстве и покажем предложение. Программа пока не изменится.</p>
      {busy && <p role="status">Выполняем действие…</p>}
      {response && <Button className="quiet" disabled={busy} onClick={() => { setResponse(undefined); setReviewed(false); setNotice("Предпросмотр закрыт. Программа не изменена."); }}>Закрыть предпросмотр</Button>}
    </section>
    {response && <><div ref={preview} tabIndex={-1} aria-label="Проверенный ответ ИИ"><CoachPreview response={response} before={request?.program} showNutrition={nutrition?.enabled === true} /></div><section className="panel stack" aria-label="Решение по пакету">
      {(response.decision === "propose_program" || response.decision === "keep") && <>
        <label className="profile-choice"><input type="checkbox" checked={reviewed} disabled={busy} onChange={(event) => setReviewed(event.target.checked)} /><span>Я просмотрел(а) весь пакет, подтверждаю добавление новых упражнений с показанными параметрами, оценил(а) нагрузку и свои ограничения. При сомнениях нужна оценка специалиста.</span></label>
        <Button className="primary" disabled={busy || !reviewed} onClick={() => void run(async () => {
          const storage = createTrainingStorage();
          try {
            await storage.open();
            const accepted = await storage.coach.accept(response, new Date().toISOString(), reviewed);
            setAcceptance(accepted); setHasProgram(true); setResponse(undefined); setReviewed(false);
            setNotice(response.decision === "keep" ? "Анализ принят. Программа и следующее занятие сохранены." : "Весь пакет принят и сохранён. Следующее занятие — первое в последовательности.");
          } finally { storage.close(); }
        })}>{response.decision === "keep" ? "Принять анализ и сохранить программу" : "Применить весь пакет"}</Button>
      </>}
      <Button className="secondary" disabled={busy} onClick={() => void run(async () => {
        const storage = createTrainingStorage();
        try { await storage.open(); await storage.coach.reject(response); setResponse(undefined); setReviewed(false); setNotice("Ответ отклонён. Программа и история не изменены."); }
        finally { storage.close(); }
      })}>Отклонить ответ</Button>
    </section></>}
    {currentProgram && <ProgramVersions versions={versions} current={currentProgram} token={analysisToken} busy={busy || !contextReady} onApply={async (sourceId, expectedToken) => {
      return await run(async () => {
        const storage = createTrainingStorage();
        try {
          await storage.open();
          await storage.programs.rollback({ sourceId, expectedToken, createdAt: new Date().toISOString(), reviewAcknowledged: true });
          setResponse(undefined); setAcceptance(undefined); setReviewed(false);
          setNotice("Прежний план сохранён новой версией. Следующее занятие — первое в последовательности. История сохранена.");
        } finally { storage.close(); }
      }) ?? false;
    }} />}
  </>;
}

function message(cause: unknown): string {
  if (cause instanceof StorageConflictError) return cause.message;
  if (cause instanceof ZodError) return `Ответ несовместим: ${importValidationMessage(cause)}. Программа не изменена.`;
  if (cause instanceof Error && (cause.message.startsWith("Файл больше") || cause.message.startsWith("Не удалось прочитать UTF-8"))) return cause.message;
  return "Действие не завершено. Проверьте локальное хранение, доступное место и разрешение буфера обмена; повторите. Скачивание можно использовать вместо копирования. Программа и история не изменены.";
}

