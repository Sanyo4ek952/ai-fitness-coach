import { describe, expect, it } from "vitest";
import { demoReducer, initialDemoState, type DemoState } from "../src/widgets/ux-prototype/model";

const profile = { goal: "Демоцель", experience: "Не знаю", frequency: "Не знаю", equipment: "Не знаю" };
const configured = demoReducer(initialDemoState, { type: "profile", profile });
const preview = demoReducer(configured, { type: "preview" });
const accepted = demoReducer(preview, { type: "accept" });
const active = demoReducer(accepted, { type: "start" });
const logged = demoReducer(active, { type: "log", result: { weight: 25, reps: 10, rir: "Не знаю" } });
const finished = demoReducer(logged, { type: "finish" });

describe("M0-02: сценарий UX, без БД и реального импорта", () => {
  it("профиль без дополнительных данных; предпросмотр не применяет план", () => {
    expect(configured.profile).toEqual(profile);
    expect(preview.version).toBe(0);
    expect(preview.proposal).toBe("initial");
    expect(accepted.version).toBe(1);
  });
  it("отказ и повторное подтверждение не меняют программу", () => {
    expect(demoReducer(preview, { type: "reject" }).version).toBe(0);
    expect(demoReducer(accepted, { type: "accept" })).toBe(accepted);
  });
  it("без программы нельзя начать; план не превращается в факт", () => {
    expect(demoReducer(configured, { type: "start" })).toBe(configured);
    expect(active.result).toBeNull();
    expect(demoReducer(active, { type: "finish" })).toBe(active);
  });
  it("некорректный факт не записывается", () => {
    for (const result of [{weight: NaN, reps: 10, rir: "Не знаю"}, {weight: -1, reps: 10, rir: "Не знаю"}, {weight: 10, reps: 1.5, rir: "Не знаю"}]) {
      expect(demoReducer(active, { type: "log", result })).toBe(active);
    }
  });
  it("факт исправляется явно, исходное состояние неизменно", () => {
    const corrected = demoReducer(logged, { type: "log", result: { weight: 20, reps: 8, rir: "2" } });
    expect(corrected.result?.reps).toBe(8);
    expect(logged.result?.reps).toBe(10);
  });
  it("активное занятие блокирует обновление", () => {
    expect(demoReducer(active, { type: "preview" })).toBe(active);
    const stale: DemoState = { ...active, proposal: "update" };
    expect(demoReducer(stale, { type: "accept" })).toBe(stale);
  });
  it("завершение и подтверждение обновления сохраняют снимок/факт", () => {
    expect(demoReducer(finished, { type: "finish" })).toBe(finished);
    const update = demoReducer(finished, { type: "preview" });
    expect(update.version).toBe(1);
    expect(demoReducer(update, { type: "reject" }).version).toBe(1);
    const next = demoReducer(update, { type: "accept" });
    expect(next.version).toBe(2);
    expect(next.result).toBe(finished.result);
    expect(next.sessionVersion).toBe(1);
  });
  it("занятие фиксирует именно версию на старте; сброс очищает демо", () => {
    const v2 = demoReducer(demoReducer(accepted, { type: "preview" }), { type: "accept" });
    expect(demoReducer(v2, { type: "start" }).sessionVersion).toBe(2);
    expect(demoReducer(finished, { type: "reset" })).toEqual(initialDemoState);
  });
});
