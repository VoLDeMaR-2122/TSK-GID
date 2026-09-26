"use client";
import { useState, useEffect, useRef } from "react";
import { GidState } from "./types";
import { INITIAL_STATE } from "./initialData";

const KEY = "gid_ural_state";

export function useGidState() {
  const [state, setState] = useState<GidState>(INITIAL_STATE);
  const lastTs = useRef(0);

  // Загрузка
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        lastTs.current = parsed._ts || 0;
        setState((prev) => ({ ...prev, ...parsed, selected: null }));
      }
    } catch {}
  }, []);

  // Сохранение с меткой времени
  useEffect(() => {
    const ts = Date.now();
    lastTs.current = ts;
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...state, selected: null, _ts: ts })
    );
  }, [state.stations, state.trains, state.marks]);

  // Приём изменений из других вкладок (реальное время)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue);
        if (parsed._ts && parsed._ts > lastTs.current) {
          lastTs.current = parsed._ts;
          // Обновляем только данные, локальный вид/выделение не трогаем
          setState((prev) => ({
            ...prev,
            stations: parsed.stations ?? prev.stations,
            trains: parsed.trains ?? prev.trains,
            marks: parsed.marks ?? prev.marks,
          }));
        }
      } catch {}
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const resetData = () => {
    localStorage.removeItem(KEY);
    setState(INITIAL_STATE);
  };

  return { state, setState, resetData };
}
