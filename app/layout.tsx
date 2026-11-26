import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PrototypeProvider } from "@/widgets/ux-prototype";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Fitness Coach",
  description: "Локальный дневник тренировок. Начальная версия приложения.",
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#081426" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body><Theme appearance="dark" accentColor="blue" grayColor="slate" radius="large"><PrototypeProvider>{children}</PrototypeProvider></Theme></body>
    </html>
  );
}
