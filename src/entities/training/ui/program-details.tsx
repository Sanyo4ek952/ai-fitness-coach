import { Accordion } from "@/shared/ui";
import { findExercise } from "../model/exercise";
import { type ProgramDraft } from "../model/program";
import { ruleActionText, setPlanLabel } from "../model/progression";
import { recommendationLabels as categories, conditionLabels as conditions } from "../model/program-display";

export function ProgramDetails({ program }: Readonly<{ program: ProgramDraft }>) {
  return <>
    {program.phases && <Accordion title="Этапы программы"><ol>{program.phases.map((phase) => <li key={phase.id}>
      <h4>{phase.title}</h4><p>{phase.goal}</p>
      <p>{phase.duration.count} {phase.duration.unit === "weeks" ? `нед. × ${phase.duration.sessionsPerWeek} занятий` : "занятий"}. {phase.transition === "manual" ? "Переход по вашей оценке" : "Переход после указанного числа завершённых или частичных занятий"}, с подтверждением. {phase.transitionNote}</p>
      <ul>{phase.overrides.map((o) => { const r = o.prescription; return <li key={`${o.workoutIndex}:${o.exerciseIndex}`}>
        {program.workouts[o.workoutIndex].title} · {findExercise(r.exerciseId, r.definition)?.name}: {r.sets} подх. · {r.target.type === "reps" ? `${r.target.min}–${r.target.max} повт. · ${r.target.weightKg === null ? "вес подобрать" : `${r.target.weightKg} кг`}` : r.target.type === "duration" ? `${r.target.seconds}${r.target.maxSeconds === undefined ? "" : `–${r.target.maxSeconds}`} с` : `${r.target.meters} м`} · отдых {r.restSec} с{r.target.type === "reps" ? ` · RIR ${r.rir ?? "неизвестен"}${r.rirMax === undefined ? "" : `–${r.rirMax}`}` : r.target.intensity ? ` · Интенсивность: ${r.target.intensity}` : ""} {r.note}
        {r.setPlans && <ol>{r.setPlans.map((_, i) => <li key={i}>{setPlanLabel(r, i + 1)}</li>)}</ol>}
      </li>; })}</ul>
    </li>)}</ol></Accordion>}
    {program.progressionRules && program.progressionRules.length > 0 && <Accordion title="Правила прогрессии"><ul>{program.progressionRules.map((r) => <li key={r.id}>
      <p><strong>{r.exerciseId ? findExercise(r.exerciseId, program.workouts.flatMap((w) => w.exercises).find((row) => row.exerciseId === r.exerciseId)?.definition)?.name : "Вся программа"}</strong> · {r.description}</p>
      <p>{conditions[r.condition.type]} · за {r.condition.sessions} сопоставимых занятий{r.condition.minRir === undefined ? "" : ` · RIR ≥ ${r.condition.minRir}`}{r.condition.maxRir === undefined ? "" : ` · RIR ≤ ${r.condition.maxRir}`} → {ruleActionText(r.action)}. Изменение требует подтверждения новой версии программы.</p>
    </li>)}</ul></Accordion>}
    {program.recommendations && program.recommendations.length > 0 && <Accordion title="Рекомендации программы">{Object.entries(categories).map(([category, title]) => {
      const items = program.recommendations?.filter((r) => r.category === category) ?? [];
      return items.length > 0 && <Accordion key={category} title={title}><ul>{items.map((r, i) => <li key={i}>{r.exerciseId && <strong>{findExercise(r.exerciseId, program.workouts.flatMap((w) => w.exercises).find((row) => row.exerciseId === r.exerciseId)?.definition)?.name} · </strong>}{r.phaseId && <strong>{program.phases?.find((p) => p.id === r.phaseId)?.title} · </strong>}{r.text}</li>)}</ul></Accordion>;
    })}</Accordion>}
  </>;
}
