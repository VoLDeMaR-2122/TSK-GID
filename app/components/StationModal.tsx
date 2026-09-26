"use client";
import { useState } from "react";
import { Station } from "@/lib/types";
import DraggableModal from "./DraggableModal";

interface Props { stations: Station[]; onChange: (s: Station[]) => void; onClose: () => void; }
const uid = () => "s" + Math.random().toString(36).slice(2, 10);

export default function StationModal({ stations, onChange, onClose }: Props) {
  const [editing, setEditing] = useState<number>(-2);
  const [form, setForm] = useState({ name: "", km: "", paths: "3", code: "" });

  const startAdd = () => { setEditing(-1); setForm({ name: "", km: "", paths: "3", code: "" }); };
  const startEdit = (i: number) => {
    setEditing(i);
    const s = stations[i];
    setForm({ name: s.name, km: String(s.km), paths: String(s.paths), code: s.code });
  };
  const save = () => {
    if (!form.name) return;
    const st: Station = {
      id: editing >= 0 ? stations[editing].id : uid(),
      name: form.name, km: parseFloat(form.km) || 0, paths: parseInt(form.paths) || 1, code: form.code,
    };
    onChange(editing >= 0 ? stations.map((s, i) => i === editing ? st : s) : [...stations, st]);
    setEditing(-2);
  };
  const remove = (i: number) => onChange(stations.filter((_, idx) => idx !== i));
  const move = (i: number, dir: number) => {
    const ni = i + dir;
    if (ni < 0 || ni >= stations.length) return;
    const next = [...stations];
    [next[i], next[ni]] = [next[ni], next[i]];
    onChange(next);
  };

  return (
    <DraggableModal
      title="Редактор станций участка" width={580} onClose={onClose}
      footer={<button className="gid-btn" onClick={onClose}>Закрыть</button>}
    >
      <div className="border border-[#2a2a2a] rounded overflow-hidden mb-3">
        <div className="max-h-[300px] overflow-y-auto">
          <table className="gid-table">
            <thead><tr><th>№</th><th>Название</th><th>Км</th><th>Пути</th><th>Код ЕСР</th><th></th></tr></thead>
            <tbody>
              {stations.map((s, i) => (
                <tr key={s.id}>
                  <td className="text-[#555]">{i + 1}</td>
                  <td className="font-bold text-[#ddd]">{s.name}</td>
                  <td>{s.km}</td>
                  <td className="text-center">{s.paths}</td>
                  <td className="text-[#666]">{s.code}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="gid-btn !px-1.5 !py-0.5 mr-1" onClick={() => move(i, -1)} title="Вверх">↑</button>
                    <button className="gid-btn !px-1.5 !py-0.5 mr-1" onClick={() => move(i, 1)} title="Вниз">↓</button>
                    <button className="gid-btn gid-btn-info !px-1.5 !py-0.5 mr-1" onClick={() => startEdit(i)} title="Изменить">✎</button>
                    <button className="gid-btn gid-btn-danger !px-1.5 !py-0.5" onClick={() => remove(i)} title="Удалить">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <button className="gid-btn gid-btn-primary" onClick={startAdd}>＋ Добавить станцию</button>

      {editing !== -2 && (
        <div className="mt-3 border border-[#0a4a24] bg-[#06120a] rounded p-3">
          <div className="gid-grid2">
            <div className="gid-field"><label className="gid-label">Название</label>
              <input className="gid-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></div>
            <div className="gid-field"><label className="gid-label">Километр</label>
              <input className="gid-input" value={form.km} onChange={(e) => setForm({ ...form, km: e.target.value })} /></div>
          </div>
          <div className="gid-grid2">
            <div className="gid-field"><label className="gid-label">Кол-во путей</label>
              <input className="gid-input" value={form.paths} onChange={(e) => setForm({ ...form, paths: e.target.value })} /></div>
            <div className="gid-field"><label className="gid-label">Код станции (ЕСР)</label>
              <input className="gid-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
          </div>
          <div className="flex gap-2 mt-1">
            <button className="gid-btn gid-btn-primary" onClick={save}>💾 Сохранить</button>
            <button className="gid-btn" onClick={() => setEditing(-2)}>Отмена</button>
          </div>
        </div>
      )}
    </DraggableModal>
  );
}
