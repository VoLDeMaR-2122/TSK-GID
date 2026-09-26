"use client";
import { useState } from "react";
import { Train, CAT_NAMES, CAT_COLORS } from "@/lib/types";
import DraggableModal from "./DraggableModal";

interface Props { trains: Train[]; onSelect: (id: string) => void; onClose: () => void; }

export default function SearchModal({ trains, onSelect, onClose }: Props) {
  const [q, setQ] = useState("");
  const res = q.trim() ? trains.filter((t) =>
    t.number.toLowerCase().includes(q.toLowerCase()) ||
    (t.locoNum || "").toLowerCase().includes(q.toLowerCase()) ||
    (t.locoSeries || "").toLowerCase().includes(q.toLowerCase()) ||
    (t.driver || "").toLowerCase().includes(q.toLowerCase())
  ) : [];

  return (
    <DraggableModal title="Поиск поезда" width={520} onClose={onClose}
      footer={<button className="gid-btn" onClick={onClose}>Закрыть</button>}>
      <input
        autoFocus className="gid-input !text-[13px] !py-2 mb-3"
        placeholder="🔍 номер / локомотив / машинист..."
        value={q} onChange={(e) => setQ(e.target.value)}
      />
      <div className="border border-[#2a2a2a] rounded overflow-hidden">
        <div className="max-h-[300px] overflow-y-auto">
          {res.length === 0 ? (
            <div className="text-[#555] text-center py-8">{q ? "Ничего не найдено" : "Начните вводить запрос"}</div>
          ) : (
            <table className="gid-table">
              <thead><tr><th>№</th><th>Категория</th><th>Локомотив</th><th>Машинист</th><th>Станций</th></tr></thead>
              <tbody>
                {res.map((t) => (
                  <tr key={t.id} className="cursor-pointer" onClick={() => { onSelect(t.id); onClose(); }}>
                    <td className="font-bold" style={{ color: CAT_COLORS[t.category] || "#888" }}>{t.number}</td>
                    <td>{CAT_NAMES[t.category] || t.category}</td>
                    <td className="text-[#999]">{t.locoSeries} {t.locoNum}</td>
                    <td>{t.driver || "—"}</td>
                    <td className="text-center text-[#666]">{t.stops.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DraggableModal>
  );
}
