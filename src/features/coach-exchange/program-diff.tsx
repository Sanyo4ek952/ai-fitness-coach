import { diffPrograms, type ProgramDraft } from "@/entities/training";

export function ProgramDiff({ before, after }: Readonly<{ before: ProgramDraft; after: ProgramDraft }>) {
  const changes = diffPrograms(before, after);
  return <section className="stack" aria-label="Отличия программы">
    <h3>Отличия, вычисленные приложением</h3>
    <p>Сравнение по порядковым позициям: добавление, удаление или перестановка меняют соответствующие позиции. Названия не используются как идентификаторы.</p>
    {changes.length === 0 ? <p>Параметры плана совпадают. Подтверждение предложения всё равно создаст новую версию.</p>
      : <ul>{changes.map((change) => <li key={change.path}><strong>{change.kind === "added" ? "Добавлено · " : change.kind === "removed" ? "Удалено · " : ""}{change.path}</strong><p>Было: {change.before}</p><p>Станет: {change.after}</p></li>)}</ul>}
  </section>;
}
