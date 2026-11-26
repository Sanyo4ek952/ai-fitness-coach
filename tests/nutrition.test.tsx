import "fake-indexeddb/auto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NutritionTips } from "@/features/coach-exchange/nutrition-tips";
import { CoachPreview } from "@/features/coach-exchange/coach-preview";
import { coachResponseSchema } from "@/entities/training";
import example from "../examples/coach-response.example.json";
import { nutritionCases } from "./nutrition-cases";

describe("M5-03 добровольное питание", () => {
  it("согласие/preview/accept/reopen/export/keep/revoke/update/rollback без потери истории", async () => {
    const passed: string[] = []; await nutritionCases((label) => passed.push(label)); expect(passed).toHaveLength(8);
  });
  it("отключение и пустой ответ объяснены без обязательных полей", () => {
    expect(renderToStaticMarkup(<NutritionTips enabled={false} tips={[]} />)).toContain("советы отключены");
    expect(renderToStaticMarkup(<NutritionTips enabled tips={[]} />)).toContain("Пустой список допустим");
  });
  it("советы остаются текстом, без HTML или автоссылок", () => {
    const html = renderToStaticMarkup(<NutritionTips enabled tips={['<img src=x onerror="bad()"> https://example.org']} />);
    expect(html).toContain("&lt;img"); expect(html).not.toContain("<img"); expect(html).not.toContain('href="https:');
  });
  it("отзыв текущего согласия скрывает советы в старом preview", () => {
    const response = coachResponseSchema.parse({ ...example, nutritionTips: ["Совет скрыт"] });
    expect(renderToStaticMarkup(<CoachPreview response={response} showNutrition={false} />)).not.toContain("Совет скрыт");
  });
});
