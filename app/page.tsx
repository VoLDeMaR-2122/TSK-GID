"use client";
import { useEffect, useRef, useState } from "react";
import { useGidState } from "@/lib/useGidState";
import { useOnlineUsers } from "@/lib/useOnlineUsers";
import { useAlerts } from "@/lib/useAlerts";
import { Train, Mark } from "@/lib/types";
import { Role, ROLE_SHORT, can } from "@/lib/permissions";
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

export default function GidUralPage() {
  const { state, setState, resetData } = useGidState();
  const { me, users, login, logout, updateMe, updateUser } = useOnlineUsers();
  const { alerts, addAlert, toggleAlert, removeAlert } = useAlerts();
  const importRef = useRef<HTMLInputElement>(null);

  const [trainModal, setTrainModal] = useState<{ open: boolean; edit: Train | null; pi?: number; pm?: number }>({ open: false, edit: null });
  const [stationOpen, setStationOpen] = useState(false);
  const [markModal, setMarkModal] = useState<{ open: boolean; edit: Mark | null }>({ open: false, edit: null });
  const [searchOpen, setSearchOpen] = useState(false);
  const [dutyOpen, setDutyOpen] = useState<Role | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [scrollTarget, setScrollTarget] = useState<{ id: string; ts: number } | null>(null);
  const [clock, setClock] = useState(new Date());

  useEffect(() => { const iv = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(iv); }, []);

  const role: Role | undefined = me?.role;
  const activeAlerts = alerts.filter((a) => a.active);
  const critical = activeAlerts.filter((a) => a.type === "critical");

  // ---- Поезда (ДНЦ + админ) ----
  const openNew = () => { if (can(role, "trains.manage")) setTrainModal({ open: true, edit: null }); };
  const openNewAt = (pi: number, pm: number) => { if (can(role, "trains.manage")) setTrainModal({ open: true, edit: null, pi, pm }); };
  const openEditTrain = (id: string) => { if (can(role, "trains.manage")) setTrainModal({ open: true, edit: state.trains.find((t) => t.id === id) || null }); };
  const saveTrain = (train: Train) => { setState((p) => ({ ...p, trains: p.trains.some((t) => t.id === train.id) ? p.trains.map((t) => t.id === train.id ? train : t) : [...p.trains, train], selected: { type: "train", id: train.id } })); setTrainModal({ open: false, edit: null }); };
  const deleteTrain = (id: string) => { setState((p) => ({ ...p, trains: p.trains.filter((t) => t.id !== id), selected: null })); setTrainModal({ open: false, edit: null }); };

  // ---- Отметка ДСП: прибытие / отправление / путь ----
  const setStopField = (trainId: string, stopIndex: number, field: "arr" | "dep" | "path", value: string | number) => {
    if (!can(role, "trains.mark")) return;
    setState((p) => ({ ...p, trains: p.trains.map((tr) => tr.id !== trainId ? tr : { ...tr, stops: tr.stops.map((s, i) => i === stopIndex ? { ...s, [field]: value } : s ) }) }));
  };
  const markNow = (trainId: string, stopIndex: number, field: "arr" | "dep") => {
    if (!can(role, "trains.mark")) return;
    const now = new Date();
    setStopField(trainId, stopIndex, field, String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0"));
  };

  // ---- Пометки (ДНЦ + админ) ----
  const openNewMark = () => { if (can(role, "marks.manage")) setMarkModal({ open: true, edit: null }); };
  const openEditMark = (id: string) => { if (can(role, "marks.manage")) setMarkModal({ open: true, edit: state.marks.find((m) => m.id === id) || null }); };
  const saveMark = (mark: Mark) => { setState((p) => ({ ...p, marks: p.marks.some((m) => m.id === mark.id) ? p.marks.map((m) => m.id === mark.id ? mark : m) : [...p.marks, mark], selected: { type: "mark", id: mark.id } })); setMarkModal({ open: false, edit: null }); };
  const deleteMark = (id: string) => { setState((p) => ({ ...p, marks: p.marks.filter((m) => m.id !== id), selected: null })); setMarkModal({ open: false, edit: null }); };
  const deleteSelected = () => { if (state.selected?.type === "train" && can(role, "trains.manage")) deleteTrain(state.selected.id); else if (state.selected?.type === "mark" && can(role, "marks.manage")) deleteMark(state.selected.id); };

  const selectFromSearch = (id: string) => { setState((p) => ({ ...p, selected: { type: "train", id } })); setScrollTarget({ id, ts: Date.now() }); };

  const exportJSON = () => { const blob = new Blob([JSON.stringify({ stations: state.stations, trains: state.trains, marks: state.marks }, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "gid_ural_export.json"; a.click(); };
  const importJSON = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = (ev) => { try { const o = JSON.parse(ev.target!.result as string); setState((p) => ({ ...p, stations: o.stations || p.stations, trains: o.trains || p.trains, marks: o.marks || p.marks })); } catch { alert("Неверный JSON"); } }; r.readAsText(f); e.target.value = ""; };

  const setHoursVisible = (v: number) => setState((p) => ({ ...p, view: { ...p.view, hoursVisible: v } }));
  const select = (selected: { type: string; id: string } | null) => setState((p) => ({ ...p, selected }));
  const toggle = (k: "showNumbers" | "showTimeMarks") => setState((p) => ({ ...p, [k]: !p[k] }));

  // ================= НАДЁЖНЫЕ ГОРЯЧИЕ КЛАВИШИ =================
  // ref обновляется каждый рендер -> эффект с [] всегда вызывает СВЕЖИЕ замыкания
  const hotkeysRef = useRef<Record<string, () => void>>({});
  hotkeysRef.current = {
    F1: () => setHelpOpen(true),
    F2: openNew,
    F3: () => { if (can(role, "stations.manage")) setStationOpen(true); },
    F4: () => setDutyOpen(role || "dnc"),
    F5: openNewMark,
    F6: () => { if (can(role, "admin.panel")) setAdminOpen(true); },
    F7: () => { if (can(role, "stats.view")) setStatsOpen(true); },
    Delete: deleteSelected,
    Escape: () => {
      setTrainModal({ open: false, edit: null }); setMarkModal({ open: false, edit: null });
      setStationOpen(false); setSearchOpen(false); setDutyOpen(null); setHelpOpen(false);
      setAdminOpen(false); setStatsOpen(false); setAlertsOpen(false);
    },
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      const id = /^F[1-7]$/.test(e.key) ? e.key : /^F[1-7]$/.test(e.code) ? e.code : e.key; // F1..F7 по key или code
      const fn = hotkeysRef.current[id];
      if (!fn) return;

      // Esc работает ВСЕГДА (в т.ч. из полей ввода — чтобы закрывать модалки)
      if (id === "Escape") { e.preventDefault(); e.stopPropagation(); fn(); return; }

      // В полях ввода F/Delete не срабатывают (иначе ломали бы набор текста)
      if (typing) return;

      e.preventDefault();   // отменяем дефолт браузера (F1/F5/F11 и т.д.)
      e.stopPropagation();
      fn();
    };
    // capture:true -> ловим раньше браузерного дефолтного действия
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []); // стабильно: вешается один раз на всю жизнь компонента
  // ===========================================================

  const adminList = users.filter((u) => u.role === "admin" && u.onDuty);
  const dncList = users.filter((u) => u.role === "dnc" && u.onDuty);
  const dspList = users.filter((u) => u.role === "dsp" && u.onDuty);
  const chipCls = (r: Role) => r === "admin" ? "gid-chip-op" : r === "dnc" ? "gid-chip-dnc" : "gid-chip-dsp";

  const onlinePanel = (
    <div className="border-t border-[#1e1e1e] px-2 py-1.5 text-[10px] shrink-0 bg-[#080808]">
      <div className="text-[#555] mb-1 uppercase tracking-wider text-[8px] font-bold">Онлайн · {users.length}</div>
      <div className="flex flex-wrap gap-1">
        {users.length === 0 && <span className="text-[#3a3a3a]">нет активных</span>}
        {users.map((u) => (
          <span key={u.session} className={`gid-chip ${chipCls(u.role)} ${me?.session === u.session ? "me" : ""}`}>
            {u.onDuty && <span className="duty-dot" />}{ROLE_SHORT[u.role]}: {u.name}{me?.session === u.session ? " ★" : ""}
          </span>
        ))}
      </div>
    </div>
  );

  if (!me) return <LoginOverlay onLogin={(n, r, a, pw) => login(n, r, a, pw)} />;

  const mi = (label: string, key: string, fn: () => void, show = true) => show ? <span className="gid-menu-item" onClick={fn}>{label} {key && <span className="key">{key}</span>}</span> : null;

  return (
    <div className="h-screen flex flex-col bg-black text-[#c8c8c8] font-mono select-none overflow-hidden">
      <div className="h-[26px] bg-[#0e0e0e] border-b border-[#222] flex items-center px-1.5 gap-0.5 shrink-0">
        {mi("Помощь", "F1", () => setHelpOpen(true))}
        <span className="gid-sep">|</span>
        {mi("Новая нитка", "F2", openNew, can(role, "trains.manage"))}
        {mi("Станции", "F3", () => setStationOpen(true), can(role, "stations.manage"))}
        {mi("Дежурство", "F4", () => setDutyOpen(role))}
        {mi("Пометка", "F5", openNewMark, can(role, "marks.manage"))}
        <span className="gid-sep">|</span>
        {mi("🛡 Панель", "F6", () => setAdminOpen(true), can(role, "admin.panel"))}
        {mi("📊 Статистика", "F7", () => setStatsOpen(true), can(role, "stats.view"))}
        <span className="gid-sep">|</span>
        {mi("⇩ Экспорт", "", exportJSON)}
        {mi("⇧ Импорт", "", () => importRef.current?.click())}
        {mi("⟲ Сброс", "", resetData)}
        <span className="gid-menu-item" style={{ marginLeft: "auto" }} onClick={() => setSearchOpen(true)}>🔍 Поиск</span>
        <span className="gid-menu-item relative" onClick={() => setAlertsOpen((v) => !v)}>
          🔔{activeAlerts.length > 0 && <span className="absolute -top-1 -right-1 bg-[#f00] text-white text-[8px] rounded-full w-3.5 h-3.5 grid place-items-center font-bold">{activeAlerts.length}</span>}
        </span>
        <span className="gid-menu-item" onClick={logout}>⏻ Выход</span>
      </div>

      {critical.length > 0 && (
        <div className="h-[22px] bg-[#2a0000] border-b border-[#600] flex items-center px-2.5 gap-2 shrink-0 text-[11px] text-[#f88] animate-pulse">
          <span>⛔</span>
          <span className="font-bold truncate">{critical[critical.length - 1].text}</span>
          <span className="ml-auto text-[#a55] text-[9px]">{critical[critical.length - 1].author}</span>
        </div>
      )}

      {alertsOpen && (
        <div className="fixed top-[48px] right-2 w-[320px] z-40 gid-modal">
          <div className="gid-modal-header"><span className="gid-modal-title"><span className="dot" />Оповещения</span>
            <button className="gid-modal-icon-btn close" onClick={() => setAlertsOpen(false)}>✕</button></div>
          <div className="gid-modal-body !p-0 max-h-[300px] overflow-y-auto">
            {activeAlerts.length === 0 ? <div className="text-center text-[#555] py-6 text-[11px]">Активных оповещений нет</div> : (
              activeAlerts.map((a) => (
                <div key={a.id} className={`px-3 py-2 border-b border-[#1a1a1a] text-[11px] ${a.type === "critical" ? "bg-[#1a0000]" : a.type === "warning" ? "bg-[#1a1400]" : ""}`}>
                  <div className="flex items-start gap-2">
                    <span>{a.type === "critical" ? "⛔" : a.type === "warning" ? "⚠" : "ℹ"}</span>
                    <div className="flex-1"><div className="text-[#ddd]">{a.text}</div><div className="text-[#666] text-[9px] mt-0.5">{a.author} · {new Date(a.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</div></div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="h-[30px] bg-[#0a0a0a] border-b border-[#222] flex items-center px-2.5 gap-2.5 shrink-0">
        <span className="text-[#888] text-[11px]">{clock.toLocaleDateString("ru-RU")}</span>
        <span className="gid-sep">|</span>
        <span className="text-[#555] text-[10px] uppercase tracking-wider">Сетка: <b className="text-[#aaa]">{state.view.hoursVisible}ч</b></span>
        <span className={`gid-toggle ${state.showNumbers ? "on" : ""}`} onClick={() => toggle("showNumbers")}><span className="led" />Номера</span>
        <span className={`gid-toggle ${state.showTimeMarks ? "on" : ""}`} onClick={() => toggle("showTimeMarks")}><span className="led" />Время</span>
        <span className="gid-sep">|</span>
        <div className="flex items-center gap-1">
          <span className="text-[#664] text-[9px] uppercase tracking-wider font-bold">ДНЦ</span>
          {dncList.length === 0 ? <span className="gid-badge gid-badge-dnc">---</span> : dncList.map((u) => (
            <span key={u.session} className={`gid-badge gid-badge-dnc active ${me.session === u.session ? "ring-1 ring-white/40" : ""}`} onClick={() => setDutyOpen("dnc")} title={u.area}><span className="led" />{u.name}</span>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[#464] text-[9px] uppercase tracking-wider font-bold">ДСП</span>
          {dspList.length === 0 ? <span className="gid-badge gid-badge-dsp">---</span> : dspList.map((u) => (
            <span key={u.session} className={`gid-badge gid-badge-dsp active ${me.session === u.session ? "ring-1 ring-white/40" : ""}`} onClick={() => setDutyOpen("dsp")} title={u.area}><span className="led" />{u.name}{u.area ? `·${u.area}` : ""}</span>
          ))}
        </div>
        {adminList.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-[#866] text-[9px] uppercase tracking-wider font-bold">АДМ</span>
            {adminList.map((u) => <span key={u.session} className="gid-badge gid-badge-dnc active" title={u.area}><span className="led" />🛡{u.name}</span>)}
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

      <div className="flex flex-1 overflow-hidden">
        <TrainGraph state={state} onZoomSet={setHoursVisible} onSelect={select} onNewTrainAt={openNewAt} onEditMark={openEditMark} scrollTarget={scrollTarget} leftBottom={onlinePanel} />
        <RightPanel state={state} role={role!} onEditTrain={openEditTrain} onEditMark={openEditMark} onDeleteTrain={deleteTrain} onDeleteMark={deleteMark} onSetStopField={setStopField} onMarkNow={markNow} />
      </div>

      <div className="h-[22px] bg-[#0e0e0e] border-t border-[#222] flex items-center px-2.5 justify-between shrink-0 text-[10px] text-[#555]">
        <span className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#0f0] shadow-[0_0_4px_#0f0]" />
          {state.selected ? (state.selected.type === "train" ? `Выбран поезд №${state.trains.find((t) => t.id === state.selected!.id)?.number}` : "Выбрана пометка") : "Готов"}
        </span>
        <span>ГИД Урал-ВНИИЖТ · web · {state.trains.length} ниток · {state.stations.length} станций · дежурных: {adminList.length + dncList.length + dspList.length} · оповещений: {activeAlerts.length}</span>
      </div>

      <input ref={importRef} type="file" accept=".json" className="hidden" onChange={importJSON} />

      {trainModal.open && can(role, "trains.manage") && <TrainModal stations={state.stations} initialTrain={trainModal.edit} presetStationIdx={trainModal.pi} presetMin={trainModal.pm} onSave={saveTrain} onCancel={() => setTrainModal({ open: false, edit: null })} onDelete={deleteTrain} />}
      {stationOpen && can(role, "stations.manage") && <StationModal stations={state.stations} onChange={(stations) => setState((p) => ({ ...p, stations }))} onClose={() => setStationOpen(false)} />}
      {markModal.open && can(role, "marks.manage") && <MarkModal stations={state.stations} initialMark={markModal.edit} onSave={saveMark} onCancel={() => setMarkModal({ open: false, edit: null })} onDelete={deleteMark} />}
      {searchOpen && <SearchModal trains={state.trains} onSelect={selectFromSearch} onClose={() => setSearchOpen(false)} />}
      {dutyOpen && <DutyModal me={me} presetRole={dutyOpen} onUpdate={updateMe} onClose={() => setDutyOpen(null)} />}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {statsOpen && can(role, "stats.view") && <StatsModal state={state} alerts={alerts} onClose={() => setStatsOpen(false)} />}
      {adminOpen && can(role, "admin.panel") && (
        <AdminPanel role={role!} actorName={me.name} stations={state.stations} trains={state.trains} users={users} alerts={alerts}
          setStations={(s) => setState((p) => ({ ...p, stations: s }))} updateUser={updateUser}
          addAlert={addAlert} toggleAlert={toggleAlert} removeAlert={removeAlert}
          deleteTrain={deleteTrain} editTrain={openEditTrain} onClose={() => setAdminOpen(false)} />
      )}
    </div>
  );
}
