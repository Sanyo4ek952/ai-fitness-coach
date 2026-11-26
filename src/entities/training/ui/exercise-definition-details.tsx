import type { Exercise } from "../model/exercise";
import { exerciseMetadataText } from "../model/program-display";

export function ExerciseDefinitionDetails({ exercise }: Readonly<{ exercise: Exercise }>) {
  return <p className="muted">{exerciseMetadataText(exercise)}.</p>;
}
