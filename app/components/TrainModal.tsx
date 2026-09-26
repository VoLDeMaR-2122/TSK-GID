"use client";
import { useState } from "react";
import { Station, Train, TrainStop, CAT_NAMES } from "@/lib/types";
import DraggableModal from "./DraggableModal";

interface Props {
  stations: Station[];
  initialTrain?: Train | null;
  presetStationIdx?: number;
  presetMin?: number;
  onSave: (train: Train) => void;
  onCancel: () => void;
  onDelete?: (id: string) => void;
}

const uid = () => "t" + Math.random().toString(36).slice(2, 10);
function minToTime(min: number) {
  min = ((min % 1440) + 1440) % 1440;
  return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
}
function timeToMin(t: string | null | undefined) {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
}

export default function TrainModal({ stations, initialTrain, presetStationIdx, presetMin, onSave, onCancel, onDelete }: Props) {
  const [form, setForm] = useState({
    number: initialTrain?.number || "", category: initialTrain?.category || "freight",
    locoSeries: initialTrain?.locoSeries || "", locoNum: initialTrain?.locoNum || "",
    driver: initialTrain?.driver || "", weight: initialTrain?.weight || "",
    length: initialTrain?.length || "", cargo: initialTrain?.cargo || "",
    naturka: initialTrain?.naturka || "", index: initialTrain?.index || "", note: initialTrain?.note || "",
  });
  const [stops, setStops] = useState<TrainStop[]>(() => {
    if (initialTrain) return JSON.parse(JSON.stringify(initialTrain.stops));
    if (presetStationIdx !== undefined && stations[presetStationIdx]) {
      const st = stations[presetStationIdx];
      return [{ stationId: st.id, arr: presetMin !== undefined ? minToTime(presetMin) : "", dep: presetMin !== undefined ? minToTime(presetMin + 2) : "", path: 1 }];
    }
    return [{ stationId: stations[0]?.id || "", arr: "", dep: "", path: 1 }];
  });

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const updStop = (i: number, f: keyof TrainStop, v: string | number) => setStops((p) => p.map((s, idx) => idx === i ? { ...s, [f]: v } : s));
  const addStop = () => setStops((p) => [...p, { stationId: stations[0]?.id || "", arr: "", dep: "", path: 1 }]);
  const delStop = (i: number) => setStops((p) => p.filter((_, idx) => idx !== i));
  const stoyanka = (s: TrainStop) => {
    const a = timeToMin(s.arr), d = timeToMin(s.dep);
    if (a !== null && d !== null && d > a) { const x = d - a; return Math.floor(x / 60) + "ч " + (x % 60) + "м"; }
    return "-";
  };

  const save = () => {
    onSave({
      id: initialTrain?.id || uid(),
      number: form.number || "???", category: form.category,
      locoSeries: form.locoSeries, locoNum: form.locoNum, driver: form.driver,
      weight: form.weight, length: form.length, cargo: form.cargo,
      naturka: form.naturka, index: form.index, note: form.note,
      stops: stops.filter((s) => s.stationId)
        .map((s) => ({ ...s, path: Number(s.path) || 1 }))
        .sort((a, b) => (timeToMin(a.arr) || timeToMin(a.dep) || 0) - (timeToMin(b.arr) || timeToMin(b.dep) || 0)),
    });
  };

  return (
    <DraggableModal
      title={initialTrain ? `Нитка поезда № ${initialTrain.number}` : "Новая нитка поезда"}
      width={620}
      onClose={onCancel}
      footer={<>
        {initialTrain && onDelete && <button className="gid-btn gid-btn-danger" onClick={() => onDelete(initialTrain.id)}>🗑 Удалить</button>}
        <button className="gid-btn" onClick={onCancel}>Отмена</button>
        <button className="gid-btn gid-btn-primary" onClick={save}>💾 Сохранить</button>
      </>}
    >
      <div className="gid-grid2">
        <div className="gid-field"><label className="gid-label">Номер поезда</label>
          <input className="gid-input" value={form.number} onChange={(e) => set("number", e.target.value)} placeholder="3401" /></div>
        <div className="gid-field"><label className="gid-label">Категория</label>
          <select className="gid-select" value={form.category} onChange={(e) => set("category", e.target.value)}>
            {Object.entries(CAT_NAMES).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
          </select></div>
      </div>
      <div className="gid-grid2">
        <div className="gid-field"><label className="gid-label">Серия локомотива</label>
          <input className="gid-input" value={form.locoSeries} onChange={(e) => set("locoSeries", e.target.value)} placeholder="ВЛ10" /></div>
        <div className="gid-field"><label className="gid-label">Номер локомотива</label>
          <input className="gid-input" value={form.locoNum} onChange={(e) => set("locoNum", e.target.value)} placeholder="1234" /></div>
      </div>
      <div className="gid-grid2">
        <div className="gid-field"><label className="gid-label">Машинист (ФИО)</label>
          <input className="gid-input" value={form.driver} onChange={(e) => set("driver", e.target.value)} placeholder="Иванов И.И." /></div>
        <div className="gid-field"><label className="gid-label">Вес, т / Длина, ваг.</label>
          <div className="flex gap-2">
            <input className="gid-input" value={form.weight} onChange={(e) => set("weight", e.target.value)} placeholder="4500" />
            <input className="gid-input" value={form.length} onChange={(e) => set("length", e.target.value)} placeholder="71" />
          </div></div>
      </div>
      <div className="gid-grid3">
        <div className="gid-field"><label className="gid-label">Род груза</label>
          <input className="gid-input" value={form.cargo} onChange={(e) => set("cargo", e.target.value)} placeholder="уголь" /></div>
        <div className="gid-field"><label className="gid-label">Натурный лист</label>
          <input className="gid-input" value={form.naturka} onChange={(e) => set("naturka", e.target.value)} placeholder="1234567" /></div>
        <div className="gid-field"><label className="gid-label">Индекс поезда</label>
          <input className="gid-input" value={form.index} onChange={(e) => set("index", e.target.value)} placeholder="0000-1234-3" /></div>
      </div>

      <div className="gid-field">
        <label className="gid-label">Остановки по станциям</label>
        <div className="border border-[#2a2a2a] rounded overflow-hidden">
          <div className="max-h-[220px] overflow-y-auto">
            <table className="gid-table">
              <thead><tr><th>Станция</th><th>Прибытие</th><th>Отправление</th><th>Путь</th><th>Стоянка</th><th></th></tr></thead>
              <tbody>
                {stops.map((s, i) => (
                  <tr key={i}>
                    <td>
                      <select className="gid-select !w-[120px] !py-0.5" value={s.stationId} onChange={(e) => updStop(i, "stationId", e.target.value)}>
                        {stations.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                      </select>
                    </td>
                    <td><input className="gid-input !w-[58px] !py-0.5" value={s.arr || ""} onChange={(e) => updStop(i, "arr", e.target.value)} placeholder="чч:мм" /></td>
                    <td><input className="gid-input !w-[58px] !py-0.5" value={s.dep || ""} onChange={(e) => updStop(i, "dep", e.target.value)} placeholder="чч:мм" /></td>
                    <td><input className="gid-input !w-[38px] !py-0.5 text-center" value={s.path} onChange={(e) => updStop(i, "path", e.target.value)} /></td>
                    <td className="text-[#777] text-center">{stoyanka(s)}</td>
                    <td><span onClick={() => delStop(i)} className="text-[#722] hover:text-[#f55] cursor-pointer px-1">✕</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <button className="gid-btn mt-1.5 !py-1" onClick={addStop}>＋ Добавить остановку</button>
      </div>

      <div className="gid-field !mb-0"><label className="gid-label">Примечание</label>
        <textarea className="gid-textarea" value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="Особые условия, ограничения..." /></div>
    </DraggableModal>
  );
}
