import { findExercise, ExerciseDefinitionDetails, ProgramDetails, setPlanLabel, type Exercise, programToDraft, type CoachResponse, type ProgramVersion, type ProgramDraft } from "@/entities/training";
import { Accordion } from "@/shared/ui";
import { ProgramDiff } from "./program-diff";

export function CoachPreview({ response, before, showNutrition = true }: Readonly<{ response: CoachResponse; before?: ProgramVersion | null; showNutrition?: boolean }>) {
  return <section className="panel stack coach-preview" aria-label="Предпросмотр ответа">
    <h2>{response.decision === "propose_program" ? "Предложение программы" : response.decision === "needs_input" ? "Нужно уточнение" : response.decision === "unsupported" ? "Запрос не поддержан" : "Сохранить текущую программу"}</h2>
    <p className="badge">Не применено · только предпросмотр</p>
    <p>{response.summary}</p>
    {response.reasons.length > 0 && <Accordion title="Почему ИИ это предлагает"><ul>{response.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul></Accordion>}
    {response.decision === "needs_input" && <p><strong>Вопрос:</strong> {response.question}</p>}
    {response.decision === "propose_program" && <>
      {before && <Accordion title="Изменения относительно текущей программы"><ProgramDiff before={programToDraft(before)} after={response.proposedProgram} /></Accordion>}
      <ProgramPlan program={response.proposedProgram} />
      <p className="muted">Структура и оборудование проверены. Смысл ограничений и безопасность нагрузки требуют оценки человеком; JSON-проверка этого не гарантирует.</p>
    </>}
    {showNutrition && response.nutritionTips.length > 0 && <><h3>Питание · по вашему согласию</h3><ul>{response.nutritionTips.map((tip, i) => <li key={i}>{tip}</li>)}</ul></>}
    <p className="muted">До явного подтверждения программа и история не изменяются.</p>
  </section>;
}

function loadText(id: string, definition?: Exercise) {
  const load = findExercise(id, definition)?.load;
  if (!load) return "";
  return load.type === "assistance" ? "Килограммы означают помощь, а не отягощение." : load.type === "external" && load.basis === "per-dumbbell" ? "Вес указан для одной гантели." : "Нагрузка указана по единицам выбранного упражнения.";
}

export function ProgramPlan({ program }: Readonly<{ program: ProgramDraft }>) {
  return <div className="stack coach-preview">
      <div><h3 className="coach-plan-title">{program.title}</h3><p className="muted">Занятий в последовательности: {program.workouts.length} · без привязки к датам</p></div>
      <p className="muted">Откройте день, чтобы посмотреть упражнения и нагрузку.</p>
      <div className="coach-days">{program.workouts.map((workout, i) => <Accordion key={i} className="coach-day" defaultOpen={i === 0} title={`${i + 1}. ${workout.title} · упражнений: ${workout.exercises.length}`}>
        <ul className="coach-exercises">{workout.exercises.map((row, j) => <li key={j}>
          <div className="coach-exercise-heading"><strong>{findExercise(row.exerciseId, row.definition)?.name}</strong><span>{row.sets} × {row.target.type === "reps"
            ? `${row.target.min}–${row.target.max} повт.`
            : row.target.type === "duration" ? `${row.target.seconds}${row.target.maxSeconds === undefined ? "" : `–${row.target.maxSeconds}`} с` : `${row.target.meters} м`}</span></div>
          <p className="muted">{row.target.type === "reps" && <>{row.target.weightKg === null ? "вес подобрать" : `${row.target.weightKg} кг`} · </>}Отдых {row.restSec} с{row.target.type === "reps" ? ` · RIR: ${row.rir ?? "неизвестен"}${row.rirMax === undefined ? "" : `–${row.rirMax}`}` : ""}</p>
          {row.target.type !== "reps" && row.target.intensity && <p className="muted">Интенсивность: {row.target.intensity}</p>}
          {findExercise(row.exerciseId, row.definition)?.load && <p className="muted">{loadText(row.exerciseId, row.definition)}</p>}
          {row.definition && <ExerciseDefinitionDetails exercise={row.definition} />}
          {row.setPlans && <ol>{row.setPlans.map((_, k) => <li key={k}>{setPlanLabel(row, k + 1)}</li>)}</ol>}
          {row.note && <p className="coach-exercise-note">{row.note}</p>}
        </li>)}</ul>
      </Accordion>)}</div>
      <ProgramDetails program={program} />
      <Accordion title="Цель и повторный анализ"><p><strong>Интерпретация цели:</strong> {program.goalInterpretation}</p><p>До повторного анализа предложено занятий: {program.reviewAfterSessions}.</p></Accordion>
      <p className="muted"><strong>После подтверждения: {program.workouts[0].title}.</strong> Начнётся новая последовательность. История сохранится.</p>
  </div>;
}
