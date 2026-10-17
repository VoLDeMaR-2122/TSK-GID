"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { GidState, CAT_COLORS, CAT_NAMES } from "@/lib/types";
import { mskTime, mskMinutes } from "@/lib/datetime";

interface Props {
  state: GidState;
  onZoomSet: (hoursVisible: number) => void;
  onSelect: (s: { type: string; id: string } | null) => void;
  onNewTrainAt: (i: number, min: number) => void;
  onEditMark: (id: string) => void;
  scrollTarget: { id: string; ts: number } | null;
}

const SH = 42;                                 // высота строки станции
const LEFT_W = 210;                            // ширина левой панели со станциями
const HEADER_H = 44;                           // высота заголовка со станциями + часы
const MC: Record<string, string> = { white: "#fff", yellow: "#ff0", red: "#f00" };
const ttm = (t: string | null | undefined) => {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  return m ? +m[1] * 60 + +m[2] : null;
};

export default function TrainGraph({ state, onZoomSet, onSelect, onNewTrainAt, onEditMark, scrollTarget }: Props) {
  const lcRef = useRef<HTMLCanvasElement>(null);
  const gcRef = useRef<HTMLCanvasElement>(null);
  const contRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [hoverSt, setHoverSt] = useState(-1);

  const hvRef = useRef(state.view.hoursVisible);
  const anchorRef = useRef<{ timeMin: number; mouseX: number } | null>(null);
  useEffect(() => { hvRef.current = state.view.hoursVisible; });

  const hw = useCallback(
    () => (contRef.current ? contRef.current.clientWidth / state.view.hoursVisible : 100),
    [state.view.hoursVisible]
  );

  // ================= НАТИВНЫЙ WHEEL =================
  useEffect(() => {
    const cont = contRef.current;
    if (!cont) return;

    const onWheelNative = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const rect = cont.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const W = cont.clientWidth / hvRef.current;
        const timeMin = ((cont.scrollLeft + mouseX) / W) * 60;
        const factor = e.deltaY < 0 ? 0.8 : 1.25;
        let nv = hvRef.current * factor;
        nv = Math.round(nv * 2) / 2;
        nv = Math.max(2, Math.min(24, nv));
        if (nv === hvRef.current) return;
        anchorRef.current = { timeMin, mouseX };
        onZoomSet(nv);
      } else {
        if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
          e.preventDefault();
          cont.scrollLeft += e.deltaY * 2;
        }
      }
    };

    cont.addEventListener("wheel", onWheelNative, { passive: false });
    return () => cont.removeEventListener("wheel", onWheelNative);
  }, [onZoomSet, hw]);

  // Автоскролл к поезду из поиска
  useEffect(() => {
    if (!scrollTarget || !contRef.current) return;
    const tr = state.trains.find((t) => t.id === scrollTarget.id);
    if (!tr || !tr.stops.length) return;
    const min = ttm(tr.stops[0].dep) || ttm(tr.stops[0].arr) || 0;
    contRef.current.scrollLeft = Math.max(0, (min / 60) * hw() - contRef.current.clientWidth / 2);
  }, [scrollTarget, hw, state.trains]);

  // ================= ОТРИСОВКА =================
  useEffect(() => {
    const draw = () => {
      const W = hw(), totalW = 24 * W;
      const totalH = Math.max(contRef.current?.clientHeight || 700, state.stations.length * SH + HEADER_H + 40);

      // ---- Левая панель со станциями (точно как на скриншоте ГИДа) ----
      const lc = lcRef.current;
      if (lc) {
        const c = lc.getContext("2d")!;
        lc.width = LEFT_W; lc.height = totalH;
        c.fillStyle = "#060606"; c.fillRect(0, 0, LEFT_W, totalH);

        // Заголовок колонки станций
        c.fillStyle = "#555"; c.font = "bold 10px Consolas, monospace";
        c.fillText("СТАНЦИЯ", 8, 18);

        state.stations.forEach((st, i) => {
          const cy = HEADER_H + i * SH + SH / 2;
          if (i === hoverSt) {
            c.fillStyle = "#141c14";
            c.fillRect(0, HEADER_H + i * SH, LEFT_W, SH);
          }
          // Горизонтальный разделитель между станциями
          c.strokeStyle = "#151515"; c.beginPath();
          c.moveTo(0, HEADER_H + i * SH + SH - .5); c.lineTo(LEFT_W, HEADER_H + i * SH + SH - .5); c.stroke();

          // Название станции (крупное, как на скриншоте)
          c.font = "bold 13px Consolas, monospace";
          c.fillStyle = i === hoverSt ? "#fff" : "#e0e0e0";
          c.fillText(st.name, 8, cy + 5, 130);

          // КМ под названием
          c.font = "10px Consolas, monospace"; c.fillStyle = "#777";
          c.fillText("км " + st.km.toFixed(0), 8, cy + 20, 70);

          // Число путей
          c.fillStyle = "#5a5a5a";
          c.fillText(String(st.paths) + " пут", LEFT_W - 58, cy + 5, 50);

          // Код станции справа
          c.fillStyle = "#4a4a4a"; c.textAlign = "right";
          c.fillText(st.code, LEFT_W - 8, cy + 5); c.textAlign = "left";
        });

        c.strokeStyle = "#252525"; c.beginPath(); c.moveTo(LEFT_W - .5, 0); c.lineTo(LEFT_W - .5, totalH); c.stroke();
      }

      // ---- График ----
      const gc = gcRef.current;
      if (!gc) return;
      const c = gc.getContext("2d")!;
      gc.width = totalW; gc.height = totalH;
      gc.style.width = totalW + "px"; gc.style.height = totalH + "px";
      c.fillStyle = "#020202"; c.fillRect(0, 0, totalW, totalH);

      // Подсветка строки станции под курсором
      if (hoverSt >= 0 && hoverSt < state.stations.length) {
        c.fillStyle = "#0a100a"; c.fillRect(0, HEADER_H + hoverSt * SH, totalW, SH);
      }

      // Сетка: минуты (тонкие, как на скриншоте)
      c.strokeStyle = "#0c0c0c"; c.lineWidth = 1; c.beginPath();
      for (let hr = 0; hr < 24; hr++) for (const m of [10, 20, 30, 40, 50]) {
        const x = (hr + m / 60) * W; c.moveTo(x + .5, HEADER_H); c.lineTo(x + .5, totalH);
      }
      c.stroke();
      // Получас
      c.strokeStyle = "#121212"; c.beginPath();
      for (let hr = 0; hr < 24; hr++) { const x = (hr + .5) * W; c.moveTo(x + .5, HEADER_H); c.lineTo(x + .5, totalH); }
      c.stroke();
      // Часы + подписи сверху (точно как на скриншоте)
      for (let hr = 0; hr <= 24; hr++) {
        const x = hr * W;
        c.strokeStyle = "#1f1f1f"; c.beginPath(); c.moveTo(x + .5, HEADER_H); c.lineTo(x + .5, totalH); c.stroke();
        if (hr < 24) {
          c.fillStyle = "#777"; c.font = "bold 11px Consolas, monospace";
          c.fillText(String(hr).padStart(2, "0"), x + 4, HEADER_H - 10);
          c.fillStyle = "#333"; c.font = "9px Consolas, monospace";
          c.fillText("30", x + W / 2 + 2, HEADER_H - 10);
        }
      }
      // Горизонтальные линии станций через весь график
      state.stations.forEach((_, i) => {
        const y = HEADER_H + i * SH + SH / 2;
        c.strokeStyle = "#111"; c.beginPath(); c.moveTo(0, y + .5); c.lineTo(totalW, y + .5); c.stroke();
      });

      // ---- Пометки ----
      state.marks.forEach((mk) => {
        const a = ttm(mk.start), b = ttm(mk.end);
        if (a === null || b === null) return;
        const x1 = (a / 60) * W, x2 = (b / 60) * W;
        const col = MC[mk.color] || "#fff";
        const sel = state.selected?.type === "mark" && state.selected?.id === mk.id;
        if (mk.type === "window") {
          const p = mk.peregon; if (p >= state.stations.length - 1) return;
          const y1 = HEADER_H + (p + 1) * SH, y2 = HEADER_H + (p + 2) * SH;
          c.fillStyle = col + "15"; c.fillRect(x1, y1, x2 - x1, y2 - y1);
          c.save(); c.beginPath(); c.rect(x1, y1, x2 - x1, y2 - y1); c.clip();
          c.strokeStyle = col + "55"; c.lineWidth = 1;
          for (let xx = x1 - (y2 - y1); xx < x2; xx += 7) { c.beginPath(); c.moveTo(xx, y2); c.lineTo(xx + (y2 - y1), y1); c.stroke(); }
          c.restore();
          c.strokeStyle = col; c.lineWidth = sel ? 2 : 1;
          c.setLineDash(sel ? [5, 3] : []); c.strokeRect(x1 + .5, y1 + .5, x2 - x1, y2 - y1); c.setLineDash([]);
          if (mk.text) { c.fillStyle = col; c.font = "bold 9px Consolas, monospace"; c.textAlign = "center"; c.fillText(mk.text, (x1 + x2) / 2, (y1 + y2) / 2 + 3); c.textAlign = "left"; }
        } else if (mk.type === "line") {
          const p = mk.peregon; if (p >= state.stations.length - 1) return;
          const my = HEADER_H + (p + 1.5) * SH;
          c.strokeStyle = col; c.lineWidth = sel ? 3 : 2;
          c.beginPath(); c.moveTo(x1, my); c.lineTo(x2, my); c.stroke();
          if (mk.text) { c.fillStyle = col; c.font = "9px Consolas, monospace"; c.fillText(mk.text, x1 + 4, my - 5); }
        } else if (mk.type === "text") {
          const y = HEADER_H + (mk.peregon + .5) * SH;
          c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.moveTo(x1, y - 8); c.lineTo(x1, y + 8); c.stroke();
          c.fillStyle = col; c.font = "10px Consolas, monospace"; c.fillText(mk.text || "", x1 + 4, y + 3);
        } else {
          const y = HEADER_H + (mk.peregon + .5) * SH;
          c.strokeStyle = col; c.lineWidth = 2;
          c.beginPath(); c.moveTo(x1 - 5, y - 5); c.lineTo(x1 + 5, y + 5); c.moveTo(x1 + 5, y - 5); c.lineTo(x1 - 5, y + 5); c.stroke();
          if (mk.text) { c.fillStyle = col; c.font = "9px Consolas, monospace"; c.fillText(mk.text, x1 + 9, y + 3); }
        }
      });

      // ---- Нитки поездов ----
      for (const tr of state.trains) {
        const col = CAT_COLORS[tr.category] || "#888";
        const sel = state.selected?.type === "train" && state.selected?.id === tr.id;

        c.save();
        if (sel) { c.shadowColor = col; c.shadowBlur = 12; }
        c.strokeStyle = col; c.lineWidth = sel ? 3 : 2; c.lineJoin = "round"; c.lineCap = "round";

        // ---- Рисуем нитку: горизонталь на станции + диагональ между станциями ----
        for (let i = 0; i < tr.stops.length; i++) {
          const s1 = tr.stops[i];
          const si = state.stations.findIndex((s) => s.id === s1.stationId);
          if (si < 0) continue;
          const y1 = HEADER_H + si * SH + SH / 2;
          const a = ttm(s1.arr), d = ttm(s1.dep);

          // Горизонтальный участок на станции (прибытие → отправление)
          if (a !== null && d !== null && a !== d) {
            c.beginPath(); c.moveTo((a / 60) * W, y1); c.lineTo((d / 60) * W, y1); c.stroke();
          }

          // Диагональ к следующей станции (перегон)
          if (i < tr.stops.length - 1) {
            const s2 = tr.stops[i + 1];
            const si2 = state.stations.findIndex((s) => s.id === s2.stationId);
            if (si2 < 0) continue;
            const y2 = HEADER_H + si2 * SH + SH / 2;
            const sm = d !== null ? d : a, em = ttm(s2.arr) ?? ttm(s2.dep);
            if (sm !== null && em !== null) {
              c.beginPath(); c.moveTo((sm / 60) * W, y1); c.lineTo((em / 60) * W, y2); c.stroke();
            }
          }

          // Точки прибытия/отправления только на станциях (маленькие кружочки)
          for (const mm of [a, d] as (number | null)[]) {
            if (mm === null) continue;
            const x = (mm / 60) * W;
            c.fillStyle = col; c.beginPath(); c.arc(x, y1, 2, 0, Math.PI * 2); c.fill();
          }

          // Время прибытия/отправления у станции
          for (const [mm, lbl, off] of [[a, s1.arr, -8], [d, s1.dep, 16]] as [number | null, string | null | undefined, number][]) {
            if (mm === null || !lbl) continue;
            const x = (mm / 60) * W;
            c.font = "8px Consolas, monospace";
            const twl = c.measureText(lbl).width;
            c.fillStyle = "#0008"; c.fillRect(x - twl / 2 - 1, y1 + off - 6, twl + 2, 8);
            c.fillStyle = "#aaa"; c.textAlign = "center"; c.fillText(lbl, x, y1 + off); c.textAlign = "left";
          }
        }
        c.restore();

        // ---- Номера поездов: в начале и конце нитки, параллельно линии ----
        if (!state.showNumbers) continue;

        // Собираем точки нитки: каждая станция с временем (arr или dep)
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i < tr.stops.length; i++) {
          const s1 = tr.stops[i];
          const si = state.stations.findIndex((s) => s.id === s1.stationId);
          if (si < 0) continue;
          const y = HEADER_H + si * SH + SH / 2;
          const a = ttm(s1.arr), d = ttm(s1.dep);
          // Берём время отправления, а если нет — прибытие
          const t = d !== null ? d : a;
          if (t !== null) pts.push({ x: (t / 60) * W, y });
        }

        if (pts.length < 1) continue;

        c.font = "bold 11px Consolas, monospace";
        const tw = c.measureText(tr.number).width + 8;
        const boxH = 14;

        // Функция рисования номера на участке между двумя точками
        const drawNumAt = (x1: number, y1: number, x2: number, y2: number) => {
          const dx = x2 - x1, dy = y2 - y1;
          const len = Math.hypot(dx, dy);
          if (len < tw + 8) return false;
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          let ang = Math.atan2(dy, dx);
          if (ang > Math.PI / 2) ang -= Math.PI;
          else if (ang < -Math.PI / 2) ang += Math.PI;

          c.save();
          c.translate(mx, my);
          c.rotate(ang);
          c.fillStyle = "#000";
          c.fillRect(-tw / 2, -boxH / 2, tw, boxH);
          c.strokeStyle = col; c.lineWidth = 1.5;
          c.strokeRect(-tw / 2 + .5, -boxH / 2 + .5, tw - 1, boxH - 1);
          c.fillStyle = col;
          c.textAlign = "center"; c.textBaseline = "middle";
          c.fillText(tr.number, 0, 1);
          c.restore();
          return true;
        };

        // Номер в начале нитки: между первой и второй точкой (если есть), иначе в первой точке
        if (pts.length >= 2) {
          drawNumAt(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
        } else {
          // одна точка — рисуем прямо в точке, горизонтально
          c.save();
          c.translate(pts[0].x, pts[0].y);
          c.fillStyle = "#000";
          c.fillRect(-tw / 2, -boxH / 2, tw, boxH);
          c.strokeStyle = col; c.lineWidth = 1.5;
          c.strokeRect(-tw / 2 + .5, -boxH / 2 + .5, tw - 1, boxH - 1);
          c.fillStyle = col;
          c.textAlign = "center"; c.textBaseline = "middle";
          c.fillText(tr.number, 0, 1);
          c.restore();
        }

        // Номер в конце нитки: между предпоследней и последней точкой
        if (pts.length >= 3) {
          drawNumAt(pts[pts.length - 2].x, pts[pts.length - 2].y, pts[pts.length - 1].x, pts[pts.length - 1].y);
        }
      }

      // ---- Текущее время (красная линия, как на скриншоте) ----
      const nx = (mskMinutes() / 60) * W;
      c.strokeStyle = "#f00"; c.lineWidth = 1.5; c.setLineDash([6, 5]);
      c.beginPath(); c.moveTo(nx + .5, HEADER_H); c.lineTo(nx + .5, totalH); c.stroke(); c.setLineDash([]);
      c.fillStyle = "#f00"; c.beginPath();
      c.moveTo(nx - 6, HEADER_H); c.lineTo(nx + 6, HEADER_H); c.lineTo(nx, HEADER_H + 8); c.closePath(); c.fill();
      c.fillStyle = "#ff6666"; c.font = "bold 10px Consolas, monospace";
      c.fillText(mskTime(), nx + 8, HEADER_H + 18);
    };

    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [state, hoverSt, hw]);

  // Якорь зума
  useEffect(() => {
    const a = anchorRef.current;
    const cont = contRef.current;
    if (!a || !cont) return;
    const W = cont.clientWidth / state.view.hoursVisible;
    cont.scrollLeft = Math.max(0, (a.timeMin / 60) * W - a.mouseX);
    anchorRef.current = null;
  }, [state.view.hoursVisible]);

  // ================= HIT-TEST =================
  const hitTest = (cx: number, cy: number) => {
    const W = hw();
    for (let i = state.marks.length - 1; i >= 0; i--) {
      const mk = state.marks[i];
      const a = ttm(mk.start), b = ttm(mk.end);
      if (a === null || b === null) continue;
      const x1 = (a / 60) * W, x2 = (b / 60) * W;
      if (mk.type === "window") {
        const p = mk.peregon; if (p >= state.stations.length - 1) continue;
        if (cx >= x1 && cx <= x2 && cy >= HEADER_H + (p + 1) * SH && cy <= HEADER_H + (p + 2) * SH) return { type: "mark", id: mk.id };
      } else if (mk.type === "line") {
        const p = mk.peregon; if (p >= state.stations.length - 1) continue;
        if (cx >= x1 && cx <= x2 && Math.abs(cy - (HEADER_H + (p + 1.5) * SH)) < 6) return { type: "mark", id: mk.id };
      }
    }
    for (let i = state.trains.length - 1; i >= 0; i--) {
      const tr = state.trains[i];
      for (let j = 0; j < tr.stops.length; j++) {
        const s1 = tr.stops[j];
        const si = state.stations.findIndex((s) => s.id === s1.stationId);
        if (si < 0) continue;
        const y1 = HEADER_H + si * SH + SH / 2;
        const a = ttm(s1.arr), d = ttm(s1.dep);
        if (a !== null && Math.abs(cx - (a / 60) * W) < 8 && Math.abs(cy - y1) < 10) return { type: "train", id: tr.id };
        if (d !== null && Math.abs(cx - (d / 60) * W) < 8 && Math.abs(cy - y1) < 10) return { type: "train", id: tr.id };
        if (a !== null && d !== null && cy > y1 - 6 && cy < y1 + 6 && cx >= Math.min(a, d) / 60 * W && cx <= Math.max(a, d) / 60 * W) return { type: "train", id: tr.id };
        if (j < tr.stops.length - 1) {
          const s2 = tr.stops[j + 1];
          const si2 = state.stations.findIndex((s) => s.id === s2.stationId);
          if (si2 < 0) continue;
          const y2 = HEADER_H + si2 * SH + SH / 2;
          const x1 = ((d ?? a ?? 0) / 60) * W, x2 = ((ttm(s2.arr) ?? ttm(s2.dep) ?? 0) / 60) * W;
          const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
          if (l2 < 1) continue;
          const t = ((cx - x1) * dx + (cy - y1) * dy) / l2;
          if (t < 0 || t > 1) continue;
          if (Math.hypot(cx - (x1 + t * dx), cy - (y1 + t * dy)) < 7) return { type: "train", id: tr.id };
        }
      }
    }
    return null;
  };

  const coords = (e: React.MouseEvent) => {
    const r = gcRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onMove = (e: React.MouseEvent) => {
    const { x, y } = coords(e);
    const si = Math.floor((y - HEADER_H) / SH);
    setHoverSt((prev) => (prev !== si ? si : prev));
    const hit = hitTest(x, y);
    if (hit?.type === "train") {
      const tr = state.trains.find((t) => t.id === hit.id)!;
      setTip({ x: e.clientX, y: e.clientY, text: `№${tr.number} · ${CAT_NAMES[tr.category] || tr.category}\n${tr.locoSeries || ""} ${tr.locoNum || ""} · ${tr.driver || "—"}` });
    } else if (hit?.type === "mark") {
      const mk = state.marks.find((m) => m.id === hit.id)!;
      setTip({ x: e.clientX, y: e.clientY, text: `Пометка: ${mk.type}\n${mk.start} — ${mk.end}${mk.text ? "\n" + mk.text : ""}` });
    } else setTip(null);
  };

  const onClick = (e: React.MouseEvent) => { const { x, y } = coords(e); onSelect(hitTest(x, y)); };
  const onDbl = (e: React.MouseEvent) => {
    const { x, y } = coords(e);
    const hit = hitTest(x, y);
    if (hit?.type === "mark") { onEditMark(hit.id); return; }
    if (hit?.type === "train") { onSelect(hit); return; }
    const si = Math.floor((y - HEADER_H) / SH);
    if (si >= 0 && si < state.stations.length) onNewTrainAt(si, Math.round((x / hw()) * 60));
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className={`w-[${LEFT_W}px] bg-[#060606] shrink-0 flex flex-col overflow-hidden border-r border-[#1f1f1f]`}>
        <div className="flex-1 overflow-hidden"><canvas ref={lcRef} className="block" /></div>
      </div>
      <div ref={contRef} className="flex-1 overflow-auto bg-[#020202] relative cursor-crosshair"
        onClick={onClick} onDoubleClick={onDbl} onMouseMove={onMove} onMouseLeave={() => { setTip(null); setHoverSt(-1); }}>
        <canvas ref={gcRef} className="block absolute top-0 left-0" />
      </div>
      {tip && <div className="gid-tooltip" style={{ left: tip.x + 16, top: tip.y - 8 }}>{tip.text}</div>}
    </div>
  );
}
