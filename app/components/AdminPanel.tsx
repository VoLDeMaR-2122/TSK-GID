"use client";
import React, { useState } from "react";
import { Station, Train, CAT_NAMES, CAT_COLORS } from "@/lib/types";
import { OnlineUser } from "@/lib/useOnlineUsers";
import { Alert } from "@/lib/useAlerts";
import { Role, ROLE_NAMES, ROLE_SHORT, can, canManageRole } from "@/lib/permissions";
import DraggableModal from "./DraggableModal";

interface Props {
  role: Role;
  actorName: string;
  stations: Station[];
  trains: Train[];
  users: OnlineUser[];
  alerts: Alert[];
  setStations: (s: Station[]) => void;
  updateUser: (session: string, patch: Partial<OnlineUser>) => void;
  addAlert: (type: Alert["type"], text: string, author: string) => void;
  toggleAlert: (id: string) => void;
  removeAlert: (id: string) => void;
  deleteTrain: (id: string) => void;
  editTrain: (id: string) => void;
  onClose: () => void;
}

type Tab = "stations" | "users" | "alerts" | "trains";
const uid = () => "s" + Math.random().toString(36).slice(2, 10);

export default function AdminPanel(p: Props) {
  const tabs: { key: Tab; label: React.ReactNode; show: boolean }[] = [
    { key: "stations", label: <><i className="fas fa-industry" /> Станции</>, show: can(p.role, "stations.manage") },
    { key: "users", label: <><i className="fas fa-users" /> Персонал</>, show: can(p.role, "users.manage_dsp") || can(p.role, "users.manage_roles") },
    { key: "alerts", label: <><i className="fas fa-bell" /> Оповещения</>, show: can(p.role, "alerts.manage") },
    { key: "trains", label: <><i className="fas fa-train" /> Поезда</>, show: can(p.role, "trains.manage") },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<Tab>(visible[0]?.key || "stations");

  // Станции
  const [stForm, setStForm] = useState({ name: "", km: "", paths: "3", code: "" });
  const [stEdit, setStEdit] = useState(-2);
  const saveStation = () => {
    if (!stForm.name) return;
    const st: Station = { id: stEdit >= 0 ? p.stations[stEdit].id : uid(), name: stForm.name, km: parseFloat(stForm.km) || 0, paths: parseInt(stForm.paths) || 1, code: stForm.code };
    p.setStations(stEdit >= 0 ? p.stations.map((s, i) => i === stEdit ? st : s) : [...p.stations, st]);
    setStEdit(-2); setStForm({ name: "", km: "", paths: "3", code: "" });
  };
  const moveSt = (i: number, d: number) => { const ni = i + d; if (ni < 0 || ni >= p.stations.length) return; const n = [...p.stations]; [n[i], n[ni]] = [n[ni], n[i]]; p.setStations(n); };

  // Оповещения
  const [alType, setAlType] = useState<Alert["type"]>("info");
  const [alText, setAlText] = useState("");
  const publishAlert = () => { if (!alText.trim()) return; p.addAlert(alType, alText.trim(), p.actorName); setAlText(""); };

  const canManageUser = (u: OnlineUser) => canManageRole(p.role, u.role);
  const isSuperAdmin = can(p.role, "users.manage_roles");

  return (
    <DraggableModal title={`Панель управления · ${ROLE_SHORT[p.role]}`} width={720} minH={420} onClose={p.onClose}
      footer={<button className="gid-btn" onClick={p.onClose}>Закрыть</button>}>

      <div className="flex gap-1 mb-3 border-b border-[#222] pb-2">
        {visible.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-[11px] font-bold cursor-pointer transition-all ${tab === t.key ? "bg-[#06120a] border border-[#0a7a2a] text-[#0f0]" : "text-[#666] hover:text-[#aaa] hover:bg-[#181818]"}`}>
            {t.label}
          </button>
        ))}
        {visible.length === 0 && <div className="text-[#555] text-[11px] py-2">Нет доступных разделов</div>}
      </div>

      {/* СТАНЦИИ */}
      {tab === "stations" && can(p.role, "stations.manage") && (
        <div>
          <div className="border border-[#2a2a2a] overflow-hidden mb-3">
            <div className="max-h-[260px] overflow-y-auto">
              <table className="gid-table">
                <thead><tr><th>№</th><th>Название</th><th>Км</th><th>Пути</th><th>Код</th><th></th></tr></thead>
                <tbody>
                  {p.stations.map((s, i) => (
                    <tr key={s.id}>
                      <td className="text-[#555]">{i + 1}</td>
                      <td className="font-bold text-[#ddd]">{s.name}</td>
                      <td>{s.km}</td><td className="text-center">{s.paths}</td><td className="text-[#666]">{s.code}</td>
                      <td className="whitespace-nowrap text-right">
                        <button className="gid-btn gid-btn-sm mr-1" onClick={() => moveSt(i, -1)}>↑</button>
                        <button className="gid-btn gid-btn-sm mr-1" onClick={() => moveSt(i, 1)}>↓</button>
                        <button className="gid-btn gid-btn-sm gid-btn-info mr-1" onClick={() => { setStEdit(i); setStForm({ name: s.name, km: String(s.km), paths: String(s.paths), code: s.code }); }}><i className="fas fa-pen" /></button>
                        <button className="gid-btn gid-btn-sm gid-btn-danger" onClick={() => p.setStations(p.stations.filter((_, x) => x !== i))}><i className="fas fa-xmark" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <button className="gid-btn gid-btn-primary" onClick={() => { setStEdit(-1); setStForm({ name: "", km: "", paths: "3", code: "" }); }}>＋ Добавить станцию</button>
          {stEdit !== -2 && (
            <div className="mt-3 border border-[#0a4a24] bg-[#06120a] p-3">
              <div className="gid-grid2">
                <div className="gid-field"><label className="gid-label">Название</label><input className="gid-input" value={stForm.name} onChange={(e) => setStForm({ ...stForm, name: e.target.value })} autoFocus /></div>
                <div className="gid-field"><label className="gid-label">Километр</label><input className="gid-input" value={stForm.km} onChange={(e) => setStForm({ ...stForm, km: e.target.value })} /></div>
                <div className="gid-field"><label className="gid-label">Кол-во путей</label><input className="gid-input" value={stForm.paths} onChange={(e) => setStForm({ ...stForm, paths: e.target.value })} /></div>
                <div className="gid-field"><label className="gid-label">Код ЕСР</label><input className="gid-input" value={stForm.code} onChange={(e) => setStForm({ ...stForm, code: e.target.value })} /></div>
              </div>
              <div className="flex gap-2 mt-1"><button className="gid-btn gid-btn-primary" onClick={saveStation}><i className="fas fa-floppy-disk" /> Сохранить</button><button className="gid-btn" onClick={() => setStEdit(-2)}>Отмена</button></div>
            </div>
          )}
        </div>
      )}

      {/* ПЕРСОНАЛ */}
      {tab === "users" && (can(p.role, "users.manage_dsp") || isSuperAdmin) && (
        <div>
          <div className="text-[10px] text-[#666] mb-2">
            {isSuperAdmin
              ? "Администратор: назначайте роли и управляйте дежурством любого сотрудника."
              : "ДНЦ: вы управляете дежурством дежурных по станциям (ДСП). Смену ролей выполняет администратор."}
          </div>
          <div className="border border-[#2a2a2a] overflow-hidden">
            <div className="max-h-[320px] overflow-y-auto">
              <table className="gid-table">
                <thead><tr><th>ФИО</th><th>Роль</th><th>Участок</th><th>Дежурство</th><th></th></tr></thead>
                <tbody>
                  {p.users.map((u) => {
                    const isMe = u.name === p.actorName;
                    const editable = canManageUser(u) && !isMe;
                    return (
                      <tr key={u.session} className={isMe ? "bg-[#0a140a]" : ""}>
                        <td className="font-bold text-[#ddd]">{u.name}{isMe && <i className="fas fa-star text-[#0f0] text-[10px] ml-1" />}</td>
                        <td>
                          {isSuperAdmin && editable ? (
                            <select className="gid-select !w-auto !py-0.5" value={u.role} onChange={(e) => p.updateUser(u.session, { role: e.target.value as Role })}>
                              {(Object.keys(ROLE_NAMES) as Role[]).map((r) => <option key={r} value={r}>{ROLE_SHORT[r]}</option>)}
                            </select>
                          ) : (
                            <span className={`font-bold ${u.role === "admin" ? "text-[#f8f]" : u.role === "dnc" ? "text-[#fc6]" : "text-[#6f6]"}`}>{ROLE_SHORT[u.role]}</span>
                          )}
                        </td>
                        <td className="text-[#999]">{u.area || "—"}</td>
                        <td><span className={`gid-chip ${u.onDuty ? "gid-chip-dsp" : "gid-chip-op"}`}>{u.onDuty ? "● на дежурстве" : "○ свободен"}</span></td>
                        <td className="text-right whitespace-nowrap">
                          {editable && (
                            <button className="gid-btn gid-btn-sm"
                              onClick={() => p.updateUser(u.session, { onDuty: !u.onDuty, dutyTime: !u.onDuty ? new Date().toTimeString().slice(0, 5) : "" })}>
                              {u.onDuty ? "Снять" : "Назначить"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {p.users.length === 0 && <tr><td colSpan={5} className="text-center text-[#555] py-6">Нет активных пользователей</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ОПОВЕЩЕНИЯ */}
      {tab === "alerts" && can(p.role, "alerts.manage") && (
        <div>
          <div className="flex gap-2 mb-3">
            <select className="gid-select !w-auto" value={alType} onChange={(e) => setAlType(e.target.value as Alert["type"])}>
              <option value="info"><i className="fas fa-circle-info" /> Инфо</option><option value="warning"><i className="fas fa-triangle-exclamation" /> Внимание</option><option value="critical"><i className="fas fa-circle-exclamation" /> Критично</option>
            </select>
            <input className="gid-input flex-1" value={alText} onChange={(e) => setAlText(e.target.value)} placeholder="Текст оповещения для всех..." onKeyDown={(e) => { if (e.key === "Enter") publishAlert(); }} />
            <button className="gid-btn gid-btn-primary" onClick={publishAlert}>Опубликовать</button>
          </div>
          <div className="border border-[#2a2a2a] overflow-hidden">
            <div className="max-h-[300px] overflow-y-auto">
              {p.alerts.length === 0 ? <div className="text-center text-[#555] py-6">Оповещений нет</div> : (
                <table className="gid-table">
                  <thead><tr><th>Тип</th><th>Текст</th><th>Автор</th><th>Время</th><th>Статус</th><th></th></tr></thead>
                  <tbody>
                    {p.alerts.map((a) => (
                      <tr key={a.id}>
                        <td>{a.type === "critical" ? <i className="fas fa-circle-exclamation" /> : a.type === "warning" ? <i className="fas fa-triangle-exclamation" /> : <i className="fas fa-circle-info" />}</td>
                        <td className="text-[#ddd]">{a.text}</td>
                        <td className="text-[#888]">{a.author}</td>
                        <td className="text-[#666] font-mono text-[10px]">{new Date(a.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</td>
                        <td><span className={`gid-chip ${a.active ? "gid-chip-dsp" : "gid-chip-op"}`}>{a.active ? "активно" : "скрыто"}</span></td>
                        <td className="text-right whitespace-nowrap">
                          <button className="gid-btn gid-btn-sm mr-1" onClick={() => p.toggleAlert(a.id)}>{a.active ? "Скрыть" : "Вкл"}</button>
                          <button className="gid-btn gid-btn-sm gid-btn-danger" onClick={() => p.removeAlert(a.id)}><i className="fas fa-xmark" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ПОЕЗДА */}
      {tab === "trains" && can(p.role, "trains.manage") && (
        <div className="border border-[#2a2a2a] overflow-hidden">
          <div className="max-h-[340px] overflow-y-auto">
            <table className="gid-table">
              <thead><tr><th>№</th><th>Категория</th><th>Локомотив</th><th>Машинист</th><th>Станций</th><th></th></tr></thead>
              <tbody>
                {p.trains.map((t) => (
                  <tr key={t.id}>
                    <td className="font-bold" style={{ color: CAT_COLORS[t.category] || "#888" }}>{t.number}</td>
                    <td>{CAT_NAMES[t.category] || t.category}</td>
                    <td className="text-[#999]">{t.locoSeries} {t.locoNum}</td>
                    <td>{t.driver || "—"}</td>
                    <td className="text-center text-[#666]">{t.stops.length}</td>
                    <td className="text-right whitespace-nowrap">
                      <button className="gid-btn gid-btn-sm gid-btn-info mr-1" onClick={() => { p.editTrain(t.id); p.onClose(); }}><i className="fas fa-pen" /></button>
                      <button className="gid-btn gid-btn-sm gid-btn-danger" onClick={() => p.deleteTrain(t.id)}><i className="fas fa-trash-can" /></button>
                    </td>
                  </tr>
                ))}
                {p.trains.length === 0 && <tr><td colSpan={6} className="text-center text-[#555] py-6">Нет поездов</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </DraggableModal>
  );
}
