"use client";
import React, { useState } from "react";
import { Role, ROLE_NAMES } from "@/lib/permissions";

interface Props {
  onLogin: (name: string, role: Role, area: string, password: string) => Promise<string | null> | string | null;
}

const ORDER: Role[] = ["admin", "dnc", "dsp"];
const ICON: Record<Role, React.ReactNode> = {
  admin: <i className="fas fa-shield-halved" />,
  dnc: <i className="fas fa-sliders" />,
  dsp: <i className="fas fa-industry" />,
};

export default function LoginOverlay({ onLogin }: Props) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("dnc");
  const [area, setArea] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false); // <-- Добавили флаг загрузки

  const submit = async () => {
    if (!name.trim()) {
      setErr("Введите фамилию");
      return;
    }

    setLoading(true); // Блокируем кнопку

    try {
      // Ждем результат от onLogin (теперь он может быть промисом, если WS асинхронный)
      const e = await onLogin(name.trim(), role, area.trim(), password);

      if (e) {
        setErr(e);
        setLoading(false); // Разблокируем только при ошибке
      }
      // Если e === null (успех), родителю (page.tsx) нужно скрыть этот компонент.
      // Мы НЕ делаем setLoading(false) здесь при успехе, так как компонент исчезнет сразу.
    } catch (error) {
      console.error(error);
      setErr("Ошибка соединения с сервером");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center z-[100]">
      {/* Фоновая сетка */}
      <div className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: "linear-gradient(#0f0 1px, transparent 1px), linear-gradient(90deg, #0f0 1px, transparent 1px)", backgroundSize: "60px 40px" }} />

      <div className="relative gid-modal w-[430px]" style={{ animation: "modal-in .25s ease-out" }}>
        <div className="gid-modal-header" style={{ cursor: "default" }}>
          <span className="gid-modal-title"><span className="dot" />ГИД Урал-ВНИИЖТ</span>
          <span className="text-[9px] text-[#555] uppercase tracking-widest">v3.2 · auth fix</span>
        </div>

        <div className="gid-modal-body">
          <div className="text-center mb-4">
            <div className="text-white font-bold text-sm">Вход в систему</div>
            <div className="text-[#666] text-[10px] mt-1">Выберите должность для заступления на дежурство</div>
          </div>

          <div className="gid-field">
            <label className="gid-label">Фамилия И.О.</label>
            <input
              className="gid-input"
              value={name}
              onChange={(e) => { setName(e.target.value); setErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && !loading && submit()}
              placeholder="Иванов И.И."
              autoFocus
              disabled={loading}
            />
          </div>

          <div className="gid-field">
            <label className="gid-label">Должность / роль</label>
            <div className="grid grid-cols-3 gap-1.5">
              {ORDER.map((r) => (
                <button
                  key={r}
                  onClick={() => !loading && setRole(r)}
                  disabled={loading}
                  className={`py-2 px-1 rounded border text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-all ${
                    role === r
                      ? "border-[#0f0] bg-[#06120a] text-[#0f0] shadow-[0_0_10px_rgba(0,255,65,.2)]"
                      : "border-[#2e2e2e] bg-[#050505] text-[#666] hover:border-[#444] hover:text-[#aaa]"
                  }`}
                >
                  {ICON[r]} {r === "admin" ? "Админ" : ROLE_NAMES[r].split(" ")[0]}
                </button>
              ))}
            </div>
            <div className="text-[#555] text-[9px] mt-1">{ROLE_NAMES[role]}</div>
          </div>

          {role === "admin" && (
            <div className="gid-field">
              <label className="gid-label">Пароль администратора</label>
              <input
                type="password"
                className="gid-input !border-[#7a1a1a]"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErr(""); }}
                onKeyDown={(e) => e.key === "Enter" && !loading && submit()}
                placeholder="••••••••"
                disabled={loading}
              />
            </div>
          )}

          <div className="gid-field">
            <label className="gid-label">Участок / станция</label>
            <input
              className="gid-input"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && submit()}
              placeholder="Горький — Москва"
              disabled={loading}
            />
          </div>

          {err && <div className="text-[#f55] text-[10px] mb-2 animate-pulse"><i className="fas fa-triangle-exclamation" /> {err}</div>}

          <button
            className={`gid-btn gid-btn-primary w-full !py-2.5 !text-[13px] font-bold mt-1 ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
            onClick={submit}
            disabled={loading}
          >
            {loading ? <><i className="fas fa-hourglass-half" /> Подключение...</> : <><i className="fas fa-play" /> Войти в систему</>}
          </button>
        </div>
      </div>
    </div>
  );
}
