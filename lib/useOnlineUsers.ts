"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Role, ADMIN_PASSWORD } from "./permissions";
import { ws } from "./ws"; // Твой единый сокет-клиент

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

// Хелпер для преобразования в формат сервера
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

  // Флаг: получили ли мы подтверждение от сервера ("hello")
  const [isWsReady, setIsWsReady] = useState(false);

  const meRef = useRef<OnlineUser | null>(null);
  meRef.current = me;

  // 1. Инициализация сокета и слушатели
  useEffect(() => {
    ws.init();

    // Слушаем приветствие от сервера — это сигнал, что канал открыт
    const offHello = ws.on("hello", () => {
      console.log("[WS] Connected and ready");
      setIsWsReady(true);

      // Если у нас уже есть сохраненная сессия в localStorage,
      // пробуем восстановить её через сервер сейчас же
      try {
        const saved = localStorage.getItem(ME_KEY);
        if (saved) {
          const u = JSON.parse(saved) as OnlineUser;
          // Отправляем login только если сокет готов
          ws.send({ kind: "login", user: toWire(u) });
        }
      } catch {}
    });

    // Слушаем список пользователей (presence)
    const offPresence = ws.on("presence", (m: any) => {
      const list: OnlineUser[] = (m.users || []).map((u: any) => ({
        session: String(u.session),
        name: String(u.name || ""),
        role: String(u.role || "dsp") as Role,
        area: String(u.area || ""),
        onDuty: Boolean(u.onDuty),
        dutyTime: String(u.dutyTime || ""),
        lastSeen: Date.now(),
      }));

      // Сортировка по ролям
      const order: Record<Role, number> = { admin: 0, dnc: 1, dsp: 2 };
      list.sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3));
      setUsers(list);

      // Обновляем свою мету, если нашли себя в списке
      const mySession = meRef.current?.session;
      if (mySession) {
        const mine = list.find((u) => u.session === mySession);
        if (mine) {
          setMe((prev) => {
            if (!prev) return prev;
            const next = { ...prev, role: mine.role, area: mine.area, onDuty: mine.onDuty, dutyTime: mine.dutyTime };
            localStorage.setItem(ME_KEY, JSON.stringify(next));
            return next;
          });
        }
      }
    });

    return () => {
      offHello();
      offPresence();
    };
  }, []);

  // 2. Функция ЛОГИНА (вызывается из кнопки)
  const login = useCallback((name: string, role: Role, area: string, password: string): string | null => {
    // Проверка пароля админа (локальная, для UX)
    if (role === "admin" && password !== ADMIN_PASSWORD) {
      return "Неверный пароль администратора";
    }

    // Создаем объект пользователя
    const user: OnlineUser = {
      session: "u" + Date.now() + Math.random().toString(36).slice(2, 6),
      name,
      role,
      area,
      onDuty: false,
      dutyTime: "",
      lastSeen: Date.now(),
    };

    // Сохраняем локально сразу (для восстановления при перезагрузке)
    localStorage.setItem(ME_KEY, JSON.stringify(user));
    setMe(user); // Оптимистичное обновление UI

    // ВАЖНО: Отправляем логин на сервер ТОЛЬКО если сокет готов
    if (isWsReady) {
      ws.send({ kind: "login", user: toWire(user) });
    } else {
      console.warn("[Login] WS not ready yet. Message queued.");
      // Если сокет не готов, ws.send внутри положит сообщение в очередь
      // и отправит его автоматически, когда соединение установится.
      ws.send({ kind: "login", user: toWire(user) });
    }

    return null; // Успех
  }, [isWsReady]);

  // 3. ВЫХОД
  const logout = useCallback(() => {
    const cur = meRef.current;
    if (cur) {
      ws.send({ kind: "logout", session: cur.session });
    }
    localStorage.removeItem(ME_KEY);
    setMe(null);
    setUsers([]);
  }, []);

  // 4. ОБНОВЛЕНИЕ СЕБЯ (дежурство и т.д.)
  const updateMe = useCallback((patch: Partial<OnlineUser>) => {
    setMe((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      localStorage.setItem(ME_KEY, JSON.stringify(next));
      ws.send({
        kind: "userPatch",
        session: next.session,
        patch: toWire(next)
      });
      return next;
    });
  }, []);

  // 5. ОБНОВЛЕНИЕ ДРУГОГО ПОЛЬЗОВАТЕЛЯ (админ/ДНЦ меняет ДСП)
  const updateUser = useCallback((session: string, patch: Partial<OnlineUser>) => {
    ws.send({ kind: "userPatch", session, patch });
  }, []);

  return { me, users, login, logout, updateMe, updateUser };
}
