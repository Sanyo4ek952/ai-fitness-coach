import { AppShell } from "@/widgets/app-shell";
import { BodyProgress } from "@/features/body-progress";
import { TrainingProgress } from "@/features/training-progress";

export function ProgressPage() {
  return <AppShell activePath="/progress"><TrainingProgress /><BodyProgress /></AppShell>;
}
