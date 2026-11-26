import { AppShell } from "@/widgets/app-shell";
import { CoachPrototype } from "@/widgets/ux-prototype";
import { AnalysisSignal } from "@/features/analysis-signal";
import { CoachContent } from "./coach-content";
import { Accordion } from "@/shared/ui";

export function CoachPage() {
  return <AppShell activePath="/coach"><CoachContent><AnalysisSignal coach /></CoachContent><Accordion className="panel" title="Отдельное синтетическое демо"><p>Демо использует вымышленные данные. Реальный профиль и импортированный ответ в демотренировку не передаются.</p><CoachPrototype /></Accordion></AppShell>;
}

