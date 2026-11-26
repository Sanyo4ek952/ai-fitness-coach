"use client";

import { useState } from "react";
import { programToDraft, type ProgramVersion } from "@/entities/training";
import { Accordion, Button } from "@/shared/ui";
import { ProgramDiff } from "./program-diff";
import { ProgramPlan } from "./coach-preview";

type Selection = Readonly<{ source: ProgramVersion; current: ProgramVersion; token: string }>;
export function ProgramVersions({ versions, current, token, busy, onApply }: Readonly<{
  versions: readonly ProgramVersion[]; current: ProgramVersion; token?: string; busy: boolean;
  onApply: (sourceId: string, expectedToken: string) => Promise<boolean>;
}>) {
  const [selection, setSelection] = useState<Selection>();
  const [reviewed, setReviewed] = useState(false);
  const stale = selection !== undefined && selection.token !== token;
  return <section className="panel stack" aria-label="Версии программы"><h2>Версии программы</h2>
    <p>Текущая: №{current.revision} · {current.title}. Возврат создаёт новую версию с прежним планом. История сохранится; следующее занятие будет первым в выбранной последовательности.</p>
    <Accordion title="Выбрать прежний план"><ul>{versions.filter((version) => version.revision < current.revision).map((version) => <li key={version.id}>
      <p>№{version.revision} · {version.title} · {new Date(version.createdAt).toLocaleString("ru-RU")}</p>
      <Button className="secondary" disabled={busy || !token} onClick={() => {
        if (token) { setSelection({ source: version, current, token }); setReviewed(false); }
      }}>Посмотреть возврат к версии №{version.revision}</Button>
    </li>)}</ul>{versions.filter((version) => version.revision < current.revision).length === 0 && <p>Прежних версий пока нет.</p>}</Accordion>
    {selection && <>
      <h3>Возврат к плану №{selection.source.revision}</h3>
      <ProgramDiff before={programToDraft(selection.current)} after={programToDraft(selection.source)} />
      <Accordion title="Весь прежний план"><ProgramPlan program={programToDraft(selection.source)} /></Accordion>
      {selection.source.notes && <p>Заметки версии: {selection.source.notes}</p>}
      <p>Интерпретация цели: {selection.source.goalInterpretation}. Первое занятие: {selection.source.workouts[0].title}.</p>
      <p>Прежние ограничения и оборудование могли измениться. Оцените план целиком по отличиям, включая нагрузку и заметки. Советы ИИ из старого пакета повторно не принимаются.</p>
      {stale && <p role="alert">Контекст изменился. Выберите прежний план заново.</p>}
      <label className="profile-choice"><input type="checkbox" checked={reviewed} disabled={busy || stale} onChange={(event) => setReviewed(event.target.checked)} /><span>Я просмотрел(а) отличия и подтверждаю весь прежний план с учётом текущей цели, оборудования и ограничений.</span></label>
      <Button className="primary" disabled={busy || stale || !reviewed} onClick={() => {
        void onApply(selection.source.id, selection.token).then((success) => { if (success) { setSelection(undefined); setReviewed(false); } });
      }}>Создать новую версию с этим планом</Button>
      <Button className="quiet" disabled={busy} onClick={() => { setSelection(undefined); setReviewed(false); }}>Отменить возврат</Button>
    </>}
  </section>;
}
