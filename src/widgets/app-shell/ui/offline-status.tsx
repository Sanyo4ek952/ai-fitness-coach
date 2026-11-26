"use client";

import { useEffect, useState } from "react";

type Status = "loading" | "ready" | "unavailable";

export function OfflineStatus() {
  const [status, setStatus] = useState<Status>("loading");
  const [waiting, setWaiting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    async function start() {
      if (!("serviceWorker" in navigator) || !window.isSecureContext) {
        setStatus("unavailable");
        return;
      }
      const check = (repair = false) => {
        const controller = navigator.serviceWorker.controller;
        if (!controller || disposed) return;
        const channel = new MessageChannel();
        const timer = window.setTimeout(() => {
          if (!disposed) setStatus("unavailable");
          channel.port1.close();
        }, 8000);
        const close = () => { window.clearTimeout(timer); channel.port1.close(); };
        cleanups.push(close);
        channel.port1.onmessage = (event: MessageEvent<unknown>) => {
          const data = event.data;
          if (!disposed && typeof data === "object" && data !== null && "type" in data && data.type === "OFFLINE_STATUS" && "ready" in data) {
            setStatus(data.ready === true ? "ready" : "unavailable");
          }
          close();
        };
        controller.postMessage({ type: repair ? "PREPARE_OFFLINE" : "OFFLINE_STATUS" }, [channel.port2]);
      };
      const refresh = () => check();
      navigator.serviceWorker.addEventListener("controllerchange", refresh);
      window.addEventListener("online", refresh);
      document.addEventListener("visibilitychange", refresh);
      cleanups.push(() => {
        navigator.serviceWorker.removeEventListener("controllerchange", refresh);
        window.removeEventListener("online", refresh);
        document.removeEventListener("visibilitychange", refresh);
      });
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        if (disposed) return;
        const observe = () => {
          const worker = registration.installing;
          const changed = () => {
            if (disposed) return;
            setWaiting(Boolean(registration.waiting));
            if (worker?.state === "redundant") setStatus("unavailable");
            check();
          };
          worker?.addEventListener("statechange", changed);
          cleanups.push(() => worker?.removeEventListener("statechange", changed));
          changed();
        };
        registration.addEventListener("updatefound", observe);
        cleanups.push(() => registration.removeEventListener("updatefound", observe));
        observe();
        check(attempt > 0);
        if (attempt > 0) await registration.update();
      } catch {
        if (!disposed) setStatus("unavailable");
      }
    }
    void start();
    return () => { disposed = true; cleanups.forEach((cleanup) => cleanup()); };
  }, [attempt]);

  if (process.env.NODE_ENV !== "production") return null;
  return (
    <details className="offline-status">
      <summary>{status === "ready" ? "Ресурсы для офлайн загружены" : status === "loading" ? "Подготовка к офлайн…" : "Офлайн пока не готов"}</summary>
      <p role="status">{status === "ready" ? "Все разделы сохранены для работы без сети. Профиль, подходы и фото хранятся на этом устройстве. Внешнему ИИ нужен интернет." : "Для первой загрузки всех разделов нужен интернет и доступ к хранилищу браузера. Пока загрузка не завершена, открытие без сети не гарантируется."}</p>
      {status !== "ready" && <button type="button" className="secondary-button" onClick={() => setAttempt((value) => value + 1)}>Повторить подготовку</button>}
      {waiting && <p>Обновление загружено. Завершите работу и закройте все вкладки и окна приложения; новая версия откроется при следующем запуске.</p>}
      <p>Установка: в меню браузера выберите «Установить приложение» или «На экран Домой». На iPhone — «Поделиться» → «На экран Домой». Доступность зависит от браузера.</p>
      <p>Браузер может удалить локальные данные. Установка приложения не заменяет резервную копию.</p>
    </details>
  );
}
