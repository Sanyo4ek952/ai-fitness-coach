import { Dexie } from "dexie";
import { createTrainingStorage, type CoachRequest } from "@/entities/training";
import { TrainingDatabase } from "@/shared/infrastructure/db";
import example from "../examples/coach-response.example.json";

export async function nutritionCases(report: (label: string) => void) {
  const name = `m5-03-native-${crypto.randomUUID()}`;
  const s = createTrainingStorage(name); const other = createTrainingStorage(name); const raw = new TrainingDatabase(name);
  const time = "2026-11-25T10:00:00.000Z";
  const later = "2026-11-25T10:01:00.000Z";
  function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }
  const answer = (request: CoachRequest, tips: readonly string[]) => ({ ...example, requestId: request.requestId, context: request.context, nutritionTips: tips });
  try {
    await s.open(); await other.open(); await raw.open();
    const profile = { id: crypto.randomUUID(), revision: 1, goal: "Синтетическая цель", experience: "unknown", sessionsPerWeek: null, equipment: ["dumbbells", "bench"], nutritionOptIn: false };
    await s.profiles.save(profile);
    check(!(await s.coach.nutrition()).enabled, "default consent"); report("по умолчанию отключено");
    await s.profiles.save({ ...profile, revision: 2, nutritionOptIn: true });
    check((await s.coach.nutrition()).tips.length === 0, "no program");
    const initial = await s.coach.createInitialRequest(crypto.randomUUID(), time);
    const tips = ["Регулярность", "Разнообразие", "Вода"];
    const response = await s.coach.importResponse(answer(initial, tips));
    check((await s.coach.nutrition()).tips.length === 0, "preview leaked"); report("предпросмотр не становится принятыми советами");
    await s.coach.accept(response, later, true);
    s.close(); await s.open();
    check(JSON.stringify((await s.coach.nutrition()).tips) === JSON.stringify(tips), "reopen"); report("три принятых пункта переживают reopen");
    async function review() {
      const overview = await s.analysis.overview(later); check(overview, "overview");
      return s.coach.createReviewRequest(crypto.randomUUID(), later, overview.token);
    }
    const pending = await review();
    check((await s.coach.nutrition()).tips.length === 3, "export hid tips");
    const { proposedProgram: unused, ...keep } = answer(pending, []); check(unused, "program");
    const preview = await s.coach.importResponse({ ...keep, decision: "keep" });
    await s.coach.reject(preview);
    check((await s.coach.nutrition()).tips.length === 3, "reject hid tips"); report("новый экспорт и отклонение сохраняют принятые советы");
    await s.coach.accept(await s.coach.importResponse({ ...keep, decision: "keep" }), later, true);
    check((await s.coach.nutrition()).tips.length === 0, "empty keep fallback"); report("keep с равной датой и пустым списком заменяет прежние советы");
    const next = await review();
    const { proposedProgram: ignored, ...base } = answer(next, tips); check(ignored, "program");
    await s.coach.accept(await s.coach.importResponse({ ...base, decision: "keep" }), later, true);
    await other.profiles.save({ ...profile, revision: 3, nutritionOptIn: false });
    check(!(await s.coach.nutrition()).enabled && (await s.coach.nutrition()).tips.length === 0, "revoke");
    check((await s.coach.acceptance(next.requestId))?.response.nutritionTips.length === 3, "history changed");
    await other.profiles.save({ ...profile, revision: 4, nutritionOptIn: true });
    check((await s.coach.nutrition()).tips.length === 0, "old profile advice"); report("отзыв из другой connection скрывает советы, история сохранна; повторное согласие требует нового анализа");
    const updateRequest = await review();
    await s.coach.accept(await s.coach.importResponse(answer(updateRequest, tips)), later, true);
    check((await s.coach.nutrition()).tips.length === 3, "update");
    const overview = await s.analysis.overview(later); check(overview, "overview");
    // Return to the original plan; rollback creates a new version without advice.
    check(updateRequest.program, "old program");
    await s.programs.rollback({ sourceId: updateRequest.program.id, expectedToken: overview.token, createdAt: later, reviewAcknowledged: true });
    check((await s.coach.nutrition()).tips.length === 0, "rollback advice"); report("новая программа получает свой пакет; rollback не воскрешает питание старой версии");
    await raw.coachAcceptances.put({ requestId: next.requestId, payload: { broken: true } });
    let failed = false; try { await s.coach.nutrition(); } catch { failed = true; }
    check(failed, "corruption silently ignored"); report("повреждение хранения выдаёт ошибку");
  } finally { s.close(); other.close(); raw.close(); await Dexie.delete(name); }
}
