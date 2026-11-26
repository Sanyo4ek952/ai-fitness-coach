import Link from "next/link";
import type { ReactNode } from "react";
import { BrainCircuit, ChartNoAxesCombined, Dumbbell, UserRound, WorkoutDumbbell, WorkoutBars } from "@/shared/ui";
import { OfflineStatus } from "./offline-status";
import { BackupReloadNotice } from "@/features/backup";
import { ProfileOnboarding } from "@/features/edit-profile";

const navigation = [
  { href: "/workout", label: "Тренировка", icon: Dumbbell },
  { href: "/progress", label: "Прогресс", icon: ChartNoAxesCombined },
  { href: "/coach", label: "Тренер", icon: BrainCircuit },
  { href: "/profile", label: "Профиль", icon: UserRound },
] as const;

type AppShellProps = Readonly<{
  children: ReactNode;
  activePath: (typeof navigation)[number]["href"];
}>;

export function AppShell({ children, activePath }: AppShellProps) {
  return <AppShellFrame activePath={activePath}><BackupReloadNotice>{activePath === "/profile" || activePath === "/coach" ? children : <ProfileOnboarding>{children}</ProfileOnboarding>}</BackupReloadNotice></AppShellFrame>;
}

// Shared presentation for the app and its visual comparison harness. No storage
// reads or onboarding bypass flags belong in this frame.
export function AppShellFrame({ children, activePath }: AppShellProps) {
  return (
    <div className={`app-shell${activePath === "/workout" ? " workout-shell" : ""}`}>
      <div className="ambient-orbits" aria-hidden="true"><i /><i /><b /><b /></div>
      <div className="shell-scroll">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:mb-4 focus:inline-flex focus:min-h-11 focus:items-center"
      >
        Перейти к содержимому
      </a>
      <header className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /></span><span>{activePath === "/workout" ? <><span className="brand-ai">AI</span> Fitness Coach</> : "AI Fitness Coach"}</span></header>
      <main id="main-content" tabIndex={-1} className="main-content">
        {children}
      </main>
      <aside className="demo-banner" aria-label="Состояние приложения"><strong>{activePath === "/profile" ? "Локальный профиль" : activePath === "/coach" ? "Локальный AI-обмен" : activePath === "/workout" ? "Локальная тренировка" : "Локальный прогресс"}</strong><span>Подходы и история сохраняются на устройстве</span></aside>
      <OfflineStatus />
      </div>
      <nav
        aria-label="Основная навигация"
        className="bottom-nav"
      >
        {navigation.map(({ href, label, icon }) => { const Icon = activePath === "/workout" ? href === "/workout" ? WorkoutDumbbell : href === "/progress" ? WorkoutBars : href === "/coach" ? UserRound : icon : icon; return (
          <Link
            key={href}
            href={href}
            aria-current={href === activePath ? "page" : undefined}
            className="nav-link"
          >
            <Icon className="nav-symbol" size={24} strokeWidth={1.8} aria-hidden="true" focusable="false" />{label}
          </Link>
        ); })}
      </nav>
    </div>
  );
}
