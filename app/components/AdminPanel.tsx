"use client";
import React, { useEffect, useRef, useState } from "react";
import { Station, Train, CAT_NAMES, CAT_COLORS } from "@/lib/types";
import { OnlineUser, PersonAccount } from "@/lib/useOnlineUsers";
import { Alert } from "@/lib/useAlerts";
import { renderAlertBody } from "@/lib/alertFormat";
import { Role, ROLE_NAMES, ROLE_SHORT, Action, Capabilities, canManageRole } from "@/lib/permissions";
import DraggableModal from "./DraggableModal";

interface Props {
  role: Role;
  caps: Capabilities;
  actorName: string;
  stations: Station[];
  trains: Train[];
  users: OnlineUser[];
  alerts: Alert[];
  accounts: PersonAccount[];
  opError: string;
  opNotice: string;
  setStations: (s: Station[]) => void;
  updateUser: (session: string, patch: Partial<OnlineUser>) => void;
  createAccount: (login: string, name: string, password: string, role: Role) => void;
  patchAccount: (login: string, patch: { name?: string; role?: Role; active?: boolean }) => void;
  resetAccountPassword: (login: string, password: string) => void;
  refreshAccounts: () => void;
  clearOpFeedback: () => void;
  addAlert: (type: Alert["type"], title: string, text: string, full: string, author: string) => void;
  updateAlert: (alert: Pick<Alert, "id" | "type" | "title" | "text" | "full">) => void;
  toggleAlert: (id: string) => void;
  removeAlert: (id: string) => void;
  deleteTrain: (id: string) => void;
  editTrain: (id: string) => void;
  onClose: () => void;
}

type Tab = "stations" | "users" | "staff" | "alerts" | "trains";
const uid = () => "s" + Math.random().toString(36).slice(2, 10);

export default function AdminPanel(p: Props) {
  // Права от сервера: только отображение, реальная проверка — на бэкенде.
  const can = (a: Action) => !!p.caps?.includes(a);
  const isSuperAdmin = can("users.manage_roles");
  const tabs: { key: Tab; label: React.ReactNode; show: boolean }[] = [
    { key: "stations", label: <><i className="fas fa-industry" /> Станции</>, show: can("stations.manage") },
    { key: "users", label: <><i className="fas fa-users" /> Персонал</>, show: can("users.manage_dsp") || isSuperAdmin },
    { key: "staff", label: <><i className="fas fa-id-card" /> Сотрудники</>, show: isSuperAdmin },
    { key: "alerts", label: <><i className="fas fa-bell" /> Оповещения</>, show: can("alerts.manage") },
    { key: "trains", label: <><i className="fas fa-train" /> Поезда</>, show: can("trains.manage") },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<Tab>(visible[0]?.key || "stations");

  // Права приходят с сервера асинхронно: если выбранная вкладка
  // оказалась недоступна — показываем первую разрешённую.
  const activeTab: Tab = visible.some((t) => t.key === tab)
    ? tab
    : visible[0]?.key || "stations";

  const switchTab = (t: Tab) => {
    p.clearOpFeedback();
    setTab(t);
    if (t === "staff") p.refreshAccounts();
  };

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

  // Оповещения: полноценный редактор
  const [alType, setAlType] = useState<Alert["type"]>("info");
  const [alTitle, setAlTitle] = useState("");
  const [alShort, setAlShort] = useState("");
  const [alFull, setAlFull] = useState("");
  // id редактируемого оповещения; null — создание нового
  const [alEdit, setAlEdit] = useState<string | null>(null);
  const fullRef = useRef<HTMLTextAreaElement>(null);

  // Кнопки форматирования: оборачивают выделение, без него вставляют шаблон.
  const applyWrap = (before: string, after: string, placeholder: string) => {
    const el = fullRef.current;
    p.clearOpFeedback();
    if (!el) {
      setAlFull((v) => v + before + placeholder + after);
      return;
    }
    const s = el.selectionStart ?? 0;
    const e = el.selectionEnd ?? 0;
    const hadSel = e > s;
    const inner = hadSel ? el.value.slice(s, e) : placeholder;
    const next = el.value.slice(0, s) + before + inner + after + el.value.slice(e);
    setAlFull(next);
    const innerStart = s + before.length;
    const innerEnd = innerStart + inner.length;
    requestAnimationFrame(() => {
      el.focus();
      try {
        el.setSelectionRange(hadSel ? innerEnd : innerStart, innerEnd);
      } catch { /* старые браузеры */ }
    });
  };

  const applyList = () => {
    const el = fullRef.current;
    p.clearOpFeedback();
    if (!el) {
      setAlFull((v) => (v && !v.endsWith("\n") ? v + "\n" : v) + "- пункт");
      return;
    }
    const s = el.selectionStart ?? 0;
    const e = el.selectionEnd ?? 0;
    const sel = el.value.slice(s, e) || "пункт";
    const listed = sel
      .split("\n")
      .map((ln) => (/^\s*(?:[-•]|\d+[.)])\s+/.test(ln) ? ln : `- ${ln}`))
      .join("\n");
    const next = el.value.slice(0, s) + listed + el.value.slice(e);
    setAlFull(next);
    requestAnimationFrame(() => {
      el.focus();
      try {
        el.setSelectionRange(s + listed.length, s + listed.length);
      } catch { /* старые браузеры */ }
    });
  };

  const resetAlForm = () => {
    setAlType("info");
    setAlTitle("");
    setAlShort("");
    setAlFull("");
    setAlEdit(null);
  };

  const startAlEdit = (a: Alert) => {
    p.clearOpFeedback();
    setAlEdit(a.id);
    setAlType(a.type);
    setAlTitle(a.title);
    setAlShort(a.text);
    setAlFull(a.full);
  };

  const saveAlert = () => {
    if (!alTitle.trim() && !alShort.trim()) return;
    if (alEdit) {
      p.updateAlert({ id: alEdit, type: alType, title: alTitle.trim(), text: alShort.trim(), full: alFull.trim() });
    } else {
      p.addAlert(alType, alTitle.trim(), alShort.trim(), alFull.trim(), p.actorName);
    }
    resetAlForm();
  };

  const canManageUser = (u: OnlineUser) => canManageRole(p.caps, p.role, u.role);

  // Сотрудники: форма создания
  const [newLogin, setNewLogin] = useState("");
  const [newName, setNewName] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState<Role>("dsp");
  const [showPass, setShowPass] = useState(false);
  // Сброс пароля: для какой учётки открыта строка ввода
  const [pwTarget, setPwTarget] = useState("");
  const [pwValue, setPwValue] = useState("");
  const [pwShow, setPwShow] = useState(false);
  // Переименование: для какой учётки открыта строка ввода
  const [nameTarget, setNameTarget] = useState("");
  const [nameValue, setNameValue] = useState("");

  // Подтягиваем список при первом открытии панели администратором.
  useEffect(() => {
    if (isSuperAdmin) p.refreshAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const touch = (fn: () => void) => () => { p.clearOpFeedback(); fn(); };

  const doCreate = () => {
    if (!newLogin.trim()) { return; }
    if (!newName.trim()) { return; }
    if (newPass.length < 6) { return; }
    p.createAccount(newLogin.trim(), newName.trim(), newPass, newRole);
    setNewPass("");
  };

  const doResetPw = (login: string) => {
    if (pwValue.length < 6) return;
    p.resetAccountPassword(login, pwValue);
    setPwTarget("");
    setPwValue("");
    setPwShow(false);
  };

  const doRename = (login: string) => {
    if (!nameValue.trim()) return;
    p.patchAccount(login, { name: nameValue.trim() });
    setNameTarget("");
    setNameValue("");
  };

  return (
    <DraggableModal title={`Панель управления · ${ROLE_SHORT[p.role]}`} width={720} minH={420} onClose={p.onClose}
      footer={<button className="gid-btn" onClick={p.onClose}>Закрыть</button>}>

      <div className="flex gap-1 mb-3 border-b border-[#222] pb-2">
        {visible.map((t) => (
          <button key={t.key} onClick={() => switchTab(t.key)}
            className={`px-3 py-1.5 text-[11px] font-bold cursor-pointer transition-all ${activeTab === t.key ? "bg-[#06120a] border border-[#0a7a2a] text-[#0f0]" : "text-[#666] hover:text-[#aaa] hover:bg-[#181818]"}`}>
            {t.label}
          </button>
        ))}
        {visible.length === 0 && <div className="text-[#555] text-[11px] py-2">Нет доступных разделов</div>}
      </div>

      {/* СТАНЦИИ */}
      {activeTab === "stations" && can("stations.manage") && (
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

      {/* ПЕРСОНАЛ — кто сейчас онлайн */}
      {activeTab === "users" && (can("users.manage_dsp") || isSuperAdmin) && (
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
                          {isSuperAdmin && editable && u.role !== "admin" ? (
                            <select className="gid-select !w-auto !py-0.5" value={u.role} onChange={(e) => p.updateUser(u.session, { role: e.target.value as Role })}>
                              <option value="dsp">{ROLE_SHORT.dsp}</option>
                              <option value="dnc">{ROLE_SHORT.dnc}</option>
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

      {/* СОТРУДНИКИ — учётные записи */}
      {activeTab === "staff" && isSuperAdmin && (
        <div>
          <div className="text-[10px] text-[#666] mb-2">
            Учётные записи для входа: логин (Ф.И.О.) и пароль выдаёте вы.
            Роль администратора через панель не выдаётся. Отключение срабатывает сразу — сотрудник выкидывается из системы.
          </div>

          {p.opError && (
            <div className="text-[11px] text-[#f88] border border-[#5a1a1a] bg-[#1a0a0a] px-2.5 py-2 mb-2">
              <i className="fas fa-triangle-exclamation" /> {p.opError}
            </div>
          )}
          {p.opNotice && (
            <div className="text-[11px] text-[#8f8] border border-[#0a5a2a] bg-[#0a1f0a] px-2.5 py-2 mb-2">
              <i className="fas fa-check" /> {p.opNotice}
            </div>
          )}

          {/* Создание */}
          <div className="border border-[#0a4a24] bg-[#06120a] p-3 mb-3">
            <div className="text-[10px] text-[#8a8] font-bold uppercase tracking-wider mb-2">
              <i className="fas fa-user-plus" /> Новый сотрудник
            </div>
            <div className="gid-grid2">
              <div className="gid-field">
                <label className="gid-label">Логин (Ф.И.О.)</label>
                <input className="gid-input" value={newLogin} autoComplete="off"
                  onChange={(e) => { p.clearOpFeedback(); setNewLogin(e.target.value); }}
                  placeholder="Иванов И.И." />
              </div>
              <div className="gid-field">
                <label className="gid-label">Отображаемое имя</label>
                <input className="gid-input" value={newName} autoComplete="off"
                  onChange={(e) => { p.clearOpFeedback(); setNewName(e.target.value); }}
                  placeholder="Иванов Иван Иванович" />
              </div>
              <div className="gid-field">
                <label className="gid-label">Пароль (мин. 6 символов)</label>
                <div className="flex gap-1">
                  <input type={showPass ? "text" : "password"} className="gid-input" value={newPass} autoComplete="new-password"
                    onChange={(e) => { p.clearOpFeedback(); setNewPass(e.target.value); }}
                    placeholder="••••••••" />
                  <button className="gid-btn gid-btn-sm" title={showPass ? "Скрыть" : "Показать"}
                    onClick={() => setShowPass((v) => !v)}>
                    <i className={showPass ? "fas fa-eye-slash" : "fas fa-eye"} />
                  </button>
                </div>
              </div>
              <div className="gid-field">
                <label className="gid-label">Должность</label>
                <select className="gid-select" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
                  <option value="dsp">{ROLE_NAMES.dsp}</option>
                  <option value="dnc">{ROLE_NAMES.dnc}</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 items-center mt-1">
              <button className="gid-btn gid-btn-primary"
                disabled={!newLogin.trim() || !newName.trim() || newPass.length < 6}
                onClick={touch(doCreate)}>
                <i className="fas fa-plus" /> Создать
              </button>
              <button className="gid-btn gid-btn-sm" onClick={touch(() => p.refreshAccounts())}>
                <i className="fas fa-rotate" /> Обновить список
              </button>
            </div>
          </div>

          {/* Список */}
          <div className="border border-[#2a2a2a] overflow-hidden">
            <div className="max-h-[300px] overflow-y-auto">
              <table className="gid-table">
                <thead><tr><th>Логин / ФИО</th><th>Роль</th><th>Статус</th><th className="text-right">Действия</th></tr></thead>
                <tbody>
                  {p.accounts.map((a) => (
                    <React.Fragment key={a.login}>
                      <tr className={a.active ? "" : "opacity-60"}>
                        <td>
                          <div className="font-bold text-[#ddd]">{a.name}</div>
                          <div className="text-[#666] text-[10px] font-mono">{a.login}</div>
                        </td>
                        <td>
                          <select className="gid-select !w-auto !py-0.5" value={a.role}
                            disabled={a.isAdmin}
                            title={a.isAdmin ? "Роль администратора меняется только переменными окружения" : "Сменить роль"}
                            onChange={(e) => p.patchAccount(a.login, { role: e.target.value as Role })}>
                            <option value="dsp">{ROLE_SHORT.dsp}</option>
                            <option value="dnc">{ROLE_SHORT.dnc}</option>
                            {a.isAdmin && <option value="admin">{ROLE_SHORT.admin}</option>}
                          </select>
                          {a.isAdmin && <div className="text-[9px] text-[#f8f] mt-0.5"><i className="fas fa-shield-halved" /> админ</div>}
                        </td>
                        <td>
                          <span className={`gid-chip ${a.active ? "gid-chip-dsp" : "gid-chip-op"}`}>
                            {a.active ? "● активен" : "○ отключён"}
                          </span>
                        </td>
                        <td className="text-right whitespace-nowrap">
                          <button className="gid-btn gid-btn-sm mr-1"
                            title="Переименовать"
                            onClick={() => {
                              p.clearOpFeedback();
                              if (nameTarget === a.login) { setNameTarget(""); setNameValue(""); }
                              else { setNameTarget(a.login); setNameValue(a.name); }
                            }}>
                            <i className="fas fa-pen" />
                          </button>
                          <button className="gid-btn gid-btn-sm mr-1"
                            title="Сбросить пароль"
                            onClick={() => {
                              p.clearOpFeedback();
                              if (pwTarget === a.login) { setPwTarget(""); setPwValue(""); setPwShow(false); }
                              else { setPwTarget(a.login); setPwValue(""); setPwShow(false); }
                            }}>
                            <i className="fas fa-key" />
                          </button>
                          <button
                            className={`gid-btn gid-btn-sm ${a.active ? "gid-btn-danger" : ""}`}
                            title={a.active ? "Отключить (выкинет из системы)" : "Включить"}
                            onClick={() => {
                              if (a.active && !confirm(`Отключить ${a.name}? Он сразу выйдет из системы.`)) return;
                              p.patchAccount(a.login, { active: !a.active });
                            }}>
                            {a.active ? "Откл." : "Вкл."}
                          </button>
                        </td>
                      </tr>
                      {nameTarget === a.login && (
                        <tr key={a.login + "-rename"}>
                          <td colSpan={4} className="bg-[#0a140a]">
                            <div className="flex gap-1 items-center">
                              <input className="gid-input flex-1" value={nameValue} autoFocus
                                onChange={(e) => setNameValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") doRename(a.login); }}
                                placeholder="Новое отображаемое имя" />
                              <button className="gid-btn gid-btn-sm gid-btn-primary"
                                disabled={!nameValue.trim()} onClick={() => doRename(a.login)}>
                                Сохранить
                              </button>
                              <button className="gid-btn gid-btn-sm" onClick={() => { setNameTarget(""); setNameValue(""); }}>
                                Отмена
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                      {pwTarget === a.login && (
                        <tr key={a.login + "-pw"}>
                          <td colSpan={4} className="bg-[#0a140a]">
                            <div className="flex gap-1 items-center">
                              <input type={pwShow ? "text" : "password"} className="gid-input flex-1"
                                value={pwValue} autoFocus autoComplete="new-password"
                                onChange={(e) => { p.clearOpFeedback(); setPwValue(e.target.value); }}
                                onKeyDown={(e) => { if (e.key === "Enter") doResetPw(a.login); }}
                                placeholder="Новый пароль (мин. 6 символов)" />
                              <button className="gid-btn gid-btn-sm" title={pwShow ? "Скрыть" : "Показать"}
                                onClick={() => setPwShow((v) => !v)}>
                                <i className={pwShow ? "fas fa-eye-slash" : "fas fa-eye"} />
                              </button>
                              <button className="gid-btn gid-btn-sm gid-btn-primary"
                                disabled={pwValue.length < 6} onClick={() => doResetPw(a.login)}>
                                Сбросить
                              </button>
                              <button className="gid-btn gid-btn-sm" onClick={() => { setPwTarget(""); setPwValue(""); setPwShow(false); }}>
                                Отмена
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                  {p.accounts.length === 0 && (
                    <tr><td colSpan={4} className="text-center text-[#555] py-6">Нет учётных записей — обновите список</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ОПОВЕЩЕНИЯ — полноценный редактор */}
      {activeTab === "alerts" && can("alerts.manage") && (
        <div>
          <div className="border border-[#0a4a24] bg-[#06120a] p-3 mb-3">
            <div className="text-[10px] text-[#8a8] font-bold uppercase tracking-wider mb-2">
              <i className={alEdit ? "fas fa-pen" : "fas fa-bell"} /> {alEdit ? "Редактирование оповещения" : "Новое оповещение"}
            </div>
            <div className="gid-grid2">
              <div className="gid-field">
                <label className="gid-label">Тип</label>
                <select className="gid-select" value={alType} onChange={(e) => setAlType(e.target.value as Alert["type"])}>
                  <option value="info">Инфо</option>
                  <option value="warning">Внимание</option>
                  <option value="critical">Критично</option>
                </select>
              </div>
              <div className="gid-field">
                <label className="gid-label">Название</label>
                <input className="gid-input" value={alTitle}
                  onChange={(e) => { p.clearOpFeedback(); setAlTitle(e.target.value); }}
                  placeholder="Окно на перегоне…" />
              </div>
            </div>
            <div className="gid-field">
              <label className="gid-label">Краткое описание</label>
              <input className="gid-input" value={alShort}
                onChange={(e) => { p.clearOpFeedback(); setAlShort(e.target.value); }}
                placeholder="Одна строка для полоски и списка…" />
            </div>
            <div className="gid-field">
              <label className="gid-label">Полное описание</label>
              <div className="flex gap-1 mb-1">
                <button type="button" className="gid-btn gid-btn-sm" title="Жирный"
                  onClick={() => applyWrap("**", "**", "текст")}><i className="fas fa-bold" /></button>
                <button type="button" className="gid-btn gid-btn-sm" title="Курсив"
                  onClick={() => applyWrap("*", "*", "текст")}><i className="fas fa-italic" /></button>
                <button type="button" className="gid-btn gid-btn-sm" title="Код"
                  onClick={() => applyWrap("`", "`", "команда")}><i className="fas fa-code" /></button>
                <button type="button" className="gid-btn gid-btn-sm" title="Маркированный список"
                  onClick={applyList}><i className="fas fa-list-ul" /></button>
                <button type="button" className="gid-btn gid-btn-sm" title="Ссылка"
                  onClick={() => applyWrap("[", "](https://)", "текст")}><i className="fas fa-link" /></button>
              </div>
              <textarea ref={fullRef} className="gid-textarea" value={alFull}
                onChange={(e) => { p.clearOpFeedback(); setAlFull(e.target.value); }}
                placeholder="Подробности: время, место, что делать…"
                rows={3} />
              <div className="text-[9px] text-[#555] mt-1">
                Разметка: **жирный**, *курсив*, `код`, - список, [текст](https://…)
              </div>
            </div>
            {alFull.trim() && (
              <div className="border border-[#2a2a2a] bg-[#0a0a0a] p-2 mb-2">
                <div className="text-[9px] text-[#555] uppercase tracking-wider mb-1">Предпросмотр</div>
                <div className="text-[11px] text-[#aaa] leading-relaxed">{renderAlertBody(alFull)}</div>
              </div>
            )}
            <div className="flex gap-2 items-center mt-1">
              <button className="gid-btn gid-btn-primary"
                disabled={!alTitle.trim() && !alShort.trim()}
                onClick={saveAlert}>
                <i className="fas fa-floppy-disk" /> {alEdit ? "Сохранить" : "Опубликовать"}
              </button>
              {alEdit && <button className="gid-btn" onClick={resetAlForm}>Отмена</button>}
            </div>
          </div>
          <div className="border border-[#2a2a2a] overflow-hidden">
            <div className="max-h-[300px] overflow-y-auto">
              {p.alerts.length === 0 ? <div className="text-center text-[#555] py-6">Оповещений нет</div> : (
                <table className="gid-table">
                  <thead><tr><th>Тип</th><th>Название / кратко</th><th>Автор</th><th>Время</th><th>Статус</th><th></th></tr></thead>
                  <tbody>
                    {p.alerts.map((a) => (
                      <tr key={a.id} className={alEdit === a.id ? "bg-[#0a140a]" : ""}>
                        <td>{a.type === "critical" ? <i className="fas fa-circle-exclamation" /> : a.type === "warning" ? <i className="fas fa-triangle-exclamation" /> : <i className="fas fa-circle-info" />}</td>
                        <td>
                          <div className="text-[#ddd] font-bold">{a.title || <span className="text-[#555] font-normal">Без названия</span>}</div>
                          {a.text && <div className="text-[#888] text-[10px]">{a.text}</div>}
                        </td>
                        <td className="text-[#888]">{a.author}</td>
                        <td className="text-[#666] font-mono text-[10px]">{new Date(a.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</td>
                        <td><span className={`gid-chip ${a.active ? "gid-chip-dsp" : "gid-chip-op"}`}>{a.active ? "активно" : "скрыто"}</span></td>
                        <td className="text-right whitespace-nowrap">
                          <button className="gid-btn gid-btn-sm gid-btn-info mr-1" title="Редактировать" onClick={() => startAlEdit(a)}><i className="fas fa-pen" /></button>
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
      {activeTab === "trains" && can("trains.manage") && (
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
