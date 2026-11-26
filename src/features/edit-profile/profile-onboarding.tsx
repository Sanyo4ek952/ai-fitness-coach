"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createTrainingStorage } from "@/entities/training";
import { Button } from "@/shared/ui";
import { ProfileEditor } from "./profile-editor";

export function ProfileOnboarding({ children }: Readonly<{ children: ReactNode }>) {
  const [state, setState] = useState<"loading" | "new" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const storage = createTrainingStorage();
    let active = true;
    void (async () => {
      try {
        await storage.open();
        const profile = await storage.profiles.current();
        if (active) setState(profile ? "ready" : "new");
      } catch { if (active) setState("error"); }
      finally { storage.close(); }
    })();
    return () => { active = false; storage.close(); };
  }, [attempt]);
  // The editor owns its draft/conflict flow until a successful commit. A profile
  // created in another tab must not unmount an unfinished first-visit form.
  return <div ref={content} tabIndex={-1}>
    {state === "loading" && <p role="status">Проверяем сохранённый профиль…</p>}
    {state === "error" && <section className="panel stack" role="alert">
      <h1>Не удалось прочитать профиль</h1><p>Данные не удалены. Проверьте доступность локального хранения и повторите.</p>
      <Button onClick={() => { setState("loading"); setAttempt((value) => value + 1); }}>Повторить</Button>
      <Link href="/profile/" className="quiet">Открыть профиль и резервные копии →</Link>
    </section>}
    {state === "new" && <><ProfileEditor onCreated={() => { setState("ready"); content.current?.focus(); }} />
      <p><Link href="/profile/" className="quiet">У меня есть резервная копия →</Link></p></>}
    {state === "ready" && children}
  </div>;
}
