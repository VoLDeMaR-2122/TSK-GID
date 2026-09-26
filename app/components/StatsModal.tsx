"use client";
import { GidState, CAT_NAMES, CAT_COLORS } from "@/lib/types";
import { Alert } from "@/lib/useAlerts";
import DraggableModal from "./DraggableModal";

interface Props { state: GidState; alerts: Alert[]; onClose: () => void; }

export default function StatsModal({ state, alerts, onClose }: Props) {
  const byCat: Record<string, number> = {};
  state.trains.forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + 1; });

  const totalOps = state.trains.reduce((s, t) => s + t.stops.length, 0);
  const inTransit = state.trains.filter((t) => t.stops.some((s) => s.arr && !s.dep)).length;
  const finished = state.trains.filter((t) => t.stops.length && !t.stops[t.stops.length - 1].dep && t.stops[t.stops.length - 1].arr).length;
  const activeAlerts = alerts.filter((a) => a.active).length;

  const Stat = ({ label, value, color }: { label: string; value: number | string; color?: string }) => (
    <div className="bg-[#0d0d0d] border border-[#222] rounded p-3 text-center">
      <div className="text-2xl font-bold" style={{ color: color || "#0f0" }}>{value}</div>
      <div className="text-[9px] text-[#666] uppercase tracking-wider mt-1">{label}</div>
    </div>
  );

  return (
    <DraggableModal title="📊 Статистика участка" width={520} onClose={onClose}
      footer={<button className="gid-btn" onClick={onClose}>Закрыть</button>}>
      <div className="grid grid-cols-4 gap-2 mb-4">
        <Stat label="Всего ниток" value={state.trains.length} />
        <Stat label="В пути" value={inTransit} color="#0af" />
        <Stat label="Операций" value={totalOps} color="#ff0" />
        <Stat label="Станций" value={state.stations.length} color="#f80" />
      </div>
      <div className="gid-label mb-1.5">По категориям</div>
      <div className="space-y-1 mb-4">
        {Object.entries(byCat).map(([c, n]) => (
          <div key={c} className="flex items-center gap-2 text-[11px]">
            <span className="w-3 h-3 rounded-sm" style={{ background: CAT_COLORS[c] || "#888" }} />
            <span className="text-[#ccc] flex-1">{CAT_NAMES[c] || c}</span>
            <div className="h-2 bg-[#1a1a1a] rounded-full overflow-hidden w-[160px]">
              <div className="h-full rounded-full" style={{ width: `${(n / state.trains.length) * 100}%`, background: CAT_COLORS[c] || "#888" }} />
            </div>
            <span className="text-[#888] w-6 text-right font-bold">{n}</span>
          </div>
        ))}
        {state.trains.length === 0 && <div className="text-[#555] text-center py-3 text-[11px]">Нет данных</div>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Пометок" value={state.marks.length} color="#f0f" />
        <Stat label="Оповещений" value={activeAlerts} color={activeAlerts ? "#f55" : "#666"} />
        <Stat label="Дежурных" value="—" color="#888" />
      </div>
    </DraggableModal>
  );
}
