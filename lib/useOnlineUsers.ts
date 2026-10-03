"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Role, Capabilities } from "./permissions";
import { ws } from "./ws"; // Твой единый сокет-клиент

export interface OnlineUser {
  session: string;
  name: string;
  role: Role;
  area: string;
  onDuty: boolean;
  dutyTime: string;
  lastSeen?: number;
  /** Признак входа под паролем администратора — присваивает сервер. */
  isAdmin?: boolean;
  /** Логин учётной записи. Роль и права приходят из неё, не из клиента. */
  personLogin?: string;
}

/** Учётная запись для панели администратора. Хеша пароля здесь нет и не бывает. */
export interface PersonAccount {
  login: string;
  name: string;
  role: Role;
  isAdmin: boolean;
  active: boolean;
  /** Владелец из переменных окружения — панелью не трогается. */
  protected: boolean;
  createdAt: number;
  createdBy: string;
}

/** Матрица прав ролей с сервера для редактора. */
export interface RolesData {
  actions: string[];
  roles: Record<string, string[]>;
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

export interface AuditEntry {
  id: string;
  ts: number;
  actor: string;
  action: string;
  target?: string;
  detail?: string;
}

export function useOnlineUsers() {
  const [me, setMe] = useState<OnlineUser | null>(null);
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  // Права присылает сервер после проверки пароля. Локально они не вычисляются.
  const [caps, setCaps] = useState<Capabilities | null>(null);
  // Признак входа с паролем админа — тоже серверный.
  const [isAdmin, setIsAdmin] = useState(false);
  // Список учётных записей присылает сервер администратору.
  const [accounts, setAccounts] = useState<PersonAccount[]>([]);
  // Матрица прав ролей присылает сервер администратору.
  const [rolesData, setRolesData] = useState<RolesData | null>(null);
  // Обратная связь по операциям с сотрудниками: ошибки и подтверждения.
  // Без этого отказы сервера (authError/forbidden) терялись бы молча,
  // если в момент ответа не ожидался вход.
  const [opError, setOpError] = useState("");
  const [opNotice, setOpNotice] = useState("");

  const meRef = useRef<OnlineUser | null>(null);
  useEffect(() => { meRef.current = me; }, [me]);

  // Ожидающий ответа сервера на вход — чтобы показать ошибку пароля.
  const authWaiterRef = useRef<((err: string | null) => void) | null>(null);

  // Сервер отвечает на login либо loginOk (успех), либо authError (отказ).
  useEffect(() => {
    const offOk = ws.on("loginOk", (m) => {
      const user = m.user as OnlineUser | undefined;
      if (!user?.session) return;
      localStorage.setItem(ME_KEY, JSON.stringify(user));
      setMe(user);
      authWaiterRef.current?.(null);
      authWaiterRef.current = null;
    });

    const offCaps = ws.on("capabilities", (m) => {
      const list = (m.caps ?? []) as Capabilities;
      setCaps(list);
      setIsAdmin(m.isAdmin === true);
      // Администратору сразу подтягиваем список сотрудников и матрицу прав.
      if ((list as readonly string[]).includes("users.manage_roles")) {
        ws.send({ kind: "accountsList" });
        ws.send({ kind: "rolesList" });
      }
    });

    const offAuth = ws.on("authError", (m) => {
      const msg = typeof m.message === "string" ? m.message : "Вход не разрешён";
      if (authWaiterRef.current) {
        authWaiterRef.current(msg);
        authWaiterRef.current = null;
      } else {
        // Ошибка операции (например, создание сотрудника), а не входа.
        setOpError(msg);
        setOpNotice("");
      }
    });

    // Сеанс мог быть отключён админом — возвращаем форму входа.
    const offExpired = ws.on("sessionExpired", () => {
      localStorage.removeItem(ME_KEY);
      setMe(null);
      setCaps(null);
      setIsAdmin(false);
    });

    // Ответы сервера на действия администратора.
    const offNotice = ws.on("notice", (m) => {
      if (typeof m.message === "string") {
        setOpNotice(m.message);
        setOpError("");
      }
    });

    const offAccounts = ws.on("accounts", (m) => {
      const raw = (m.accounts ?? []) as Record<string, unknown>[];
      setAccounts(
        raw.map((a) => ({
          login: String(a.login ?? ""),
          name: String(a.name ?? ""),
          role: String(a.role ?? "dsp") as Role,
          isAdmin: a.isAdmin === true,
          active: a.active !== false,
          protected: a.protected === true,
          createdAt: Number(a.createdAt) || 0,
          createdBy: String(a.createdBy ?? ""),
        })),
      );
    });

    const offRoles = ws.on("roles", (m) => {
      const actions = Array.isArray(m.actions) ? m.actions.map(String) : [];
      const roles: Record<string, string[]> = {};
      const raw = (m.roles ?? {}) as Record<string, unknown>;
      for (const [role, caps] of Object.entries(raw)) {
        roles[role] = Array.isArray(caps) ? caps.map(String) : [];
      }
      setRolesData({ actions, roles });
    });

    const offForbidden = ws.on("forbidden", (m) => {
      const msg = typeof m.message === "string" ? m.message : "Недостаточно прав";
      setOpError(msg);
      setOpNotice("");
    });

    return () => {
      offOk();
      offCaps();
      offAuth();
      offExpired();
      offNotice();
      offAccounts();
      offRoles();
      offForbidden();
    };
  }, []);

  // 1. Инициализация сокета и слушатели
  useEffect(() => {
    ws.init();

    // Слушаем приветствие от сервера — это сигнал, что канал открыт
    const offHello = ws.on("hello", () => {
      console.log("[WS] Connected and ready");

      // Сохранённую сессию продлеваем без повторного ввода пароля —
      // сервер сам проверит, что она живая и учётка активна.
      try {
        const saved = localStorage.getItem(ME_KEY);
        if (saved) {
          const u = JSON.parse(saved) as OnlineUser;
          if (u?.session) {
            ws.send({ kind: "resume", session: u.session });
          }
        }
      } catch {}
    });

    // Слушаем журнал аудита
    const offAudit = ws.on("audit", (m) => {
      const raw = (m.audit ?? []) as Record<string, unknown>[];
      const list: AuditEntry[] = raw.map((a) => ({
        id: String(a.id),
        ts: Number(a.ts),
        actor: String(a.actor),
        action: String(a.action),
        target: a.target ? String(a.target) : undefined,
        detail: a.detail ? String(a.detail) : undefined,
      }));
      setAudit(list);
    });

    // Слушаем список пользователей (presence)
    const offPresence = ws.on("presence", (m) => {
      const raw = (m.users ?? []) as Record<string, unknown>[];
      const list: OnlineUser[] = raw.map((u) => ({
        session: String(u.session),
        name: String(u.name ?? ""),
        role: String(u.role ?? "dsp") as Role,
        area: String(u.area ?? ""),
        onDuty: Boolean(u.onDuty),
        dutyTime: String(u.dutyTime ?? ""),
        lastSeen: Date.now(),
        isAdmin: Boolean(u.isAdmin),
        personLogin: u.personLogin ? String(u.personLogin) : undefined,
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
      offAudit();
      offPresence();
    };
  }, []);

  // 2. ВХОД. Логин и пароль уходят на сервер; роль он определяет сам
  // по учётной записи — выбрать её на клиенте нельзя.
  const login = useCallback(
    (loginName: string, password: string): Promise<string | null> => {
      return new Promise<string | null>((resolve) => {
        // Ждём вердикта сервера. Если он не придёт — снимаем ожидание по таймауту,
        // чтобы форма не висела вечно.
        const timer = setTimeout(() => {
          authWaiterRef.current = null;
          resolve("Нет ответа от сервера");
        }, 8000);

        authWaiterRef.current = (err) => {
          clearTimeout(timer);
          // При отказе сессию не сохраняем: профиль придёт только от сервера.
          resolve(err);
        };

        // Если сокет ещё не готов, сообщение встанет в очередь и уйдёт при открытии.
        ws.send({ kind: "login", login: loginName, password });
      });
    },
    [],
  );

  // 3. ВЫХОД
  const logout = useCallback(() => {
    const cur = meRef.current;
    if (cur) {
      ws.send({ kind: "logout" });
    }
    localStorage.removeItem(ME_KEY);
    setMe(null);
    setUsers([]);
    setCaps(null);
    setIsAdmin(false);
    setAccounts([]);
    setRolesData(null);
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

  // 6. УЧЁТНЫЕ ЗАПИСИ. Заводит и меняет только администратор,
  //    но проверку всё равно делает сервер — клиент лишь отправляет команду.
  const createAccount = useCallback(
    (loginName: string, name: string, password: string, role: Role) => {
      ws.send({ kind: "accountCreate", login: loginName, name, password, role });
    },
    [],
  );

  const patchAccount = useCallback(
    (loginName: string, patch: { name?: string; role?: Role; active?: boolean }) => {
      ws.send({ kind: "accountPatch", login: loginName, ...patch });
    },
    [],
  );

  const resetAccountPassword = useCallback((loginName: string, password: string) => {
    ws.send({ kind: "accountSetPassword", login: loginName, password });
  }, []);

  const changeOwnPassword = useCallback((current: string, next: string) => {
    ws.send({ kind: "passwordChange", current, next });
  }, []);

  const refreshAccounts = useCallback(() => {
    setOpError("");
    ws.send({ kind: "accountsList" });
  }, []);

  const clearOpFeedback = useCallback(() => {
    setOpError("");
    setOpNotice("");
  }, []);

  // 7. МАТРИЦА ПРАВ. Редактирует только администратор,
  //    проверка и применение — на сервере.
  const refreshRoles = useCallback(() => {
    setOpError("");
    ws.send({ kind: "rolesList" });
  }, []);

  const setRoleCaps = useCallback((role: string, caps: string[]) => {
    ws.send({ kind: "rolesSet", role, caps });
  }, []);

  return {
    me,
    users,
    audit,
    caps,
    isAdmin,
    accounts,
    rolesData,
    opError,
    opNotice,
    login,
    logout,
    updateMe,
    updateUser,
    createAccount,
    patchAccount,
    resetAccountPassword,
    changeOwnPassword,
    refreshAccounts,
    refreshRoles,
    setRoleCaps,
    clearOpFeedback,
  };
}
