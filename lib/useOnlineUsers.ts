"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Role, ADMIN_PASSWORD } from "./permissions";
import { ws } from "./ws";

export interface OnlineUser {
  session: string;
  name: string;
  role: Role;
  area: string;
  onDuty: boolean;
  dutyTime: string;
  lastSeen?: number;
}

const ME_KEY = "gid_user";

export function useOnlineUsers() {
  const [me, setMe] = useState<OnlineUser | null>(null);
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const meRef = useRef<OnlineUser | null>(null);
  meRef.current = me;

  useEffect(() => {
    try { const s = localStorage.getItem(ME_KEY); if (s) setMe(JSON.parse(s)); } catch {}
  }, []);

  // входящее присутствие; если среди них есть мой session — синхронизируем me
  useEffect(() => {
    ws.init();
    const off = ws.on("presence", (m: any) => {
      const list: OnlineUser[] = (m.users || []).map((u: any) => ({ ...u, lastSeen: Date.now() }));
      setUsers(list);
      const mine = meRef.current && list.find((u) => u.session === meRef.current!.session);
      if (mine) {
        setMe((prev) => {
          if (!prev) return prev;
          const next = { ...prev, role: mine.role, area: mine.area, onDuty: mine.onDuty, dutyTime: mine.dutyTime };
          localStorage.setItem(ME_KEY, JSON.stringify(next));
          return next;
        });
      }
    });
    return off;
  }, []);

  const login = useCallback((name: string, role: Role, area: string, password: string): string | null => {
    if (role === "admin" && password !== ADMIN_PASSWORD) return "Неверный пароль администратора";
    const user: OnlineUser = {
      session: "u" + Date.now() + Math.random().toString(36).slice(2, 6),
      name, role, area, onDuty: false, dutyTime: "", lastSeen: Date.now(),
    };
    localStorage.setItem(ME_KEY, JSON.stringify(user));
    setMe(user);
    ws.send({ kind: "login", user: { session: user.session, name, role, area, onDuty: false, dutyTime: "" } });
    return null;
  }, []);

  const logout = useCallback(() => {
    const cur = meRef.current;
    if (cur) ws.send({ kind: "logout", session: cur.session });
    localStorage.removeItem(ME_KEY);
    setMe(null);
  }, []);

  const updateMe = useCallback((patch: Partial<OnlineUser>) => {
    setMe((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      localStorage.setItem(ME_KEY, JSON.stringify(next));
      ws.send({ kind: "userPatch", session: next.session, patch: { name: next.name, role: next.role, area: next.area, onDuty: next.onDuty, dutyTime: next.dutyTime } });
      return next;
    });
  }, []);

  const updateUser = useCallback((session: string, patch: Partial<OnlineUser>) => {
    ws.send({ kind: "userPatch", session, patch });
  }, []);

  return { me, users, login, logout, updateMe, updateUser };
}
