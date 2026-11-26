"use client";

import Link from "next/link";
import { Accordion, Button, Input, Select, Textarea } from "@/shared/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePrototype } from "./context";
import { WorkoutOverview } from "./workout-overview";

function Panel({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Смена шага должна быть заметна и при работе с клавиатурой/диктором.
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [title]);
  return <section className="panel"><h2 ref={heading} tabIndex={-1}>{title}</h2>{children}</section>;
}

function Notice() {
  const { state } = usePrototype();
  return <p className="notice" role="status">{state.notice}</p>;
}

export function ProfilePrototype() {
  const { state, dispatch } = usePrototype();
  const [resetting, setResetting] = useState(false);
  const [profileError, setProfileError] = useState("");
  return <>
    <p className="eyebrow">01 / Начнём с вас</p><h1>Профиль</h1>
    <p className="intro">Одна цель. Свой темп.</p>
    <p className="muted">Поля уже заполнены примером. Дополнительные сведения можно пропустить.</p>
    <form key={state.profile ? "saved" : "new"} className="panel stack" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const text = (name: string) => String(data.get(name) ?? "").trim();
      if (!text("goal")) { setProfileError("Введите цель или оставьте готовый пример."); return; }
      setProfileError("");
      dispatch({ type: "profile", profile: { goal: text("goal"), experience: text("experience"), frequency: text("frequency"), equipment: text("equipment") } });
    }}>
      <label>Моя цель<Textarea name="goal" required maxLength={500} defaultValue={state.profile?.goal ?? "Стать сильнее и увереннее в зале"} /></label>
      <label>Опыт<Select name="experience" label="Опыт" defaultValue={state.profile?.experience ?? "Начинаю"} options={["Начинаю", "Тренируюсь регулярно", "Опытный", "Не знаю"]} /></label>
      <div className="field-pair"><label>Занятий в неделю<Select name="frequency" label="Занятий в неделю" defaultValue={state.profile?.frequency ?? "3"} options={["1", "2", "3", "4", "5", "6", "7", "Не знаю"]} /></label>
      <label>Оборудование<Select name="equipment" label="Оборудование" defaultValue={state.profile?.equipment ?? "Тренажёры и гантели"} options={["Тренажёры и гантели", "Не знаю"]} /></label></div>
      <Accordion title="Дополнительные сведения · по желанию"><p className="muted">В продукте здесь будут возраст, замеры, ограничения и другие добровольные сведения. Для этого прототипа ничего вводить не нужно. Фото не запрашиваются.</p></Accordion>
      <p role="alert">{profileError}</p>
      <Button className={state.profile ? "secondary" : "primary"} type="submit">{state.profile ? "Сохранить изменения" : "Сохранить демопрофиль"}</Button>
    </form>
    <Notice />
    {state.profile && <Link className="primary" href="/coach">Перейти к импорту →</Link>}
    <Accordion className="panel" title="О демоданных и приватности"><p>Все числа — синтетические примеры для оценки интерфейса. Это не тренировочная рекомендация. Ничего не отправляется наружу и не сохраняется после перезагрузки.</p>
      {resetting ? <><p>Сбросить профиль, программу и результаты этого просмотра?</p><div className="stack"><Button className="secondary" onClick={() => { dispatch({ type: "reset" }); setProfileError(""); setResetting(false); }}>Да, сбросить демо</Button><Button className="quiet" onClick={() => setResetting(false)}>Отмена</Button></div></> : <Button className="quiet" onClick={() => setResetting(true)}>Начать демо заново</Button>}
    </Accordion>
  </>;
}

export function CoachPrototype() {
  const { state, dispatch } = usePrototype();
  return <>
    <p className="eyebrow">02 / Программа под вашим контролем</p><h1>Тренер</h1>
    <p className="intro">Сначала посмотрите.<br />Потом решите.</p>
    <Notice />
    {!state.profile ? <Panel title="Синтетическое демо"><p>Реальный профиль хранится отдельно и сюда не передаётся. Импорт и тренировки пока можно проверить на готовом примере.</p><Button className="primary" onClick={() => dispatch({ type: "profile", profile: { goal: "Демоцель: стать сильнее", experience: "Не знаю", frequency: "Не знаю", equipment: "Не знаю" } })}>Открыть синтетическое демо</Button></Panel> : state.proposal ?
      <Panel title={state.proposal === "initial" ? "Предпросмотр программы" : "Предлагается изменить отдых"}>
        <p className="badge">Только предложение · ещё не применено</p>
        <p><strong>Цель:</strong> {state.profile.goal}</p><p>Интерпретация примера: освоить регулярные силовые занятия в зале.</p>
        {state.proposal === "initial" ? <><h3>Два занятия по очереди</h3><ol className="sequence"><li><strong>А · Всё тело</strong><span>Жим ногами в тренажёре · 2 × 10</span><span>Тяга верхнего блока к груди · 2 × 10</span></li><li><strong>Б · Всё тело</strong><span>Жим гантелей сидя · 2 × 10</span><span>Горизонтальная тяга блока · 2 × 10</span></li></ol><p>Вес неизвестен: подобрать самостоятельно. Отдых — 90 секунд, RIR — по желанию. Частота из профиля — ориентир, даты не обязательны.</p><p className="muted">В демотренировке покажем один подход первого упражнения.</p></> : <><div className="comparison"><p><span className="muted">Было · версия 1</span><strong>Отдых 90 секунд</strong></p><span aria-hidden="true">↓</span><p><span className="muted">Станет · версия 2</span><strong>Отдых 120 секунд</strong></p></div><p><strong>Причина примера:</strong> больше времени на восстановление между подходами жима ногами.</p><p>Остальные упражнения, порядок, подходы, повторы и неизвестный вес — без изменений. Это демонстрация сравнения, а не анализ одного результата.</p><p>После применения следующее занятие — А. История версии 1 останется прежней.</p></>}
        <Accordion title="Весь пакет и влияние"><p>А: жим ногами и тяга верхнего блока. Б: жим гантелей сидя и горизонтальная тяга. По 2 подхода × 10 повторений, вес неизвестен. Отдых 90 секунд{state.proposal === "update" ? ", кроме жима ногами: 120 секунд" : ""}. Пример не содержит питания, фото или замеров.</p></Accordion>
        <div className="stack actions"><Button className="primary" onClick={() => dispatch({ type: "accept" })}>{state.proposal === "initial" ? "Подтвердить программу" : "Применить весь пакет"}</Button><Button className="secondary" onClick={() => dispatch({ type: "reject" })}>{state.version ? "Оставить текущую" : "Отклонить пример"}</Button></div>
      </Panel> : <>
        <Panel title={state.version ? `Активна версия ${state.version}` : "Импорт ответа"}>
          <p>В продукте вы скачаете запрос, передадите его выбранному ИИ и импортируете ответ. Здесь этот обмен заменён готовым синтетическим примером.</p>
          <p className="muted">Реальные файлы не принимаются. Внешний ИИ не подключён.</p>
          {state.session === "active" ? <><p>Завершите занятие перед просмотром обновления.</p><Link className="primary" href="/workout">Продолжить тренировку →</Link></> : state.version < 2 ? <Button className="primary" onClick={() => dispatch({ type: "preview" })}>{state.version ? "Посмотреть пример обновления" : "Импортировать демопример"}</Button> : <p>Обновление подтверждено. История доступна в «Прогрессе».</p>}
        </Panel>
        {state.version > 0 && <Link className="secondary" href="/workout">К тренировке →</Link>}
    </>}
    <Accordion className="panel" title="О демоданных"><p>Программа и результаты здесь синтетические и сбрасываются при перезагрузке. Реальный профиль не меняется.</p><Button className="quiet" onClick={() => dispatch({ type: "reset" })}>Начать демо заново</Button></Accordion>
  </>;
}

function SetForm() {
  const { state, dispatch } = usePrototype();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  if (state.result && !editing) return <Panel title="Подход записан"><p className="result">{state.result.weight} кг × {state.result.reps}</p><p>Факт · RIR: {state.result.rir}</p><div className="stack"><Button className="secondary" onClick={() => setEditing(true)}>Исправить подход</Button><p className="muted">Остальные подходы и упражнения не выполнены. Завершение отметит занятие неполным.</p><Button className="primary" onClick={() => dispatch({ type: "finish" })}>Завершить неполную тренировку</Button></div></Panel>;
  return <Panel title={editing ? "Исправить факт" : "Первый подход"}>
    <p className="muted">План: 10 повторений · вес подобрать. Числа станут фактом только после нажатия кнопки.</p>
    <form className="stack" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const weightText = String(data.get("weight") ?? "").trim().replace(",", ".");
      const weight = Number(weightText);
      const reps = Number(data.get("reps"));
      if (!weightText || !Number.isFinite(weight) || weight < 0 || weight > 1000 || !Number.isInteger(reps) || reps < 1 || reps > 100) { setError("Укажите вес от 0 до 1000 кг и целое число повторений от 1 до 100."); return; }
      dispatch({ type: "log", result: { weight, reps, rir: String(data.get("rir") ?? "Не знаю") } });
      setEditing(false); setError("");
    }}>
      <div className="field-pair"><label>Факт, кг<Input name="weight" inputMode="decimal" required placeholder="Укажите вес" defaultValue={state.result?.weight} aria-describedby="set-help set-error" /></label><label>Повторения<Input name="reps" type="number" inputMode="numeric" min={1} max={100} required defaultValue={state.result?.reps ?? 10} /></label></div>
      <p id="set-help" className="muted">Вес не известен заранее. Введите любое демонстрационное значение.</p>
      <Accordion title="Запас повторений (RIR) · необязательно"><p>Сколько повторений ещё могли бы сделать с той же техникой? Если не уверены, оставьте «Не знаю».</p><label>RIR<Select name="rir" label="RIR" defaultValue={state.result?.rir ?? "Не знаю"} options={["Не знаю", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]} /></label></Accordion>
      <p id="set-error" role="alert">{error}</p><Button className="primary" type="submit">{editing ? "Сохранить исправление" : "Записать подход"}</Button>
      {editing && <Button className="quiet" type="button" onClick={() => { setEditing(false); setError(""); }}>Отмена исправления</Button>}
    </form>
  </Panel>;
}

export function WorkoutPrototype() {
  const { state, dispatch } = usePrototype();
  return <>
    <h1>Тренировка</h1><p className="intro">Ваш следующий шаг</p>{state.session !== "idle" && <Notice />}
    {!state.version ? <><p className="intro">Начните со своей цели.</p><Panel title="Программы пока нет"><p>Реальный профиль доступен в «Профиле». Программу и тренировку пока можно посмотреть на синтетическом примере.</p><Link className="primary" href="/coach">Посмотреть демопрограмму →</Link></Panel><p className="muted">Демо: импорт → подтверждение → занятие</p></> : state.session === "finished" ? <>
      <Panel title="Демозанятие завершено"><p className="eyebrow">А · Версия {state.sessionVersion} · Неполная тренировка</p><p className="result">1 подход</p><p>Жим ногами в тренажёре: {state.result?.weight} кг × {state.result?.reps}. Остальные подходы и упражнения не выполнены.</p><p>Следующее по очереди: <strong>{state.version !== state.sessionVersion ? "А · Всё тело" : "Б · Всё тело"}</strong>. Дата — на ваш выбор.</p><Link className="primary" href="/coach">Посмотреть обновление →</Link><Link className="quiet" href="/progress">Посмотреть результат</Link></Panel><p className="muted">Сценарий занятия в прототипе заканчивается здесь. Для повторения сбросьте демо в профиле.</p>
    </> : state.session === "active" ? <>
      <p className="eyebrow">А · Всё тело / демоподход</p><h2 className="exercise-title">Жим ногами в тренажёре</h2><SetForm />
      <p className="muted">Можно перейти в другой раздел и продолжить. В демоверсии таймер отдыха, замены и пропуски недоступны.</p>
    </> : <WorkoutOverview version={state.version} onStart={() => dispatch({ type: "start" })} />}
  </>;
}

export function ProgressPrototype() {
  const { state } = usePrototype();
  return <><p className="eyebrow">Маленькие шаги складываются</p><h1>Прогресс</h1><p className="intro">Здесь ваша история.</p>
    {state.result ? <Panel title={state.session === "finished" ? "А · Неполная тренировка" : "А · Занятие ещё идёт"}><p className="badge">Снимок программы · версия {state.sessionVersion}</p><h3>Жим ногами в тренажёре</h3><p className="result">{state.result.weight} кг × {state.result.reps}</p><p>1 записанный подход · RIR: {state.result.rir}</p><p className="muted">План: 10 повторений, вес неизвестен. Факт показан отдельно. Новая программа этот результат не меняет.</p><Link className="secondary" href="/workout">{state.session === "active" ? "Продолжить занятие" : "К итогу занятия"}</Link></Panel> : <Panel title="Первый результат впереди"><p>После записи подхода здесь появится факт. Пустые графики заполнять не нужно.</p><Link className="primary" href="/workout">К тренировке →</Link></Panel>}
    <Accordion className="panel" title="Замеры и фото · только по желанию"><p>Для начала они не нужны. В полной версии здесь можно будет управлять локальными фото и замерами. В этом прототипе файлы не принимаются.</p></Accordion></>;
}
