"use client";
import { useCallback, useEffect, useState } from "react";
import { useGidState } from "@/lib/useGidState";
import { useOnlineUsers } from "@/lib/useOnlineUsers";
import { useAlerts } from "@/lib/useAlerts";
import { ws } from "@/lib/ws";
import { Train, Mark } from "@/lib/types";
import { renderAlertBody, stripAlertMarkup } from "@/lib/alertFormat";
import { Role, ROLE_SHORT, Action, can as canWith } from "@/lib/permissions";
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

/**
 * Версия ГИДа — единая точка правки.
 * Меняешь строку ниже — новая версия подхватывается везде, где она показывается.
 */
export const GID_VERSION = "0.6 Beta";

export default function GidUralPage() {
  const { state, setState, resetData } = useGidState();
  const { me, users, audit, caps, isAdmin, accounts, opError, opNotice, login, logout, updateMe, updateUser, createAccount, patchAccount, resetAccountPassword, changeOwnPassword, refreshAccounts, clearOpFeedback } = useOnlineUsers();

// Права приходят с сервера. can() ниже только прячет ненужные пункты меню —
// настоящую проверку делает бэкенд и отвечает "forbidden".
const can = useCallback((action: Action) => canWith(caps, action), [caps]);
  const { alerts, addAlert, updateAlert, toggleAlert, removeAlert } = useAlerts();

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
  const activeAlerts = alerts.filter((a) => a.active);

  // Полоска оповещений: ротация по всем активным, не только критичным.
  // Клик открывает карточку с полным описанием.
  const [bannerIdx, setBannerIdx] = useState(0);
  const [alertDetail, setAlertDetail] = useState<string | null>(null);

  useEffect(() => {
    if (activeAlerts.length <= 1) return;
    const iv = setInterval(() => setBannerIdx((i) => (i + 1) % activeAlerts.length), 6000);
    return () => clearInterval(iv);
  }, [activeAlerts.length]);

  const safeIdx = activeAlerts.length ? bannerIdx % activeAlerts.length : 0;
  const bannerAlert = activeAlerts.length ? activeAlerts[safeIdx] : null;

  const alertBannerStyle = (t: string) =>
    t === "critical"
      ? "bg-[#2a0000] border-[#600] text-[#f88]"
      : t === "warning"
        ? "bg-[#1a1400] border-[#5a4a00] text-[#fc6]"
        : "bg-[#00141a] border-[#0a4a5a] text-[#8df]";

  const alertIcon = (t: string) =>
    t === "critical" ? (
      <i className="fas fa-circle-exclamation" />
    ) : t === "warning" ? (
      <i className="fas fa-triangle-exclamation" />
    ) : (
      <i className="fas fa-circle-info" />
    );

  const detailIdx = alertDetail
    ? activeAlerts.findIndex((a) => a.id === alertDetail)
    : -1;
  const detailAlert = detailIdx >= 0 ? activeAlerts[detailIdx] : null;

  const stepDetail = (d: number) => {
    if (!activeAlerts.length) return;
    const next = ((detailIdx < 0 ? 0 : detailIdx) + d + activeAlerts.length) % activeAlerts.length;
    setAlertDetail(activeAlerts[next].id);
  };

  // --- Логика Поездов ---
  const openNew = useCallback(() => { if (can("trains.manage")) setTrainModal({ open: true, edit: null }); }, [can]);
  const openNewAt = (pi: number, pm: number) => { if (can("trains.manage")) setTrainModal({ open: true, edit: null, pi, pm }); };
  const openEditTrain = (id: string) => { if (can("trains.manage")) setTrainModal({ open: true, edit: state.trains.find((t) => t.id === id) || null }); };

  const saveTrain = (train: Train) => {
    setState((p) => ({ ...p, trains: p.trains.some((t) => t.id === train.id) ? p.trains.map((t) => t.id === train.id ? train : t) : [...p.trains, train], selected: { type: "train", id: train.id } }));
    setTrainModal({ open: false, edit: null });
  };

  const deleteTrain = useCallback((id: string) => {
    setState((p) => ({ ...p, trains: p.trains.filter((t) => t.id !== id), selected: null }));
    setTrainModal({ open: false, edit: null });
  }, [setState]);

  // Отметка времени ДСП
  const setStopField = (trainId: string, stopIndex: number, field: "arr" | "dep" | "path", value: string | number) => {
    if (!can("trains.mark")) return;
    setState((p) => ({ ...p, trains: p.trains.map((tr) => tr.id !== trainId ? tr : { ...tr, stops: tr.stops.map((s, i) => i === stopIndex ? { ...s, [field]: value } : s ) }) }));
  };

  const markNow = (trainId: string, stopIndex: number, field: "arr" | "dep") => {
    if (!can("trains.mark")) return;
    const now = new Date();
    setStopField(trainId, stopIndex, field, String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0"));
  };

  // --- Логика Пометок ---
  const openNewMark = useCallback(() => { if (can("marks.manage")) setMarkModal({ open: true, edit: null }); }, [can]);
  const openEditMark = (id: string) => { if (can("marks.manage")) setMarkModal({ open: true, edit: state.marks.find((m) => m.id === id) || null }); };

  const saveMark = (mark: Mark) => {
    setState((p) => ({ ...p, marks: p.marks.some((m) => m.id === mark.id) ? p.marks.map((m) => m.id === mark.id ? mark : m) : [...p.marks, mark], selected: { type: "mark", id: mark.id } }));
    setMarkModal({ open: false, edit: null });
  };

  const deleteMark = useCallback((id: string) => {
    setState((p) => ({ ...p, marks: p.marks.filter((m) => m.id !== id), selected: null }));
    setMarkModal({ open: false, edit: null });
  }, [setState]);

  const deleteSelected = useCallback(() => {
    if (state.selected?.type === "train" && can("trains.manage")) deleteTrain(state.selected.id);
    else if (state.selected?.type === "mark" && can("marks.manage")) deleteMark(state.selected.id);
  }, [state.selected, can, deleteTrain, deleteMark]);

  const selectFromSearch = (id: string) => { setState((p) => ({ ...p, selected: { type: "train", id } })); setScrollTarget({ id, ts: Date.now() }); };

  // Экспорт/Импорт
  const exportJSON = useCallback(() => {
    const blob = new Blob([JSON.stringify({ stations: state.stations, trains: state.trains, marks: state.marks }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gid_ural_export.json";
    a.click();
  }, [state.stations, state.trains, state.marks]);


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
        case "F3": e.preventDefault(); if (can("stations.manage")) setStationOpen(true); break;
        case "F4": e.preventDefault(); setDutyOpen(role || "dnc"); break;
        case "F5": e.preventDefault(); openNewMark(); break;
        case "F6": e.preventDefault(); if (can("admin.panel")) setAdminOpen(true); break;
        case "F7": e.preventDefault(); if (can("stats.view")) setStatsOpen(true); break;
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
          setAlertDetail(null);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.selected, me, role, can, openNew, openNewMark, deleteSelected]);

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
  if (!me) return <LoginOverlay onLogin={login} version={GID_VERSION} />;

  const mi = (label: React.ReactNode, key: string, fn: () => void, show = true) => show ? <span className="gid-menu-item" onClick={fn}>{label} {key && <span className="key">{key}</span>}</span> : null;

  return (
    <div className="h-screen flex flex-col bg-black text-[#c8c8c8] font-mono select-none overflow-hidden" suppressHydrationWarning>
      {/* Меню */}
      <div className="h-[28px] bg-[#0e0e0e] border-b border-[#1a1a1a] flex items-center px-2 gap-1 shrink-0">
        {mi("Помощь", "F1", () => setHelpOpen(true))}
        <span className="gid-sep">|</span>
        {mi("Новая нитка", "F2", openNew, can("trains.manage"))}
        {mi("Станции", "F3", () => setStationOpen(true), can("stations.manage"))}
        {mi("Дежурство", "F4", () => setDutyOpen(role ?? null))}
        {mi("Пометка", "F5", openNewMark, can("marks.manage"))}
        <span className="gid-sep">|</span>
        {mi(<><i className="fas fa-shield-halved" /> Панель</>, "F6", () => setAdminOpen(true), can("admin.panel"))}
        {mi(<><i className="fas fa-chart-column" /> Статистика</>, "F7", () => setStatsOpen(true), can("stats.view"))}
        <span className="gid-sep">|</span>
        {mi(<><i className="fas fa-arrow-down" /> Экспорт</>, "", exportJSON)}
        {/* Импорт через нативную метку: ref не нужен, файл выбирается кликом по label */}
        <label className="gid-menu-item"><i className="fas fa-arrow-up" /> Импорт
          <input type="file" accept=".json" className="hidden" onChange={importJSON} />
        </label>
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

      {/* Полоска оповещений: все активные типы, клик — полные детали */}
      {bannerAlert && (
        <div
          className={`h-[22px] border-b flex items-center px-2.5 gap-2 shrink-0 text-[11px] cursor-pointer select-none ${alertBannerStyle(bannerAlert.type)}`}
          onClick={() => setAlertDetail(bannerAlert.id)}
          title="Нажмите, чтобы открыть полное описание"
        >
          {alertIcon(bannerAlert.type)}
          <span className="font-bold truncate">
            {stripAlertMarkup(bannerAlert.title || bannerAlert.text) || "Без названия"}
          </span>
          {bannerAlert.title && bannerAlert.text && (
            <span className="truncate opacity-70 hidden md:inline">· {stripAlertMarkup(bannerAlert.text)}</span>
          )}
          <span className="ml-auto text-[9px] opacity-70 whitespace-nowrap">
            {activeAlerts.length > 1 && `${safeIdx + 1}/${activeAlerts.length} · `}
            {bannerAlert.author}
          </span>
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
                <div key={a.id} className={`px-3 py-2.5 border-b border-[#1a1a1a] text-[11px] cursor-pointer hover:bg-[#151515] ${a.type === "critical" ? "bg-[#1a0000]" : a.type === "warning" ? "bg-[#1a1400]" : ""}`}
                  onClick={() => { setAlertDetail(a.id); setAlertsOpen(false); }}
                  title="Открыть полное описание">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5">{a.type === "critical" ? <i className="fas fa-circle-exclamation" /> : a.type === "warning" ? <i className="fas fa-triangle-exclamation" /> : <i className="fas fa-circle-info" />}</span>
                    <div className="flex-1"><div className="text-[#ddd] font-bold">{stripAlertMarkup(a.title || a.text) || "Без названия"}</div><div className="text-[#666] text-[9px] mt-0.5">{a.author} · {new Date(a.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</div></div>
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
                            {u.role !== "admin" && (
                              <Dropdown
                                label="Роль"
                                options={[
                                  { value: "dnc", label: "ДНЦ", icon: "fas fa-user-tie" },
                                  { value: "dsp", label: "ДСП", icon: "fas fa-user" },
                                ]}
                                onSelect={(v) => updateUser(u.session, { role: v as Role })}
                              />
                            )}
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
        <RightPanel state={state} caps={caps ?? []} onEditTrain={openEditTrain} onEditMark={openEditMark} onDeleteTrain={deleteTrain} onDeleteMark={deleteMark} onSetStopField={setStopField} onMarkNow={markNow} />
      </div>

      {/* Статус-бар */}
      <div className="h-[24px] bg-[#0e0e0e] border-t border-[#1a1a1a] flex items-center px-3 justify-between shrink-0 text-[10px] text-[#555]">
        <span className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#0f0] shadow-[0_0_4px_#0f0]" />
          {state.selected ? (state.selected.type === "train" ? `Выбран поезд №${state.trains.find((t) => t.id === state.selected!.id)?.number}` : "Выбрана пометка") : "Готов"}
        </span>
        <span>ГИД Урал-ВНИИЖТ · web · {state.trains.length} ниток · {state.stations.length} станций · дежурных: {adminList.length + dncList.length + dspList.length} · оповещений: {activeAlerts.length}</span>
      </div>

      {/* Модалки */}
      {trainModal.open && can("trains.manage") && <TrainModal stations={state.stations} initialTrain={trainModal.edit} presetStationIdx={trainModal.pi} presetMin={trainModal.pm} onSave={saveTrain} onCancel={() => setTrainModal({ open: false, edit: null })} onDelete={deleteTrain} />}
      {stationOpen && can("stations.manage") && <StationModal stations={state.stations} onChange={(stations) => setState((p) => ({ ...p, stations }))} onClose={() => setStationOpen(false)} />}
      {markModal.open && can("marks.manage") && <MarkModal stations={state.stations} initialMark={markModal.edit} onSave={saveMark} onCancel={() => setMarkModal({ open: false, edit: null })} onDelete={deleteMark} />}
      {searchOpen && <SearchModal trains={state.trains} onSelect={selectFromSearch} onClose={() => setSearchOpen(false)} />}
      {detailAlert && (
        <DraggableModal
          title={<>Оповещение · {detailAlert.type === "critical" ? "Критично" : detailAlert.type === "warning" ? "Внимание" : "Инфо"}</>}
          width={460} minH={200} onClose={() => setAlertDetail(null)}
          footer={
            <>
              {activeAlerts.length > 1 && (
                <>
                  <button className="gid-btn gid-btn-sm" onClick={() => stepDetail(-1)}>← Назад</button>
                  <button className="gid-btn gid-btn-sm" onClick={() => stepDetail(1)}>Далее →</button>
                  <span className="text-[#555] text-[10px] self-center">{detailIdx + 1}/{activeAlerts.length}</span>
                </>
              )}
              <button className="gid-btn" onClick={() => setAlertDetail(null)}>Закрыть</button>
            </>
          }>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[#ccc]">{alertIcon(detailAlert.type)}</span>
            <span className="gid-rp-title">{detailAlert.title || "Без названия"}</span>
          </div>
          <div className="text-[10px] text-[#666] mb-2">
            {detailAlert.author} · {new Date(detailAlert.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </div>
          {detailAlert.text && (
            <div className="text-[11px] text-[#ccc] border-l-2 border-[#444] pl-2 mb-2">{stripAlertMarkup(detailAlert.text)}</div>
          )}
          {detailAlert.full ? (
            <div className="text-[11px] text-[#aaa] leading-relaxed">{renderAlertBody(detailAlert.full)}</div>
          ) : (
            <div className="text-[10px] text-[#555] italic">Подробного описания нет.</div>
          )}
        </DraggableModal>
      )}
      {dutyOpen && <DutyModal me={me} presetRole={dutyOpen} onUpdate={updateMe} onClose={() => setDutyOpen(null)} changeOwnPassword={changeOwnPassword} opError={opError} opNotice={opNotice} clearOpFeedback={clearOpFeedback} />}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {statsOpen && can("stats.view") && <StatsModal state={state} alerts={alerts} onClose={() => setStatsOpen(false)} />}
      {adminOpen && can("admin.panel") && (
        <AdminPanel role={role!} caps={caps ?? []} actorName={me.name} stations={state.stations} trains={state.trains} users={users} alerts={alerts}
          accounts={accounts} opError={opError} opNotice={opNotice}
          setStations={(s) => setState((p) => ({ ...p, stations: s }))} updateUser={updateUser}
          createAccount={createAccount} patchAccount={patchAccount} resetAccountPassword={resetAccountPassword}
          refreshAccounts={refreshAccounts} clearOpFeedback={clearOpFeedback}
          addAlert={addAlert} updateAlert={updateAlert} toggleAlert={toggleAlert} removeAlert={removeAlert}
          deleteTrain={deleteTrain} editTrain={openEditTrain} onClose={() => setAdminOpen(false)} />
      )}
    </div>
  );
}
