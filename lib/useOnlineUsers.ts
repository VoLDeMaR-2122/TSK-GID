"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Role, ADMIN_PASSWORD } from "./permissions";

export interface OnlineUser {
  session: string;
  name: string;
  role: Role;
  area: string;
  onDuty: boolean;
  dutyTime: string;
  lastSeen: number;
}

const USERS_KEY = "gid_users";
const ME_KEY = "gid_user";

function readUsers(): Record<string, OnlineUser> {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) || "{}"); } catch { return {}; }
}
function writeUsers(u: Record<string, OnlineUser>) {
  localStorage.setItem(USERS_KEY, JSON.stringify(u));
}

export function useOnlineUsers() {
  const [me, setMe] = useState<OnlineUser | null>(null);
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const meRef = useRef<OnlineUser | null>(null);
  meRef.current = me;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(ME_KEY);
      if (saved) setMe(JSON.parse(saved));
    } catch {}
  }, []);

  const refresh = useCallback(() => {
    const all = readUsers();
    const now = Date.now();
    const active = Object.values(all).filter((u) => now - u.lastSeen < 60000);
    const order: Record<Role, number> = { admin: 0, dnc: 1, dsp: 2 };
    active.sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3));
    setUsers(active);
  }, []);

  useEffect(() => {
    refresh();
    const onStorage = (e: StorageEvent) => { if (e.key === USERS_KEY) refresh(); };
    window.addEventListener("storage", onStorage);
    const iv = setInterval(refresh, 5000);
    return () => { window.removeEventListener("storage", onStorage); clearInterval(iv); };
  }, [refresh]);

  useEffect(() => {
    if (!me) return;
    const beat = () => {
      const all = readUsers();
      all[me.session] = { ...me, lastSeen: Date.now() };
      writeUsers(all);
      refresh();
    };
    beat();
    const iv = setInterval(beat, 10000);
    const onUnload = () => { const all = readUsers(); delete all[me.session]; writeUsers(all); };
    window.addEventListener("beforeunload", onUnload);
    return () => { clearInterval(iv); window.removeEventListener("beforeunload", onUnload); };
  }, [me, refresh]);

  const login = (name: string, role: Role, area: string, password: string): string | null => {
    if (role === "admin" && password !== ADMIN_PASSWORD) return "Неверный пароль администратора";
    const user: OnlineUser = {
      session: "u" + Date.now() + Math.random().toString(36).slice(2, 6),
      name, role, area, onDuty: false, dutyTime: "", lastSeen: Date.now(),
    };
    localStorage.setItem(ME_KEY, JSON.stringify(user));
    const all = readUsers();
    all[user.session] = user;
    writeUsers(all);
    setMe(user);
    refresh();
    return null;
  };

  const logout = () => {
    if (me) { const all = readUsers(); delete all[me.session]; writeUsers(all); }
    localStorage.removeItem(ME_KEY);
    setMe(null);
    refresh();
  };

  const updateMe = (patch: Partial<OnlineUser>) => {
    setMe((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      localStorage.setItem(ME_KEY, JSON.stringify(next));
      const all = readUsers();
      all[next.session] = { ...next, lastSeen: Date.now() };
      writeUsers(all);
      refresh();
      return next;
    });
  };

  const updateUser = (session: string, patch: Partial<OnlineUser>) => {
    const all = readUsers();
    if (!all[session]) return;
    all[session] = { ...all[session], ...patch, lastSeen: Date.now() };
    writeUsers(all);
    if (me && me.session === session) { setMe(all[session]); localStorage.setItem(ME_KEY, JSON.stringify(all[session])); }
    refresh();
  };

  return { me, users, login, logout, updateMe, updateUser };
}
