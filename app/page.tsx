"use client";
import { useEffect, useRef, useState } from "react";
import { useGidState } from "@/lib/useGidState";
import { useOnlineUsers } from "@/lib/useOnlineUsers";
import { useAlerts } from "@/lib/useAlerts";
import { ws } from "@/lib/ws";
import { Train, Mark } from "@/lib/types";
import { Role, ROLE_SHORT, can } from "@/lib/permissions";
import { GidSaves } from "@/app/components/GidSaves";
import TrainGraph from "@/app/components/TrainGraph";
import RightPanel from "@/app/components/RightPanel";
import TrainModal from "@/app/components/TrainModal";
import StationModal from "@/app/components/StationModal";
import MarkModal from "@/app/components/MarkModal";
import SearchModal from "@/app/components/SearchModal";
import LoginOverlay from "@/app/components/LoginOverlay";
import DutyModal from "@/app/components/DutyModal";
import HelpModal from "@/app/components/HelpModal";
import AdminPanel from "@/app/components/AdminPanel";
import StatsModal from "@/app/components/StatsModal";
import DraggableModal from "@/app/components/DraggableModal";
import Dropdown from "@/app/components/Dropdown";

export default function GidUralPage() {
  const { state, setState, resetData } = useGidState();
  const { me, users, audit, login, logout, updateMe, updateUser } = useOnlineUsers();
  const { alerts, addAlert, toggleAlert, removeAlert } = useAlerts();
  const importRef = useRef<HTMLInputElement>(null);

  // --- Состояния модалок ---
  const [trainModal, setTrainModal] = useState<{ open: boolean; edit: Train | null; pi?: number; pm?: number }>({ open: false, edit: null });
  const [stationOpen, setStationOpen] = useState(false);
  const [markModal, setMarkModal] = useState<{ open: boolean; edit: Mark | null }>({ open: false, edit: null });
  const [searchOpen, setSearchOpen] = useState(false);
  const [dutyOpen, setDutyOpen] = useState<Role | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [scrollTarget, setScrollTarget] = useState<{ id: string; ts: number } | null>(null);
  const [clock, setClock] = useState(new Date());

  // Таймер часов
  useEffect(() => {
    const iv = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  const role: Role | undefined = me?.role;
  const isAdmin = me?.isAdmin === true;
  const activeAlerts = alerts.filter((a) => a.active);
  const critical = activeAlerts.filter((a) => a.type === "critical");

  // --- Логика Поездов ---
  const openNew = () => { if (can(role, "trains.manage", isAdmin)) setTrainModal({ open: true, edit: null }); };
  const openNewAt = (pi: number, pm: number) => { if (can(role, "trains.manage", isAdmin)) setTrainModal({ open: true, edit: null, pi, pm }); };
  const openEditTrain = (id: string) => { if (can(role, "trains.manage", isAdmin)) setTrainModal({ open: true, edit: state.trains.find((t) => t.id === id) || null }); };

  const saveTrain = (train: Train) => {
    setState((p) => ({ ...p, trains: p.trains.some((t) => t.id === train.id) ? p.trains.map((t) => t.id === train.id ? train : t) : [...p.trains, train], selected: { type: "train", id: train.id } }));
    setTrainModal({ open: false, edit: null });
  };

  const deleteTrain = (id: string) => {
    setState((p) => ({ ...p, trains: p.trains.filter((t) => t.id !== id), selected: null }));
    setTrainModal({ open: false, edit: null });
  };

  // Отметка времени ДСП
  const setStopField = (trainId: string, stopIndex: number, field: "arr" | "dep" | "path", value: string | number) => {
    if (!can(role, "trains.mark", isAdmin)) return;
    setState((p) => ({ ...p, trains: p.trains.map((tr) => tr.id !== trainId ? tr : { ...tr, stops: tr.stops.map((s, i) => i === stopIndex ? { ...s, [field]: value } : s ) }) }));
  };

  const markNow = (trainId: string, stopIndex: number, field: "arr" | "dep") => {
    if (!can(role, "trains.mark", isAdmin)) return;
    const now = new Date();
    setStopField(trainId, stopIndex, field, String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0"));
  };

  // --- Логика Пометок ---
  const openNewMark = () => { if (can(role, "marks.manage", isAdmin)) setMarkModal({ open: true, edit: null }); };
  const openEditMark = (id: string) => { if (can(role, "marks.manage", isAdmin)) setMarkModal({ open: true, edit: state.marks.find((m) => m.id === id) || null }); };

  const saveMark = (mark: Mark) => {
    setState((p) => ({ ...p, marks: p.marks.some((m) => m.id === mark.id) ? p.marks.map((m) => m.id === mark.id ? mark : m) : [...p.marks, mark], selected: { type: "mark", id: mark.id } }));
    setMarkModal({ open: false, edit: null });
  };

  const deleteMark = (id: string) => {
    setState((p) => ({ ...p, marks: p.marks.filter((m) => m.id !== id), selected: null }));
    setMarkModal({ open: false, edit: null });
  };

  const deleteSelected = () => {
    if (state.selected?.type === "train" && can(role, "trains.manage", isAdmin)) deleteTrain(state.selected.id);
    else if (state.selected?.type === "mark" && can(role, "marks.manage", isAdmin)) deleteMark(state.selected.id);
  };

  const selectFromSearch = (id: string) => { setState((p) => ({ ...p, selected: { type: "train", id } })); setScrollTarget({ id, ts: Date.now() }); };

  // Экспорт/Импорт
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ stations: state.stations, trains: state.trains, marks: state.marks }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gid_ural_export.json";
    a.click();
  };

  const importJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
      try {
        const o = JSON.parse(ev.target!.result as string);
        setState((p) => ({ ...p, stations: o.stations || p.stations, trains: o.trains || p.trains, marks: o.marks || p.marks }));
      } catch { alert("Неверный JSON"); }
    };
    r.readAsText(f);
    e.target.value = "";
  };

  // Хоткеи
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      switch (e.key) {
        case "F1": e.preventDefault(); setHelpOpen(true); break;
        case "F2": e.preventDefault(); openNew(); break;
        case "F3": e.preventDefault(); if (can(role, "stations.manage", isAdmin)) setStationOpen(true); break;
        case "F4": e.preventDefault(); setDutyOpen(role || "dnc"); break;
        case "F5": e.preventDefault(); openNewMark(); break;
        case "F6": e.preventDefault(); if (can(role, "admin.panel", isAdmin)) setAdminOpen(true); break;
        case "F7": e.preventDefault(); if (can(role, "stats.view", isAdmin)) setStatsOpen(true); break;
        case "Delete": e.preventDefault(); deleteSelected(); break;
        case "Escape":
          setTrainModal({ open: false, edit: null });
          setMarkModal({ open: false, edit: null });
          setStationOpen(false);
          setSearchOpen(false);
          setDutyOpen(null);
          setHelpOpen(false);
          setAdminOpen(false);
          setStatsOpen(false);
          setAlertsOpen(false);
          setOnlineOpen(false);
          setAuditOpen(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.selected, me, role]);

  const setHoursVisible = (v: number) => setState((p) => ({ ...p, view: { ...p.view, hoursVisible: v } }));
  const select = (selected: { type: string; id: string } | null) => setState((p) => ({ ...p, selected }));
  const toggle = (k: "showNumbers" | "showTimeMarks") => setState((p) => ({ ...p, [k]: !p[k] }));

  const adminList = users.filter((u) => u.role === "admin" && u.onDuty);
  const dncList = users.filter((u) => u.role === "dnc" && u.onDuty);
  const dspList = users.filter((u) => u.role === "dsp" && u.onDuty);
  const chipCls = (r: Role) => r === "admin" ? "gid-chip-op" : r === "dnc" ? "gid-chip-dnc" : "gid-chip-dsp";

  const getAuditActionClass = (action: string) => {
    if (action === "login") return "border-[#0a5a2a] text-[#4ade80] bg-[#0a1f0a]";
    if (action === "logout") return "border-[#333] text-[#888] bg-[#111]";
    if (action === "kick") return "border-[#5a1a1a] text-[#f87171] bg-[#1a0a0a]";
    if (action === "state_save") return "border-[#1a3a5a] text-[#60a5fa] bg-[#0a1020]";
    if (action.startsWith("alert_")) return "border-[#5a4a1a] text-[#fbbf24] bg-[#1a150a]";
    return "border-[#333] text-[#aaa] bg-[#111]";
  };

  // Если не залогинен — показываем экран входа
  if (!me) return <LoginOverlay onLogin={login} />;

  const mi = (label: React.ReactNode, key: string, fn: () => void, show = true) => show ? <span className="gid-menu-item" onClick={fn}>{label} {key && <span className="key">{key}</span>}</span> : null;

  return (
    <div className="h-screen flex flex-col bg-black text-[#c8c8c8] font-mono select-none overflow-hidden" suppressHydrationWarning>
      {/* Меню */}
      <div className="h-[28px] bg-[#0e0e0e] border-b border-[#1a1a1a] flex items-center px-2 gap-1 shrink-0">
        {mi("Помощь", "F1", () => setHelpOpen(true))}
        <span className="gid-sep">|</span>
        {mi("Новая нитка", "F2", openNew, can(role, "trains.manage", isAdmin))}
        {mi("Станции", "F3", () => setStationOpen(true), can(role, "stations.manage", isAdmin))}
        {mi("Дежурство", "F4", () => setDutyOpen(role ?? null))}
        {mi("Пометка", "F5", openNewMark, can(role, "marks.manage", isAdmin))}
        <span className="gid-sep">|</span>
        {mi(<><i className="fas fa-shield-halved" /> Панель</>, "F6", () => setAdminOpen(true), can(role, "admin.panel", isAdmin))}
        {mi(<><i className="fas fa-chart-column" /> Статистика</>, "F7", () => setStatsOpen(true), can(role, "stats.view", isAdmin))}
        <span className="gid-sep">|</span>
        {mi(<><i className="fas fa-arrow-down" /> Экспорт</>, "", exportJSON)}
        {mi(<><i className="fas fa-arrow-up" /> Импорт</>, "", () => importRef.current?.click())}
        {mi(<><i className="fas fa-rotate-left" /> Сброс</>, "", resetData)}
        <span className="flex-1" />
        <span className="gid-menu-item" onClick={() => setSearchOpen(true)}><i className="fas fa-magnifying-glass" /> Поиск</span>
        <span className="gid-menu-item relative" onClick={() => setAlertsOpen((v) => !v)}>
          <i className="fas fa-bell" />{activeAlerts.length > 0 && <span className="absolute -top-1 -right-1 bg-[#f00] text-white text-[8px] rounded-full w-3.5 h-3.5 grid place-items-center font-bold">{activeAlerts.length}</span>}
        </span>
        <span className="gid-menu-item relative" onClick={() => setOnlineOpen((v) => !v)}>
          <i className="fas fa-users" /> Онлайн · {users.length}
        </span>
        <span className="gid-menu-item" onClick={() => setAuditOpen(true)}><i className="fas fa-clipboard-list" /> Журнал</span>
        <span className="gid-menu-item" onClick={logout}><i className="fas fa-power-off" /> Выход</span>
      </div>

      {/* Баннер критичного оповещения */}
      {critical.length > 0 && (
        <div className="h-[22px] bg-[#2a0000] border-b border-[#600] flex items-center px-2.5 gap-2 shrink-0 text-[11px] text-[#f88] animate-pulse">
          <i className="fas fa-circle-exclamation" />
          <span className="font-bold truncate">{critical[critical.length - 1].text}</span>
          <span className="ml-auto text-[#a55] text-[9px]">{critical[critical.length - 1].author}</span>
        </div>
      )}

      {/* Выпадающий список оповещений */}
      {alertsOpen && (
        <div className="fixed top-[36px] right-2 w-[320px] z-40 gid-modal shadow-2xl">
          <div className="gid-modal-header"><span className="gid-modal-title"><span className="dot" />Оповещения</span>
            <button className="gid-modal-icon-btn close" onClick={() => setAlertsOpen(false)}><i className="fas fa-xmark" /></button></div>
          <div className="gid-modal-body !p-0 max-h-[300px] overflow-y-auto">
            {activeAlerts.length === 0 ? <div className="text-center text-[#555] py-6 text-[11px]">Активных оповещений нет</div> : (
              activeAlerts.map((a) => (
                <div key={a.id} className={`px-3 py-2.5 border-b border-[#1a1a1a] text-[11px] ${a.type === "critical" ? "bg-[#1a0000]" : a.type === "warning" ? "bg-[#1a1400]" : ""}`}>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5">{a.type === "critical" ? <i className="fas fa-circle-exclamation" /> : a.type === "warning" ? <i className="fas fa-triangle-exclamation" /> : <i className="fas fa-circle-info" />}</span>
                    <div className="flex-1"><div className="text-[#ddd]">{a.text}</div><div className="text-[#666] text-[9px] mt-0.5">{a.author} · {new Date(a.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</div></div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Окно онлайн-пользователей (перемещаемое) */}
      {onlineOpen && (
        <DraggableModal title={`Онлайн · ${users.length}`} width={520} minW={480} minH={180} onClose={() => setOnlineOpen(false)}>
          <div className="max-h-[300px] overflow-y-auto">
            {users.length === 0 ? (
              <div className="text-center text-[#555] py-6 text-[11px]">Нет активных пользователей</div>
            ) : (
              <table className="gid-table">
                <thead>
                  <tr>
                    <th>Имя</th>
                    <th>Должность</th>
                    <th>Станция</th>
                    {isAdmin && <th className="text-right">Действие</th>}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.session}>
                      <td>
                        <div className="flex items-center gap-1.5">
                          {u.onDuty && <span className="w-1.5 h-1.5 rounded-full bg-[#00e050] shadow-[0_0_4px_#00e050]" />}
                          <span className={me?.session === u.session ? "text-white font-bold" : "text-[#ccc]"}>
                            {u.name}{me?.session === u.session ? <i className="fas fa-star text-[#ffd700] text-[10px]" /> : ""}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={`gid-chip ${chipCls(u.role)}`}>
                          {ROLE_SHORT[u.role]}
                        </span>
                      </td>
                      <td className="text-[#888]">
                        {u.area || <span className="text-[#444]">—</span>}
                      </td>
                      {isAdmin && (
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Dropdown
                              label="Роль"
                              options={[
                                { value: "admin", label: "Админ", icon: "fas fa-shield-halved" },
                                { value: "dnc", label: "ДНЦ", icon: "fas fa-user-tie" },
                                { value: "dsp", label: "ДСП", icon: "fas fa-user" },
                              ]}
                              onSelect={(v) => updateUser(u.session, { role: v as Role })}
                            />
                            <button
                              className="gid-btn gid-btn-sm"
                              onClick={() => {
                                const newArea = prompt("Введите станцию/участок:", u.area || "");
                                if (newArea !== null) updateUser(u.session, { area: newArea });
                              }}
                              title="Сменить станцию"
                            >
                              Станция
                            </button>
                            <button
                              className="gid-btn gid-btn-sm gid-btn-danger"
                              onClick={() => {
                                if (confirm(`Выгнать ${u.name}?`)) {
                                  ws.send({ kind: "kick", session: u.session });
                                }
                              }}
                              title="Выгнать"
                            >
                              Выгнать
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DraggableModal>
      )}

      {/* Журнал аудита */}
      {auditOpen && (
        <DraggableModal title="Журнал аудита" width={640} minW={520} minH={240} onClose={() => setAuditOpen(false)}>
          <div className="max-h-[400px] overflow-y-auto">
            {audit.length === 0 ? (
              <div className="text-center text-[#555] py-8 text-[11px]">Записей нет</div>
            ) : (
              <table className="gid-table">
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Пользователь</th>
                    <th>Действие</th>
                    <th>Детали</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td className="text-[#888] whitespace-nowrap">
                        {new Date(a.ts).toLocaleTimeString("ru-RU")}
                      </td>
                      <td className="text-[#ccc]">{a.actor}</td>
                      <td>
                        <span className={`text-[9px] px-1.5 py-0.5 border rounded-sm ${getAuditActionClass(a.action)}`}>
                          {a.action}
                        </span>
                      </td>
                      <td className="text-[#777]">
                        {a.detail || a.target || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DraggableModal>
      )}

      {/* Индикаторы */}
      <div className="h-[32px] bg-[#0a0a0a] border-b border-[#1a1a1a] flex items-center px-3 gap-3 shrink-0">
        <span className="text-[#888] text-[11px] font-medium">{clock.toLocaleDateString("ru-RU")}</span>
        <span className="gid-sep">|</span>
        <span className="text-[#555] text-[10px] uppercase tracking-wider">Сетка: <b className="text-[#aaa]">{state.view.hoursVisible}ч</b></span>
        <span className={`gid-toggle ${state.showNumbers ? "on" : ""}`} onClick={() => toggle("showNumbers")}><span className="led" />Номера</span>
        <span className={`gid-toggle ${state.showTimeMarks ? "on" : ""}`} onClick={() => toggle("showTimeMarks")}><span className="led" />Время</span>
        <span className="gid-sep">|</span>

        <div className="flex items-center gap-1.5">
          <span className="text-[#664] text-[9px] uppercase tracking-wider font-bold">ДНЦ</span>
          {dncList.length === 0 ? <span className="gid-badge gid-badge-dnc">---</span> : dncList.map((u) => (
            <span key={u.session} className={`gid-badge gid-badge-dnc active ${me.session === u.session ? "ring-1 ring-white/40" : ""}`} onClick={() => setDutyOpen("dnc")} title={u.area}><span className="led" />{u.name}</span>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[#464] text-[9px] uppercase tracking-wider font-bold">ДСП</span>
          {dspList.length === 0 ? <span className="gid-badge gid-badge-dsp">---</span> : dspList.map((u) => (
            <span key={u.session} className={`gid-badge gid-badge-dsp active ${me.session === u.session ? "ring-1 ring-white/40" : ""}`} onClick={() => setDutyOpen("dsp")} title={u.area}><span className="led" />{u.name}{u.area ? `·${u.area}` : ""}</span>
          ))}
        </div>
        {adminList.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[#866] text-[9px] uppercase tracking-wider font-bold">АДМ</span>
            {adminList.map((u) => <span key={u.session} className="gid-badge gid-badge-dnc active" title={u.area}><span className="led" /><i className="fas fa-shield-halved" />{u.name}</span>)}
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className={`text-[10px] px-2 py-0.5 rounded border font-bold ${role === "admin" ? "border-[#a0a] text-[#f8f] bg-[#1a001a]" : role === "dnc" ? "border-[#7a4a00] text-[#fc6] bg-[#1a0f00]" : "border-[#0a7a2a] text-[#0f0] bg-[#06120a]"}`}>
            {ROLE_SHORT[role!]} · {me.name}
          </span>
          <span className="gid-server"><span className="led" />СИНХР.</span>
          <span className="gid-clock">{clock.toLocaleTimeString("ru-RU")}</span>
        </div>
      </div>

      {/* График + панель */}
      <div className="flex flex-1 overflow-hidden">
        <TrainGraph state={state} onZoomSet={setHoursVisible} onSelect={select} onNewTrainAt={openNewAt} onEditMark={openEditMark} scrollTarget={scrollTarget} />
        <RightPanel state={state} role={role!} onEditTrain={openEditTrain} onEditMark={openEditMark} onDeleteTrain={deleteTrain} onDeleteMark={deleteMark} onSetStopField={setStopField} onMarkNow={markNow} />
      </div>

      {/* Статус-бар */}
      <div className="h-[24px] bg-[#0e0e0e] border-t border-[#1a1a1a] flex items-center px-3 justify-between shrink-0 text-[10px] text-[#555]">
        <span className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#0f0] shadow-[0_0_4px_#0f0]" />
          {state.selected ? (state.selected.type === "train" ? `Выбран поезд №${state.trains.find((t) => t.id === state.selected!.id)?.number}` : "Выбрана пометка") : "Готов"}
        </span>
        <span>ГИД Урал-ВНИИЖТ · web · {state.trains.length} ниток · {state.stations.length} станций · дежурных: {adminList.length + dncList.length + dspList.length} · оповещений: {activeAlerts.length}</span>
      </div>

      <input ref={importRef} type="file" accept=".json" className="hidden" onChange={importJSON} />

      {/* Модалки */}
      {trainModal.open && can(role, "trains.manage", isAdmin) && <TrainModal stations={state.stations} initialTrain={trainModal.edit} presetStationIdx={trainModal.pi} presetMin={trainModal.pm} onSave={saveTrain} onCancel={() => setTrainModal({ open: false, edit: null })} onDelete={deleteTrain} />}
      {stationOpen && can(role, "stations.manage", isAdmin) && <StationModal stations={state.stations} onChange={(stations) => setState((p) => ({ ...p, stations }))} onClose={() => setStationOpen(false)} />}
      {markModal.open && can(role, "marks.manage", isAdmin) && <MarkModal stations={state.stations} initialMark={markModal.edit} onSave={saveMark} onCancel={() => setMarkModal({ open: false, edit: null })} onDelete={deleteMark} />}
      {searchOpen && <SearchModal trains={state.trains} onSelect={selectFromSearch} onClose={() => setSearchOpen(false)} />}
      {dutyOpen && <DutyModal me={me} presetRole={dutyOpen} onUpdate={updateMe} onClose={() => setDutyOpen(null)} />}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {statsOpen && can(role, "stats.view", isAdmin) && <StatsModal state={state} alerts={alerts} onClose={() => setStatsOpen(false)} />}
      {adminOpen && can(role, "admin.panel", isAdmin) && (
        <AdminPanel role={role!} actorName={me.name} stations={state.stations} trains={state.trains} users={users} alerts={alerts}
          setStations={(s) => setState((p) => ({ ...p, stations: s }))} updateUser={updateUser}
          addAlert={addAlert} toggleAlert={toggleAlert} removeAlert={removeAlert}
          deleteTrain={deleteTrain} editTrain={openEditTrain} onClose={() => setAdminOpen(false)} />
      )}
    </div>
  );
}
