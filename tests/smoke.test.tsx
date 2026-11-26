import { Theme } from "@radix-ui/themes";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrototypeProvider } from "../src/widgets/ux-prototype";
import Home from "../app/page";
import Workout from "../app/workout/page";
import Progress from "../app/progress/page";
import Coach from "../app/coach/page";
import Profile from "../app/profile/page";

describe("Адаптеры маршрутов", () => {
  it.each([
    ["/", Home, "Тренировка", "/workout"],
    ["/workout", Workout, "Тренировка", "/workout"],
    ["/progress", Progress, "Прогресс", "/progress"],
    ["/coach", Coach, "Тренер", "/coach"],
    ["/profile", Profile, "Профиль", "/profile"],
  ] as const)("%s отображает экран и навигацию", (_path, Page, title, activePath) => {
    const html = renderToStaticMarkup(<Theme appearance="dark"><PrototypeProvider><Page /></PrototypeProvider></Theme>);
    if (activePath === "/profile" || activePath === "/coach") expect(html).toContain(`>${title}</h1>`);
    else expect(html).toContain("Проверяем сохранённый профиль");
    expect(html).toContain('id="main-content"');
    expect(html).toContain(activePath === "/profile" ? "Локальный профиль" : activePath === "/coach" ? "Локальный AI-обмен" : activePath === "/workout" ? "Локальная тренировка" : "Локальный прогресс");
    const navigation = html.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(navigation.match(/<svg /g)).toHaveLength(4);
    expect(navigation.match(/aria-hidden="true"/g)).toHaveLength(4);
    expect(navigation.match(/focusable="false"/g)).toHaveLength(4);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    for (const path of ["/workout", "/progress", "/coach", "/profile"]) {
      expect(html).toContain(`href="${path}"`);
    }
    expect(html).toMatch(new RegExp(`aria-current="page"[^>]*href="${activePath}"|href="${activePath}"[^>]*aria-current="page"`));
  });
});

