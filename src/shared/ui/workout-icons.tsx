import type { ComponentProps } from "react";

export function WorkoutDumbbell(props: Readonly<ComponentProps<"svg">>) {
  return <svg viewBox="0 0 28 24" width={26} height={24} fill="currentColor" {...props}><rect x="1" y="8" width="3" height="8" rx="1" /><rect x="5" y="3" width="4" height="18" rx="1.5" /><rect x="9" y="10.5" width="10" height="3" /><rect x="19" y="3" width="4" height="18" rx="1.5" /><rect x="24" y="8" width="3" height="8" rx="1" /></svg>;
}

export function WorkoutBars(props: Readonly<ComponentProps<"svg">>) {
  return <svg viewBox="0 0 28 24" width={26} height={24} fill="currentColor" {...props}><rect x="3" y="16" width="4" height="6" rx=".7" /><rect x="10" y="11" width="4" height="11" rx=".7" /><rect x="17" y="5" width="4" height="17" rx=".7" /><rect x="24" y="1" width="3" height="21" rx=".7" /></svg>;
}
