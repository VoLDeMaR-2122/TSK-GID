"use client";
import { useState, useEffect } from "react";
import { ws } from "./ws";

export interface Alert {
  id: string;
  type: "info" | "warning" | "critical";
  /** Название — полоска вверху и заголовок карточки. */
  title: string;
  /** Краткое описание — строка в списке. */
  text: string;
  /** Полное описание — открывается по клику на полоску. */
  full: string;
  author: string;
  createdAt: number;
  active: boolean;
}

const uid = () => "a" + Math.random().toString(36).slice(2, 10);

export function useAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    ws.init();
    const off = ws.on("alerts", (m) => {
      const raw = (m.alerts ?? []) as Record<string, unknown>[];
      setAlerts(
        raw.map((a) => ({
          id: String(a.id),
          type: (["info", "warning", "critical"] as const).includes(a.type as Alert["type"])
            ? (a.type as Alert["type"])
            : "info",
          title: typeof a.title === "string" ? a.title : "",
          text: typeof a.text === "string" ? a.text : "",
          full: typeof a.full === "string" ? a.full : "",
          author: typeof a.author === "string" ? a.author : "",
          createdAt: Number(a.createdAt) || 0,
          active: a.active !== false,
        })),
      );
    });
    return off;
  }, []);

  const addAlert = (
    type: Alert["type"],
    title: string,
    text: string,
    full: string,
    author: string,
  ) =>
    ws.send({
      kind: "alertAdd",
      alert: { id: uid(), type, title, text, full, author, createdAt: Date.now(), active: true },
    });
  const updateAlert = (alert: Pick<Alert, "id" | "type" | "title" | "text" | "full">) =>
    ws.send({ kind: "alertUpdate", alert });
  const toggleAlert = (id: string) => ws.send({ kind: "alertToggle", id });
  const removeAlert = (id: string) => ws.send({ kind: "alertRemove", id });

  return { alerts, addAlert, updateAlert, toggleAlert, removeAlert };
}
