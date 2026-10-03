"use client";
import React, { useState } from "react";

interface Props {
  /** Вход по учётной записи. Возвращает текст ошибки или null при успехе. */
  onLogin: (login: string, password: string) => Promise<string | null> | string | null;
  /** Версия ГИДа — приходит из главного файла app/page.tsx (GID_VERSION) */
  version?: string;
}

export default function LoginOverlay({ onLogin, version }: Props) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    // Кнопки не блокируются disabled: при зависшем ответе диспетчер
    // должен иметь возможность повторить попытку.
    if (loading) return;

    if (!login.trim()) {
      setErr("Введите логин");
      return;
    }
    if (!password) {
      setErr("Введите пароль");
      return;
    }

    setLoading(true);
    setErr("");

    try {
      const e = await onLogin(login.trim(), password);
      if (e) {
        setErr(e);
      }
      setLoading(false);
    } catch (error) {
      console.error(error);
      setErr("Ошибка соединения с сервером");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black p-4">
      {/* Фоновая сетка */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(#0f0 1px, transparent 1px), linear-gradient(90deg, #0f0 1px, transparent 1px)",
          backgroundSize: "60px 40px",
        }}
      />

      <div
        className="gid-modal relative m-auto w-[430px] max-w-[calc(100vw-2rem)]"
        style={{ animation: "modal-in .25s ease-out" }}
      >
        <div className="gid-modal-header" style={{ cursor: "default" }}>
          <span className="gid-modal-title"><span className="dot" />ГИД Урал-ВНИИЖТ</span>
          <span className="text-[9px] text-[#5a5a5a] tracking-widest">{version}</span>
        </div>

        <div className="gid-modal-body">
          <div className="text-center mb-4">
            <div className="text-white font-bold text-sm">Вход в систему</div>
            <div className="text-[#666] text-[10px] mt-1">
              Логин и пароль выдаёт администратор участка
            </div>
          </div>

          <div className="gid-field">
            <label className="gid-label">ЛОГИН (Ф.И.О.)</label>
            <input
              className="gid-input"
              value={login}
              onChange={(e) => { setLogin(e.target.value); setErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Иванов И.И."
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="gid-field">
            <label className="gid-label">ПАРОЛЬ</label>
            <input
              type="password"
              className="gid-input"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          {err && (
            <div className="text-[#f55] text-[10px] mb-2 animate-pulse">
              <i className="fas fa-triangle-exclamation" /> {err}
            </div>
          )}

          <button
            type="button"
            className={`gid-btn gid-btn-primary w-full !py-2.5 !text-[13px] font-bold mt-1 ${
              loading ? "opacity-70" : ""
            }`}
            onClick={submit}
          >
            {loading ? (
              <><i className="fas fa-hourglass-half" /> Проверка…</>
            ) : (
              <><i className="fas fa-play" /> Войти в систему</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
