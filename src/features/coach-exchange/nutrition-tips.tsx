import Link from "next/link";

export function NutritionTips({ enabled, tips, acceptedAt }: Readonly<{ enabled: boolean; tips: readonly string[]; acceptedAt?: string }>) {
  return <section className="panel stack coach-preview" aria-label="Питание по желанию">
    <h2>Питание · по желанию</h2>
    {!enabled ? <p>Короткие советы отключены. Их можно включить в дополнительных сведениях профиля.</p>
      : tips.length > 0 ? <>
        <ul>{tips.map((tip, index) => <li key={index}>{tip}</li>)}</ul>
        {acceptedAt && <p className="muted">Из принятого анализа от {new Date(acceptedAt).toLocaleDateString("ru-RU")}.</p>}
      </> : <p>Принятых советов для текущего профиля нет. При следующем обмене ИИ может предложить до трёх коротких пунктов по вашей цели. Пустой список допустим.</p>}
    <p className="muted">Без дневника калорий и медицинских назначений. Советы ИИ требуют вашей оценки.</p>
    <Link className="quiet" href="/profile/">Настроить согласие в профиле →</Link>
  </section>;
}
