"use client";
import { useState } from "react";
import { Role, ROLE_NAMES } from "@/lib/permissions";

interface Props { onLogin: (name: string, role: Role, area: string, password: string) => string | null; }

const ORDER: Role[] = ["admin", "dnc", "dsp"];
const ICON: Record<Role, string> = { admin: "🛡", dnc: "🎛", dsp: "🏭" };

export default function LoginOverlay({ onLogin }: Props) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("dnc");
  const [area, setArea] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  const submit = () => {
    if (!name.trim()) { setErr("Введите фамилию"); return; }
    const e = onLogin(name.trim(), role, area.trim(), password);
    if (e) setErr(e);
  };

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center z-[100]">
      <div className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: "linear-gradient(#0f0 1px, transparent 1px), linear-gradient(90deg, #0f0 1px, transparent 1px)", backgroundSize: "60px 40px" }} />
      <div className="relative gid-modal w-[430px]" style={{ animation: "modal-in .25s ease-out" }}>
        <div className="gid-modal-header" style={{ cursor: "default" }}>
          <span className="gid-modal-title"><span className="dot" />ГИД Урал-ВНИИЖТ</span>
          <span className="text-[9px] text-[#555] uppercase tracking-widest">v3.1 · роли</span>
        </div>
        <div className="gid-modal-body">
          <div className="text-center mb-4">
            <div className="text-white font-bold text-sm">Вход в систему</div>
            <div className="text-[#666] text-[10px] mt-1">Выберите должность для заступления на дежурство</div>
          </div>

          <div className="gid-field"><label className="gid-label">Фамилия И.О.</label>
            <input className="gid-input" value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Иванов И.И." autoFocus /></div>

          <div className="gid-field"><label className="gid-label">Должность / роль</label>
            <div className="grid grid-cols-3 gap-1.5">
              {ORDER.map((r) => (
                <button key={r} onClick={() => setRole(r)}
                  className={`py-2 px-1 rounded border text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-all ${
                    role === r ? "border-[#0f0] bg-[#06120a] text-[#0f0] shadow-[0_0_10px_rgba(0,255,65,.2)]" : "border-[#2e2e2e] bg-[#050505] text-[#666] hover:border-[#444] hover:text-[#aaa]"
                  }`}>
                  {ICON[r]} {r === "admin" ? "Админ" : ROLE_NAMES[r].split(" ")[0]}
                </button>
              ))}
            </div>
            <div className="text-[#555] text-[9px] mt-1">{ROLE_NAMES[role]}</div>
          </div>

          {role === "admin" && (
            <div className="gid-field"><label className="gid-label">Пароль администратора</label>
              <input type="password" className="gid-input !border-[#7a1a1a]" value={password} onChange={(e) => { setPassword(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="••••••••" /></div>
          )}

          <div className="gid-field"><label className="gid-label">Участок / станция</label>
            <input className="gid-input" value={area} onChange={(e) => setArea(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Горький — Москва" /></div>

          {err && <div className="text-[#f55] text-[10px] mb-2">⚠ {err}</div>}
          <button className="gid-btn gid-btn-primary w-full !py-2.5 !text-[13px] font-bold mt-1" onClick={submit}>▶ Войти в систему</button>
        </div>
      </div>
    </div>
  );
}
