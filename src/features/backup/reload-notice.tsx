"use client";

import { liveQuery } from "dexie";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createTrainingStorage } from "@/entities/training";
import { Button } from "@/shared/ui";

export function BackupReloadNotice({ children }: Readonly<{ children?: ReactNode }>) {
  const [required, setRequired] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { if (required) panel.current?.focus(); }, [required]);
  useEffect(() => {
    let disposed = false;
    const storage = createTrainingStorage();
    let subscription: { unsubscribe(): void } | undefined;
    void storage.open().then(() => {
      if (disposed) return;
      subscription = liveQuery(() => storage.backup.needsReload()).subscribe({
        next: (value) => { if (!disposed) setRequired(value); },
        error: () => { if (!disposed) setError(true); },
      });
    }).catch(() => { if (!disposed) setError(true); }).finally(() => { if (disposed) storage.close(); });
    return () => { disposed = true; subscription?.unsubscribe(); storage.close(); };
  }, [attempt]);
  return required ? <section ref={panel} tabIndex={-1} className="panel stack" role="alert">
    <p>Данные заменены из резервной копии или удалены в этой или другой вкладке. Перезагрузите страницу перед изменениями. Несохранённый ввод не перенесётся.</p>
    <Button onClick={() => window.location.reload()}>Перезагрузить страницу</Button>
  </section> : <>{error && <section className="panel stack" role="alert">
    <p>Не удалось проверить замену или удаление данных в другой вкладке. Проверьте доступ к локальному хранилищу и повторите.</p>
    <Button onClick={() => { setError(false); setAttempt((value) => value + 1); }}>Повторить проверку данных</Button>
  </section>}{children}</>;
}
