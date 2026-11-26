"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ZodError } from "zod";
import { createTrainingStorage, type Profile, type TrainingStorage } from "@/entities/training";
import { Accordion, Button, Input, Select, Textarea } from "@/shared/ui";
import { detailFields, detailTexts, equipmentOptions, experienceOptions, fieldLabels, mergeProfile, profileFromForm, saveProfileDraft, type EditableField } from "./model";

type Conflict = Readonly<{ base: Profile | undefined; draft: Profile; latest: Profile }>;
const detailPrompts = {
  availableWeights: "Какие веса и шаг нагрузки есть в зале? Если знаете, укажите привычные упражнения, рабочие веса и повторы, стаж и перерывы. Если нет — оставьте пустым.",
  constraints: "Есть ли травмы, боль, ограничения от врача или движения, которых нужно избегать? Какие упражнения неудобны или не нравятся? Если ограничений нет, можно так и написать.",
  sleep: "Сколько обычно спите, как восстанавливаетесь? Укажите, если есть сменный график, высокая нагрузка на работе или другие тренировки.",
  nutrition: "Есть ли особенности и ограничения питания, которые хотите учесть? Не указывайте то, чем не хотите делиться с внешним ИИ. Советы включаются отдельно ниже.",
} as const;

export function ProfileEditor({ onCreated, onSaved, preparation = false }: Readonly<{ onCreated?: () => void; onSaved?: (profile: Profile) => void; preparation?: boolean }> = {}) {
  const storage = useRef<TrainingStorage | null>(null);
  const busy = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [profile, setProfile] = useState<Profile>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [conflict, setConflict] = useState<Conflict>();
  const alert = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const connection = createTrainingStorage();
    storage.current = connection;
    void (async () => {
      try {
        await connection.open();
        if (!active) { connection.close(); return; }
        const current = await connection.profiles.current();
        if (active) { setProfile(current); setLoaded(true); setError(""); }
      } catch { if (active) setError("Не удалось открыть профиль. Данные не удалены. Разрешите локальное хранение и повторите."); }
    })();
    return () => { active = false; storage.current = null; connection.close(); };
  }, [attempt]);

  useEffect(() => { if (error || conflict) alert.current?.focus(); }, [error, conflict]);

  async function save(draft: Profile, base: Profile | undefined) {
    const connection = storage.current;
    if (!connection || busy.current) return;
    busy.current = true; setSaving(true); setError(""); setNotice("");
    try {
      const result = await saveProfileDraft(connection, draft);
      if (result.status === "conflict") setConflict({ base, draft, latest: result.latest });
      else { setProfile(result.profile); setConflict(undefined); setNotice("Профиль сохранён на этом устройстве."); if (!profile) onCreated?.(); onSaved?.(result.profile); }
    } catch {
      setError("Не удалось сохранить профиль или прочитать изменения другой вкладки. Черновик остаётся на экране. Проверьте доступное место и повторите сохранение.");
    } finally { busy.current = false; setSaving(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || conflict) return;
    setNotice("");
    try { void save(profileFromForm(new FormData(event.currentTarget), profile), profile); }
    catch (cause) {
      setError(cause instanceof ZodError ? "Проверьте цель (1–500 символов), выбранные значения и дополнительные сведения: числа должны быть в указанных пределах." : "Не удалось подготовить профиль. Черновик остаётся в форме.");
    }
  }

  return <>
    <p className="eyebrow">{preparation ? "До составления первого плана" : loaded && !profile ? "Первый шаг" : "Ваши настройки"}</p>
    {preparation ? <h2>Расскажите о себе для программы</h2> : <h1>{loaded && !profile ? "Давайте составим вашу программу" : "Профиль"}</h1>}
    <p className="intro">{preparation ? "Проверьте сохранённые ответы и дополните то, что знаете. Затем подготовим запрос к ИИ." : loaded && !profile ? "Расскажите о себе и своих тренировках." : "Одна цель. Свой темп."}</p>
    <p className="muted">Профиль хранится на этом устройстве. Дополнительные сведения можно пропустить.</p>
    {!loaded && !error && <p role="status">Загружаем профиль…</p>}
    <div ref={alert} tabIndex={-1} role="alert">{error || (conflict ? "Профиль изменён в другой вкладке. Выберите значения в блоке ниже. Черновик не потерян." : "")}</div>
    {!loaded && error && <Button className="secondary" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Повторить загрузку</Button>}
    {loaded && <form key={profile?.revision ?? 0} className="panel stack profile-form" onSubmit={submit} onChange={() => setNotice("")}>
      {(!profile || preparation) && <p>Заполните цель, опыт, частоту занятий и доступное оборудование. Возраст, рост, вес, время на тренировку, рабочие веса, ограничения, сон и питание помогут учесть ваш контекст. Всё дополнительное можно оставить пустым, а неизвестные значения — «Не знаю».</p>}
      <fieldset className="profile-fields stack" disabled={saving || !!conflict}>
        <legend className="sr-only">Основной профиль</legend>
        <label>Моя цель<Textarea name="goal" required maxLength={500} defaultValue={profile?.goal ?? ""} placeholder="Чего хотите достичь, что важнее всего и есть ли желаемый срок?" /></label>
        <label>Опыт<Select name="experience" label="Опыт" defaultValue={profile ? experienceOptions[profile.experience] : "Не знаю"} options={Object.values(experienceOptions)} /><span className="muted">Выберите текущий уровень. Стаж, перерыв и привычные упражнения можно описать ниже в доступных весах.</span></label>
        <label>Занятий в неделю<Select name="sessionsPerWeek" label="Занятий в неделю" defaultValue={profile?.sessionsPerWeek?.toString() ?? "Не знаю"} options={["Не знаю", "1", "2", "3", "4", "5", "6", "7"]} /><span className="muted">Сколько раз реально удобно тренироваться? Это ориентир, без обязательных дней.</span></label>
        <fieldset className="profile-fields"><legend>Оборудование</legend><p className="muted">Выберите доступное. Если не знаете, оставьте без отметок.</p>
          {Object.entries(equipmentOptions).map(([key, label]) => <label className="profile-choice" key={key}><input type="checkbox" name="equipment" value={key} defaultChecked={profile?.equipment.some((value) => value === key)} />{label}</label>)}
        </fieldset>
        <Accordion title="Дополнительные сведения · по желанию" defaultOpen={!profile || preparation}>
          <div className="stack"><p className="muted">Пустые поля означают «не знаю». Можно удалить ранее введённое значение.</p>
            {detailFields.map(([key, label, min, max]) => <label key={key}>{label}<Input name={key} type="number" min={min} max={max} step={key === "ageYears" || key === "sessionMinutes" ? 1 : "any"} defaultValue={profile?.details?.[key] ?? ""} /><span className="muted">{key === "weightKg" ? "Больше 0" : `От ${min}`} до {max}, необязательно</span></label>)}
            {detailTexts.map(([key, label, max]) => <label key={key}>{label}<Textarea name={key} maxLength={max} defaultValue={profile?.details?.[key] ?? ""} placeholder={detailPrompts[key]} /><span className="muted">{detailPrompts[key]}</span></label>)}
            <label className="profile-choice"><input type="checkbox" name="nutritionOptIn" defaultChecked={profile?.nutritionOptIn ?? false} />Хочу короткие советы по питанию</label>
            <p className="muted">До трёх коротких пунктов по вашей цели в ответе ИИ, без дневника калорий и медицинских назначений. После сохранения отказа советы скроются; прежние пакеты останутся в локальной истории. Изменённый профиль требует нового анализа для актуальных советов.</p>
          </div>
        </Accordion>
        {(!profile || preparation) && <p className="muted">Замеры окружностей и фото можно добавить позже в разделе «Прогресс». Они необязательны и не входят в обычный запрос к ИИ без отдельного выбора; фото никогда не входят в JSON.</p>}
        <Button className="primary" type="submit">{saving ? "Сохраняем…" : preparation ? "Сохранить ответы и перейти к запросу" : profile ? "Сохранить изменения" : "Сохранить и продолжить"}</Button>
      </fieldset>
    </form>}
    {conflict && <form key={`conflict-${conflict.latest.revision}`} className="panel stack profile-form" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const merge = mergeProfile(conflict.base, conflict.draft, conflict.latest);
      const choices = merge.conflicts.filter((key) => data.get(key) === "latest");
      void save(mergeProfile(conflict.base, conflict.draft, conflict.latest, choices).profile, conflict.latest);
    }}>
      <h2>Профиль изменён в другой вкладке</h2><p>Черновик сохранён на экране. Независимые изменения объединим. Для совпавших полей выберите значение перед записью новой ревизии.</p>
      {mergeProfile(conflict.base, conflict.draft, conflict.latest).conflicts.map((key: EditableField) => <fieldset className="profile-fields" key={key}><legend>{fieldLabels[key]}</legend>
        <label className="profile-choice"><input type="radio" name={key} value="draft" required disabled={saving} />Мой черновик: {displayValue(key, conflict.draft)}</label>
        <label className="profile-choice"><input type="radio" name={key} value="latest" required disabled={saving} />Из другой вкладки: {displayValue(key, conflict.latest)}</label>
      </fieldset>)}
      <Button type="submit" className="primary" disabled={saving}>{saving ? "Сохраняем…" : "Сохранить объединённый профиль"}</Button>
    </form>}
    <p role="status" className="notice">{saving ? "Сохраняем профиль…" : notice}</p>
    {profile && !preparation && <p><Link href="/coach/" className="quiet">Перейти к составлению программы →</Link></p>}
    <Accordion className="panel" title="О хранении и приватности"><p>Профиль не отправляется наружу автоматически. Предыдущие ревизии остаются локально; изменение цели не меняет программы и историю. Браузер может удалить локальные данные. Резервная копия и настройки хранения доступны в Профиле; состояние офлайн-загрузки — под экраном.</p><p>Запрос для ИИ создаётся отдельно в разделе «Тренер» по вашему действию.</p></Accordion>
  </>;
}

function displayValue(key: EditableField, profile: Profile): string {
  if (key === "experience") return experienceOptions[profile.experience];
  if (key === "equipment") return profile.equipment.map((item) => item === "unknown" ? "Не знаю" : equipmentOptions[item]).join(", ");
  if (key === "nutritionOptIn") return profile.nutritionOptIn ? "Да" : "Нет";
  if (key === "details") return [...detailFields, ...detailTexts].map(([field, label]) => `${label}: ${profile.details?.[field] ?? "не знаю"}`).join("; ");
  return String(profile[key] ?? "Не знаю");
}
