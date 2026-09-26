"use client";
import { useState } from "react";
import { OnlineUser } from "@/lib/useOnlineUsers";
import { Role, ROLE_NAMES } from "@/lib/permissions";
import DraggableModal from "./DraggableModal";

interface Props { me: OnlineUser; presetRole?: Role; onUpdate: (p: Partial<OnlineUser>) => void; onClose: () => void; }

export default function DutyModal({ me, presetRole, onUpdate, onClose }: Props) {
  const [name, setName] = useState(me.name);
  const [role, setRole] = useState<Role>(presetRole || me.role);
  const [time, setTime] = useState(me.dutyTime || "");
  const [area, setArea] = useState(me.area);

  const accept = () => { onUpdate({ name, role, area, dutyTime: time, onDuty: true }); onClose(); };
  const release = () => { onUpdate({ onDuty: false, dutyTime: "" }); onClose(); };

  return (
    <DraggableModal title="Приём / сдача дежурства" width={430} onClose={onClose}
      footer={<>
        {me.onDuty && <button className="gid-btn gid-btn-danger" onClick={release}>Сдать дежурство</button>}
        <button className="gid-btn" onClick={onClose}>Отмена</button>
        <button className="gid-btn gid-btn-primary" onClick={accept}>✓ Принять</button>
      </>}>
      <div className="gid-field"><label className="gid-label">Фамилия дежурного</label>
        <input className="gid-input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="gid-field"><label className="gid-label">Должность</label>
        <select className="gid-select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {(Object.keys(ROLE_NAMES) as Role[]).map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
        </select></div>
      <div className="gid-grid2">
        <div className="gid-field"><label className="gid-label">Время начала</label>
          <input className="gid-input" value={time} onChange={(e) => setTime(e.target.value)} placeholder="08:00" /></div>
        <div className="gid-field"><label className="gid-label">Участок / станция</label>
          <input className="gid-input" value={area} onChange={(e) => setArea(e.target.value)} /></div>
      </div>
      <div className="text-[10px] text-[#666] border-t border-[#222] pt-2 mt-1">
        Статус дежурства виден всем онлайн-пользователям в реальном времени.
      </div>
    </DraggableModal>
  );
}
