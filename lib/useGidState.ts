"use client";
import { useState, useEffect, useRef } from "react";
import { GidState } from "./types";
import { INITIAL_STATE } from "./initialData";
import { ws } from "./ws";

const LOCAL_KEY = "gid_local_view";

function loadLocal(): Pick<GidState, "view" | "selected" | "showNumbers" | "showTimeMarks"> {
  const def = { view: INITIAL_STATE.view, selected: null as GidState["selected"], showNumbers: true, showTimeMarks: true };
  try { return { ...def, ...JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}") }; } catch { return def; }
}

export function useGidState() {
  const [state, setState] = useState<GidState>(() => ({ ...INITIAL_STATE, ...loadLocal() }));
  const ready = useRef(false);

  // входящий снапшот от сервера -> мержим только серверные поля
  useEffect(() => {
    ws.init();
    const off = ws.on("state", (m: any) => {
      ready.current = true;
      setState((prev) => ({ ...prev, stations: m.state.stations, trains: m.state.trains, marks: m.state.marks }));
    });
    return off;
  }, []);

  // исходящая синхронизация: при изменении серверных полей шлём снапшот
  useEffect(() => {
    if (!ready.current) return;
    ws.send({ kind: "state", state: { stations: state.stations, trains: state.trains, marks: state.marks } });
  }, [state.stations, state.trains, state.marks]);

  // локальные поля — в localStorage (приватные, не синхронизируются)
  useEffect(() => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ view: state.view, selected: state.selected, showNumbers: state.showNumbers, showTimeMarks: state.showTimeMarks }));
  }, [state.view, state.selected, state.showNumbers, state.showTimeMarks]);

  const resetData = () => {
    setState((prev) => ({ ...INITIAL_STATE, view: prev.view, selected: null, showNumbers: prev.showNumbers, showTimeMarks: prev.showTimeMarks }));
  };

  return { state, setState, resetData };
}
