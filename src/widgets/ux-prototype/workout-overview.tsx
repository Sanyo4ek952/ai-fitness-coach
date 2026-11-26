import { Accordion, Button, ExerciseIllustration } from "@/shared/ui";

type WorkoutOverviewProps = Readonly<{
  version: 1 | 2;
  onStart: () => void;
}>;

export function WorkoutOverview({ version, onStart }: WorkoutOverviewProps) {
  return (
    <>
      <section className="workout-hero" aria-labelledby="next-workout-title">
        <div className="hero-copy">
          <h2 id="next-workout-title">А · Всё тело</h2>
          <p>Версия {version} · Без привязки к дате</p>
        </div>
      </section>
      <ol className="exercise-list" aria-label="Упражнения следующего занятия">
        <li className="exercise-row">
          <div className="exercise-art"><ExerciseIllustration kind="leg-press" /></div>
          <div><h3>Жим ногами</h3><p>2 × 10 · Вес подобрать</p></div>
        </li>
        <li className="exercise-row">
          <div className="exercise-art"><ExerciseIllustration kind="pulldown" /></div>
          <div><h3>Тяга верхнего блока</h3><p>2 × 10 · Вес подобрать</p></div>
        </li>
      </ol>
      <Button className="primary workout-start" onClick={onStart}>Начать тренировку</Button>
      <Accordion className="panel" title="Дальше по очереди — Б">
        <p>Жим гантелей сидя и горизонтальная тяга блока. Если пропустить день, порядок останется прежним.</p>
      </Accordion>
    </>
  );
}
