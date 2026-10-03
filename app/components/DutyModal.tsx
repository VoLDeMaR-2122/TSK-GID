"use client";
import { useState } from "react";
import { OnlineUser } from "@/lib/useOnlineUsers";
import { Role, ROLE_NAMES } from "@/lib/permissions";
import DraggableModal from "./DraggableModal";

interface Props {
  me: OnlineUser;
  presetRole?: Role;
  onUpdate: (p: Partial<OnlineUser>) => void;
  onClose: () => void;
  changeOwnPassword: (current: string, next: string) => void;
  opError: string;
  opNotice: string;
  clearOpFeedback: () => void;
}

export default function DutyModal({ me, presetRole, onUpdate, onClose, changeOwnPassword, opError, opNotice, clearOpFeedback }: Props) {
  const [name, setName] = useState(me.name);
  const [role, setRole] = useState<Role>(presetRole || me.role);
  const [time, setTime] = useState(me.dutyTime || "");
  const [area, setArea] = useState(me.area);
  const [pwCur, setPwCur] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwAgain, setPwAgain] = useState("");
  const [pwOpen, setPwOpen] = useState(false);

  const isAdmin = me.isAdmin === true;
  const isDutyRole = me.role === "dnc" || me.role === "dsp";

  const accept = () => { onUpdate({ name, role, area, dutyTime: time, onDuty: true }); onClose(); };
  const release = () => { onUpdate({ onDuty: false, dutyTime: "" }); onClose(); };

  const pwValid = pwCur.length > 0 && pwNew.length >= 6 && pwNew === pwAgain;
  const doChangePw = () => {
    if (!pwValid) return;
    changeOwnPassword(pwCur, pwNew);
    setPwCur("");
    setPwNew("");
    setPwAgain("");
  };

  return (
    <DraggableModal title="Приём / сдача дежурства" width={430} onClose={onClose}
      footer={<>
        {me.onDuty && <button className="gid-btn gid-btn-danger" onClick={release}>Сдать дежурство</button>}
        <button className="gid-btn" onClick={onClose}>Отмена</button>
        <button className="gid-btn gid-btn-primary" onClick={accept}><i className="fas fa-check" /> Принять</button>
      </>}>
      <div className="gid-field"><label className="gid-label">Фамилия дежурного</label>
        <input className="gid-input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="gid-field"><label className="gid-label">Должность</label>
        {isDutyRole && !isAdmin ? (
          <div className="gid-input opacity-60 cursor-not-allowed select-none">{ROLE_NAMES[role]}</div>
        ) : (
          <select className="gid-select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_NAMES) as Role[]).map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
          </select>
        )}
      </div>
      {isDutyRole && !isAdmin && (
        <div className="text-[10px] text-[#a64] border border-[#4a2800] rounded px-2 py-1.5 mb-2 bg-[#170c00]">
          Вы принимаете дежурство на должности «{ROLE_NAMES[role]}». Смена роли доступна только администратору.
        </div>
      )}
      <div className="gid-grid2">
        <div className="gid-field"><label className="gid-label">Время начала</label>
          <input className="gid-input" value={time} onChange={(e) => setTime(e.target.value)} placeholder="08:00" /></div>
        <div className="gid-field"><label className="gid-label">Участок / станция</label>
          <input className="gid-input" value={area} onChange={(e) => setArea(e.target.value)} /></div>
      </div>
      <div className="text-[10px] text-[#666] border-t border-[#222] pt-2 mt-1">
        Статус дежурства виден всем онлайн-пользователям в реальном времени.
      </div>

      <div className="border-t border-[#222] mt-2 pt-2">
        <button className="gid-btn gid-btn-sm w-full" onClick={() => { clearOpFeedback(); setPwOpen((v) => !v); }}>
          <i className="fas fa-key" /> Сменить пароль
        </button>
        {pwOpen && (
          <div className="mt-2">
            {opError && <div className="text-[10px] text-[#f88] mb-1.5"><i className="fas fa-triangle-exclamation" /> {opError}</div>}
            {opNotice && <div className="text-[10px] text-[#8f8] mb-1.5"><i className="fas fa-check" /> {opNotice}</div>}
            <div className="gid-field"><label className="gid-label">Текущий пароль</label>
              <input type="password" className="gid-input" value={pwCur} autoComplete="current-password"
                onChange={(e) => { clearOpFeedback(); setPwCur(e.target.value); }} /></div>
            <div className="gid-grid2">
              <div className="gid-field"><label className="gid-label">Новый (мин. 6)</label>
                <input type="password" className="gid-input" value={pwNew} autoComplete="new-password"
                  onChange={(e) => { clearOpFeedback(); setPwNew(e.target.value); }} /></div>
              <div className="gid-field"><label className="gid-label">Повтор</label>
                <input type="password" className="gid-input" value={pwAgain} autoComplete="new-password"
                  onChange={(e) => { clearOpFeedback(); setPwAgain(e.target.value); }} /></div>
            </div>
            {pwNew && pwAgain && pwNew !== pwAgain && (
              <div className="text-[10px] text-[#fa6] mb-1.5">Новый пароль и повтор не совпадают</div>
            )}
            <button className="gid-btn gid-btn-primary gid-btn-sm" disabled={!pwValid} onClick={doChangePw}>
              <i className="fas fa-floppy-disk" /> Сохранить пароль
            </button>
          </div>
        )}
      </div>
    </DraggableModal>
  );
}
