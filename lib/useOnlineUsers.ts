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

function toWire(u: OnlineUser) {
  return {
    session: u.session,
    name: u.name,
    role: u.role,
    area: u.area,
    onDuty: u.onDuty,
    dutyTime: u.dutyTime,
  };
}

export function useOnlineUsers() {
  const [me, setMe] = useState<OnlineUser | null>(null);
  const [users, setUsers] = useState<OnlineUser[]>([]);

  const meRef = useRef<OnlineUser | null>(null);
  meRef.current = me;

  // Подписка на presence
  useEffect(() => {
    ws.init();

    const off = ws.on("presence", (m: any) => {
      const list: OnlineUser[] = (m.users || []).map((u: any) => ({
        session: String(u.session),
        name: String(u.name || ""),
        role: String(u.role || "dsp") as Role,
        area: String(u.area || ""),
        onDuty: Boolean(u.onDuty),
        dutyTime: String(u.dutyTime || ""),
        lastSeen: Date.now(),
      }));

      const order: Record<Role, number> = {
        admin: 0,
        dnc: 1,
        dsp: 2,
      };

      list.sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3));

      setUsers(list);

      const mySession = meRef.current?.session;
      const mine = mySession ? list.find((u) => u.session === mySession) : undefined;

      if (mine) {
        setMe((prev) => {
          if (!prev) return prev;

          const next: OnlineUser = {
            ...prev,
            name: mine.name,
            role: mine.role,
            area: mine.area,
            onDuty: mine.onDuty,
            dutyTime: mine.dutyTime,
          };

          localStorage.setItem(ME_KEY, JSON.stringify(next));
          return next;
        });
      }
    });

    return off;
  }, []);

  // Восстановление своей сессии и автоматический login
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ME_KEY);
      if (!saved) return;

      const u = JSON.parse(saved) as OnlineUser;
      setMe(u);

      ws.send({
        kind: "login",
        user: toWire(u),
      });
    } catch {}
  }, []);

  const login = useCallback((name: string, role: Role, area: string, password: string): string | null => {
    if (role === "admin" && password !== ADMIN_PASSWORD) {
      return "Неверный пароль администратора";
    }

    const user: OnlineUser = {
      session: "u" + Date.now() + Math.random().toString(36).slice(2, 6),
      name,
      role,
      area,
      onDuty: false,
      dutyTime: "",
      lastSeen: Date.now(),
    };

    localStorage.setItem(ME_KEY, JSON.stringify(user));
    setMe(user);

    ws.send({
      kind: "login",
      user: toWire(user),
    });

    return null;
  }, []);

  const logout = useCallback(() => {
    const cur = meRef.current;

    if (cur) {
      ws.send({
        kind: "logout",
        session: cur.session,
      });
    }

    localStorage.removeItem(ME_KEY);
    setMe(null);
  }, []);

  const updateMe = useCallback((patch: Partial<OnlineUser>) => {
    setMe((prev) => {
      if (!prev) return prev;

      const next: OnlineUser = { ...prev, ...patch };
      localStorage.setItem(ME_KEY, JSON.stringify(next));

      ws.send({
        kind: "userPatch",
        session: next.session,
        patch: toWire(next),
      });

      return next;
    });
  }, []);

  const updateUser = useCallback((session: string, patch: Partial<OnlineUser>) => {
    ws.send({
      kind: "userPatch",
      session,
      patch,
    });
  }, []);

  return { me, users, login, logout, updateMe, updateUser };
}
