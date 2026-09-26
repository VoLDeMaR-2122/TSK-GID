"use client";
import { useState, useEffect, useRef } from "react";

export interface Alert {
  id: string;
  type: "info" | "warning" | "critical";
  text: string;
  author: string;
  createdAt: number;
  active: boolean;
}

const KEY = "gid_alerts";
const uid = () => "a" + Math.random().toString(36).slice(2, 10);

export function useAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const lastTs = useRef(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const p = JSON.parse(raw); lastTs.current = p._ts || 0; setAlerts(p.list || []); }
    } catch {}
  }, []);

  useEffect(() => {
    const ts = Date.now();
    lastTs.current = ts;
    localStorage.setItem(KEY, JSON.stringify({ list: alerts, _ts: ts }));
  }, [alerts]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY || !e.newValue) return;
      try {
        const p = JSON.parse(e.newValue);
        if (p._ts && p._ts > lastTs.current) { lastTs.current = p._ts; setAlerts(p.list || []); }
      } catch {}
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const addAlert = (type: Alert["type"], text: string, author: string) =>
    setAlerts((p) => [{ id: uid(), type, text, author, createdAt: Date.now(), active: true }, ...p]);
  const toggleAlert = (id: string) => setAlerts((p) => p.map((a) => a.id === id ? { ...a, active: !a.active } : a));
  const removeAlert = (id: string) => setAlerts((p) => p.filter((a) => a.id !== id));
  const clearOld = () => setAlerts((p) => p.filter((a) => a.active));

  return { alerts, addAlert, toggleAlert, removeAlert, clearOld };
}
