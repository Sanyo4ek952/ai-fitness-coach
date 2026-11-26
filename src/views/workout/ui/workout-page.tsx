import { AppShell } from "@/widgets/app-shell";
import { AnalysisSignal } from "@/features/analysis-signal";
import { NextWorkout } from "@/features/next-workout";

export function WorkoutPage() {
  return <AppShell activePath="/workout"><NextWorkout><AnalysisSignal /></NextWorkout></AppShell>;
}


