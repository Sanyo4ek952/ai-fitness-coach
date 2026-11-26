// Только сценарий M0-02. Не доменная модель и не хранилище продукта.
export type DemoProfile = Readonly<{ goal: string; experience: string; frequency: string; equipment: string }>;
export type DemoSet = Readonly<{ weight: number; reps: number; rir: string }>;
export type DemoState = Readonly<{
  profile: DemoProfile | null;
  version: 0 | 1 | 2;
  proposal: "initial" | "update" | null;
  session: "idle" | "active" | "finished";
  sessionVersion: 1 | 2 | null;
  result: DemoSet | null;
  notice: string;
}>;
export const initialDemoState: DemoState = { profile: null, version: 0, proposal: null, session: "idle", sessionVersion: null, result: null, notice: "" };
export type DemoAction =
  | Readonly<{ type: "profile"; profile: DemoProfile }>
  | Readonly<{ type: "preview" }>
  | Readonly<{ type: "accept" }>
  | Readonly<{ type: "reject" }>
  | Readonly<{ type: "start" }>
  | Readonly<{ type: "log"; result: DemoSet }>
  | Readonly<{ type: "finish" }>
  | Readonly<{ type: "reset" }>;

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "profile": return { ...state, profile: action.profile, proposal: null, notice: "Демопрофиль сохранён на время просмотра." };
    case "preview": return state.profile && state.session !== "active" && state.version < 2
      ? { ...state, proposal: state.version === 0 ? "initial" : "update", notice: "" } : state;
    case "accept": return state.proposal && state.session !== "active"
      ? { ...state, version: state.proposal === "initial" ? 1 : 2, proposal: null, notice: "Программа подтверждена. Следующее занятие — А. Результаты сохранены в демосессии." } : state;
    case "reject": return { ...state, proposal: null, notice: state.version ? "Текущая программа оставлена без изменений." : "Пример отклонён. Активной программы пока нет." };
    case "start": return state.version && state.session === "idle" ? { ...state, session: "active", sessionVersion: state.version, notice: "" } : state;
    case "log": return state.session === "active" && Number.isFinite(action.result.weight) && action.result.weight >= 0 && action.result.weight <= 1000 && Number.isInteger(action.result.reps) && action.result.reps >= 1 && action.result.reps <= 100
      ? { ...state, result: action.result, notice: "Факт подхода записан в демосессии." } : state;
    case "finish": return state.session === "active" && state.result ? { ...state, session: "finished", notice: "Демонстрационное занятие завершено." } : state;
    case "reset": return initialDemoState;
  }
}
