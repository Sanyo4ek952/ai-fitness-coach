import { Theme } from "@radix-ui/themes";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Accordion, Button, Input, Select, Textarea } from "../src/shared/ui";

describe("Общие UI-компоненты Radix", () => {
  it("служебная кнопка не отправляет форму; submit задаётся явно", () => {
    const html = renderToStaticMarkup(<Theme><form><Button>Раскрыть</Button><Button type="submit">Сохранить</Button></form></Theme>);
    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).toMatch(/<button[^>]*type="submit"/);
  });
  it("аккордеон закрыт, но сохраняет поля формы в разметке", () => {
    const html = renderToStaticMarkup(<Theme><form><Accordion title="Необязательно"><Input name="optional" defaultValue="пример" /></Accordion></form></Theme>);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('name="optional"');
    expect(html).toContain('value="пример"');
  });
  it("поля сохраняют имена, подписи и нативные ограничения", () => {
    const html = renderToStaticMarkup(<Theme><form><Input name="reps" type="number" min={1} max={100} required /><Textarea name="goal" required maxLength={500} /><Select name="experience" label="Опыт" defaultValue="Не знаю" options={["Начинаю", "Не знаю"]} /></form></Theme>);
    expect(html).toContain('name="reps"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="100"');
    expect(html).toContain('name="goal"');
    expect(html).toContain('aria-label="Опыт"');
    expect(html).toContain('name="experience"');
  });
});
