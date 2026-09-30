"use client";
import { useState } from "react";
import { Station, Mark } from "@/lib/types";
import DraggableModal from "./DraggableModal";

interface Props { stations: Station[]; initialMark?: Mark | null; onSave: (m: Mark) => void; onCancel: () => void; onDelete?: (id: string) => void; }
const uid = () => "m" + Math.random().toString(36).slice(2, 10);
const TYPES: Record<string, string> = { window: "Окно (закрытие перегона)", line: "Линия (предупреждение/работа)", text: "Текстовая пометка", delay: "Задержка", failure: "Сбойный" };

export default function MarkModal({ stations, initialMark, onSave, onCancel, onDelete }: Props) {
  const [form, setForm] = useState({
    type: initialMark?.type || "window", peregon: initialMark?.peregon ?? 0,
    start: initialMark?.start || "", end: initialMark?.end || "",
    color: initialMark?.color || "yellow", text: initialMark?.text || "", service: initialMark?.service || "",
  });
  const isSt = form.type === "text" || form.type === "delay" || form.type === "failure";
  const set = (k: string, v: string | number) => setForm((p) => ({ ...p, [k]: v }));

  const save = () => onSave({
    id: initialMark?.id || uid(), type: form.type, peregon: Number(form.peregon) || 0,
    start: form.start, end: form.end, color: form.color, text: form.text, service: form.service,
  });

  return (
    <DraggableModal
      title={initialMark ? "Пометка на графике" : "Новая пометка"} width={460} onClose={onCancel}
      footer={<>
        {initialMark && onDelete && <button className="gid-btn gid-btn-danger" onClick={() => onDelete(initialMark.id)}><i className="fas fa-trash-can" /> Удалить</button>}
        <button className="gid-btn" onClick={onCancel}>Отмена</button>
        <button className="gid-btn gid-btn-primary" onClick={save}><i className="fas fa-floppy-disk" /> Сохранить</button>
      </>}
    >
      <div className="gid-field"><label className="gid-label">Тип пометки</label>
        <select className="gid-select" value={form.type} onChange={(e) => set("type", e.target.value)}>
          {Object.entries(TYPES).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
        </select></div>

      {isSt ? (
        <div className="gid-field"><label className="gid-label">Станция</label>
          <select className="gid-select" value={form.peregon} onChange={(e) => set("peregon", e.target.value)}>
            {stations.map((s, i) => <option key={s.id} value={i}>{s.name}</option>)}
          </select></div>
      ) : (
        <div className="gid-field"><label className="gid-label">Перегон</label>
          <select className="gid-select" value={form.peregon} onChange={(e) => set("peregon", e.target.value)}>
            {stations.slice(0, -1).map((s, i) => <option key={s.id} value={i}>{s.name} — {stations[i + 1].name}</option>)}
          </select></div>
      )}

      <div className="gid-grid2">
        <div className="gid-field"><label className="gid-label">Начало (ЧЧ:ММ)</label>
          <input className="gid-input" value={form.start} onChange={(e) => set("start", e.target.value)} placeholder="10:00" /></div>
        <div className="gid-field"><label className="gid-label">Конец (ЧЧ:ММ)</label>
          <input className="gid-input" value={form.end} onChange={(e) => set("end", e.target.value)} placeholder="12:00" /></div>
      </div>

      <div className="gid-grid2">
        <div className="gid-field"><label className="gid-label">Цвет</label>
          <select className="gid-select" value={form.color} onChange={(e) => set("color", e.target.value)}>
            <option value="white"><i className="fas fa-square" /> Белый — плановое</option>
            <option value="yellow"><i className="fas fa-square" style={{color: '#ffd000'}} /> Жёлтый — фактическое</option>
            <option value="red"><i className="fas fa-square" style={{color: '#ff2525'}} /> Красный — передержка</option>
          </select></div>
        <div className="gid-field"><label className="gid-label">Служба</label>
          <select className="gid-select" value={form.service} onChange={(e) => set("service", e.target.value)}>
            <option value="">— не указана —</option>
            <option value="П">П (путь)</option><option value="Ш">Ш (СЦБ и связь)</option>
            <option value="Э">Э (электроснабжение)</option><option value="В">В (вагонное)</option>
            <option value="Т">Т (локомотивное)</option><option value="Д">Д (движение)</option>
          </select></div>
      </div>

      <div className="gid-field !mb-0"><label className="gid-label">Текст / описание</label>
        <input className="gid-input" value={form.text} onChange={(e) => set("text", e.target.value)} placeholder="Ремонт пути, ограничение скорости..." /></div>
    </DraggableModal>
  );
}
