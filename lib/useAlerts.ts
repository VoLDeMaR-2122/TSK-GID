"use client";
import { useState, useEffect } from "react";
import { ws } from "./ws";

export interface Alert {
  id: string;
  type: "info" | "warning" | "critical";
  text: string;
  author: string;
  createdAt: number;
  active: boolean;
}

const uid = () => "a" + Math.random().toString(36).slice(2, 10);

export function useAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    ws.init();
    const off = ws.on("alerts", (m: any) => setAlerts(m.alerts || []));
    return off;
  }, []);

  const addAlert = (type: Alert["type"], text: string, author: string) =>
    ws.send({ kind: "alertAdd", alert: { id: uid(), type, text, author, createdAt: Date.now(), active: true } });
  const toggleAlert = (id: string) => ws.send({ kind: "alertToggle", id });
  const removeAlert = (id: string) => ws.send({ kind: "alertRemove", id });
  const clearOld = () => { /* сервер хранит историю; очистка по желанию */ };

  return { alerts, addAlert, toggleAlert, removeAlert, clearOld };
}
