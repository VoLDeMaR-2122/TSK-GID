"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { GidState, CAT_COLORS, CAT_NAMES } from "@/lib/types";

interface Props {
  state: GidState;
  onZoomSet: (hoursVisible: number) => void;
  onSelect: (s: { type: string; id: string } | null) => void;
  onNewTrainAt: (i: number, min: number) => void;
  onEditMark: (id: string) => void;
  scrollTarget: { id: string; ts: number } | null;
}

const SH = 36;
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

  // Актуальные значения для нативного слушателя (чтобы не пересоздавать его каждый рендер).
  // Обновляем в эффекте, а не в теле компонента: ref нельзя трогать во время рендера.
  const hvRef = useRef(state.view.hoursVisible);
  const anchorRef = useRef<{ timeMin: number; mouseX: number } | null>(null);
  useEffect(() => { hvRef.current = state.view.hoursVisible; });

  // ширина часа на канвасе — стабильный колбэк, чтобы эффекты не переподписывались зря
  const hw = useCallback(
    () => (contRef.current ? contRef.current.clientWidth / state.view.hoursVisible : 100),
    [state.view.hoursVisible]
  );

  // ================= НАТИВНЫЙ WHEEL (Ctrl+колесо = зум, колесо = скролл) =================
  useEffect(() => {
    const cont = contRef.current;
    if (!cont) return;

    const onWheelNative = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault(); // теперь реально работает — слушатель НЕ passive
        const rect = cont.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const W = cont.clientWidth / hvRef.current;
        // время (в минутах) под курсором — якорь зума
        const timeMin = ((cont.scrollLeft + mouseX) / W) * 60;
        // вверх = приближаем (меньше часов), вниз = отдаляем
        const factor = e.deltaY < 0 ? 0.8 : 1.25;
        let nv = hvRef.current * factor;
        nv = Math.round(nv * 2) / 2; // шаг 0.5 часа
        nv = Math.max(2, Math.min(24, nv));
        if (nv === hvRef.current) return;
        anchorRef.current = { timeMin, mouseX };
        onZoomSet(nv);
      } else {
        // обычное колесо — горизонтальная прокрутка графика
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
      const totalH = Math.max(contRef.current?.clientHeight || 600, state.stations.length * SH + 20);

      // ---- Левая панель ----
      const lc = lcRef.current;
      if (lc) {
        const c = lc.getContext("2d")!;
        lc.width = 180; lc.height = totalH;
        c.fillStyle = "#0a0a0a"; c.fillRect(0, 0, 180, totalH);
        state.stations.forEach((st, i) => {
          const y = i * SH;
          if (i === hoverSt) { c.fillStyle = "#141c14"; c.fillRect(0, y, 180, SH); }
          c.strokeStyle = "#1e1e1e"; c.beginPath(); c.moveTo(0, y + SH - .5); c.lineTo(180, y + SH - .5); c.stroke();
          c.font = "bold 11px Consolas, monospace"; c.fillStyle = i === hoverSt ? "#fff" : "#c8c8c8";
          c.fillText(st.name, 7, y + 14, 100);
          c.font = "9px Consolas, monospace"; c.fillStyle = "#5f5f5f"; c.fillText("км " + st.km, 7, y + 26);
          c.fillStyle = "#3d3d3d"; c.fillText(String(st.paths) + " пут.", 55, y + 26);
          c.fillStyle = "#4a4a4a"; c.textAlign = "right"; c.fillText(st.code, 174, y + 14); c.textAlign = "left";
        });
        c.strokeStyle = "#2a2a2a"; c.beginPath(); c.moveTo(179.5, 0); c.lineTo(179.5, totalH); c.stroke();
      }

      // ---- График ----
      const gc = gcRef.current;
      if (!gc) return;
      const c = gc.getContext("2d")!;
      gc.width = totalW; gc.height = totalH;
      gc.style.width = totalW + "px"; gc.style.height = totalH + "px";
      c.fillStyle = "#000"; c.fillRect(0, 0, totalW, totalH);

      if (hoverSt >= 0 && hoverSt < state.stations.length) {
        c.fillStyle = "#0d140d"; c.fillRect(0, hoverSt * SH, totalW, SH);
      }

      // сетка: минуты
      c.strokeStyle = "#101010"; c.lineWidth = 1; c.beginPath();
      for (let hr = 0; hr < 24; hr++) for (const m of [10, 20, 40, 50]) {
        const x = (hr + m / 60) * W; c.moveTo(x + .5, 0); c.lineTo(x + .5, totalH);
      }
      c.stroke();
      // получас
      c.strokeStyle = "#181818"; c.beginPath();
      for (let hr = 0; hr < 24; hr++) { const x = (hr + .5) * W; c.moveTo(x + .5, 0); c.lineTo(x + .5, totalH); }
      c.stroke();
      // часы + подписи
      for (let hr = 0; hr <= 24; hr++) {
        const x = hr * W;
        c.strokeStyle = "#262626"; c.beginPath(); c.moveTo(x + .5, 0); c.lineTo(x + .5, totalH); c.stroke();
        if (hr < 24) {
          c.fillStyle = "#999"; c.font = "bold 11px Consolas, monospace"; c.fillText(String(hr).padStart(2, "0"), x + 4, 14);
          c.fillStyle = "#3f3f3f"; c.font = "9px Consolas, monospace"; c.fillText("30", x + W / 2 + 3, 14);
        }
      }
      state.stations.forEach((_, i) => {
        const y = i * SH;
        c.strokeStyle = "#1c1c1c"; c.beginPath(); c.moveTo(0, y + .5); c.lineTo(totalW, y + .5); c.stroke();
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
          const y1 = (p + 1) * SH, y2 = (p + 2) * SH;
          c.fillStyle = col + "22"; c.fillRect(x1, y1, x2 - x1, y2 - y1);
          c.save(); c.beginPath(); c.rect(x1, y1, x2 - x1, y2 - y1); c.clip();
          c.strokeStyle = col + "66"; c.lineWidth = 1;
          for (let xx = x1 - (y2 - y1); xx < x2; xx += 7) { c.beginPath(); c.moveTo(xx, y2); c.lineTo(xx + (y2 - y1), y1); c.stroke(); }
          c.restore();
          c.strokeStyle = col; c.lineWidth = sel ? 2 : 1;
          c.setLineDash(sel ? [5, 3] : []); c.strokeRect(x1 + .5, y1 + .5, x2 - x1, y2 - y1); c.setLineDash([]);
          if (mk.text) { c.fillStyle = col; c.font = "bold 9px Consolas, monospace"; c.textAlign = "center"; c.fillText(mk.text, (x1 + x2) / 2, (y1 + y2) / 2 + 3); c.textAlign = "left"; }
        } else if (mk.type === "line") {
          const p = mk.peregon; if (p >= state.stations.length - 1) return;
          const my = (p + 1.5) * SH;
          c.strokeStyle = col; c.lineWidth = sel ? 3 : 2;
          c.beginPath(); c.moveTo(x1, my); c.lineTo(x2, my); c.stroke();
          if (mk.text) { c.fillStyle = col; c.font = "9px Consolas, monospace"; c.fillText(mk.text, x1 + 4, my - 5); }
        } else if (mk.type === "text") {
          const y = (mk.peregon + .5) * SH;
          c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.moveTo(x1, y - 8); c.lineTo(x1, y + 8); c.stroke();
          c.fillStyle = col; c.font = "10px Consolas, monospace"; c.fillText(mk.text || "", x1 + 4, y + 3);
        } else {
          const y = (mk.peregon + .5) * SH;
          c.strokeStyle = col; c.lineWidth = 2;
          c.beginPath(); c.moveTo(x1 - 5, y - 5); c.lineTo(x1 + 5, y + 5); c.moveTo(x1 + 5, y - 5); c.lineTo(x1 - 5, y + 5); c.stroke();
          if (mk.text) { c.fillStyle = col; c.font = "9px Consolas, monospace"; c.fillText(mk.text, x1 + 9, y + 3); }
        }
      });

      // ---- Нитки ----
      // Таблички с номерами рисуем после всех линий: номера стоят на нитке, цветом нитки,
      // а стрелки направления бронируем, чтобы номера их не закрывали.
      const numLabels: { t: string; col: string; seg: { x1: number; y1: number; x2: number; y2: number }; fracs: number[]; pri: number }[] = [];
      const arrowRects: { x0: number; y0: number; x1: number; y1: number }[] = [];

      state.trains.forEach((tr) => {
        const col = CAT_COLORS[tr.category] || "#888";
        const sel = state.selected?.type === "train" && state.selected?.id === tr.id;
        const pts: { x: number; y: number }[] = [];

        for (let i = 0; i < tr.stops.length; i++) {
          const s1 = tr.stops[i];
          const si = state.stations.findIndex((s) => s.id === s1.stationId);
          if (si < 0) continue;
          const y1 = si * SH + SH / 2;
          const a = ttm(s1.arr), d = ttm(s1.dep);
          if (a !== null) pts.push({ x: (a / 60) * W, y: y1 });
          if (d !== null) pts.push({ x: (d / 60) * W, y: y1 });
          if (i < tr.stops.length - 1) {
            const s2 = tr.stops[i + 1];
            const si2 = state.stations.findIndex((s) => s.id === s2.stationId);
            if (si2 < 0) continue;
            const y2 = si2 * SH + SH / 2;
            const sm = d !== null ? d : a, em = ttm(s2.arr) ?? ttm(s2.dep);
            if (sm !== null && em !== null) pts.push({ x: (em / 60) * W, y: y2 });
          }
        }

        c.save();
        if (sel) { c.shadowColor = col; c.shadowBlur = 10; }
        c.strokeStyle = col; c.lineWidth = sel ? 2.5 : 1.5; c.lineJoin = "round";

        // участки нитки — по ним же вешаем номер поезда вдоль линии
        const segs: { x1: number; y1: number; x2: number; y2: number }[] = [];

        for (let i = 0; i < tr.stops.length; i++) {
          const s1 = tr.stops[i];
          const si = state.stations.findIndex((s) => s.id === s1.stationId);
          if (si < 0) continue;
          const y1 = si * SH + SH / 2;
          const a = ttm(s1.arr), d = ttm(s1.dep);
          if (a !== null && d !== null && a !== d) { c.beginPath(); c.moveTo((a / 60) * W, y1); c.lineTo((d / 60) * W, y1); c.stroke(); segs.push({ x1: (a / 60) * W, y1, x2: (d / 60) * W, y2: y1 }); }
          if (i < tr.stops.length - 1) {
            const s2 = tr.stops[i + 1];
            const si2 = state.stations.findIndex((s) => s.id === s2.stationId);
            if (si2 < 0) continue;
            const y2 = si2 * SH + SH / 2;
            const sm = d !== null ? d : a, em = ttm(s2.arr) ?? ttm(s2.dep);
            if (sm !== null && em !== null) {
              const x1 = (sm / 60) * W, x2 = (em / 60) * W;
              c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
              segs.push({ x1, y1, x2, y2 });
              const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
              if (len > 34) {
                const ux = dx / len, uy = dy / len;
                c.fillStyle = col; c.beginPath();
                c.moveTo(mx + ux * 6, my + uy * 6);
                c.lineTo(mx - ux * 3 + uy * 3.5, my - uy * 3 - ux * 3.5);
                c.lineTo(mx - ux * 3 - uy * 3.5, my - uy * 3 + ux * 3.5);
                c.closePath(); c.fill();
                // бронь под стрелку: таблички с номерами не должны её закрывать
                arrowRects.push({ x0: mx - 8, y0: my - 8, x1: mx + 8, y1: my + 8 });
              }
            }
          }
          c.shadowBlur = 0;
          for (const [mm, lbl, off] of [[a, s1.arr, -6], [d, s1.dep, 13]] as [number | null, string | null | undefined, number][]) {
            if (mm === null || !lbl) continue;
            const x = (mm / 60) * W;
            c.fillStyle = col; c.beginPath(); c.arc(x, y1, 3, 0, Math.PI * 2); c.fill();
            if (state.showTimeMarks) {
              c.font = "8px Consolas, monospace";
              const tw = c.measureText(lbl).width;
              c.fillStyle = "#000c"; c.fillRect(x - tw / 2 - 1, y1 + off - 7, tw + 2, 9);
              c.fillStyle = "#999"; c.textAlign = "center"; c.fillText(lbl, x, y1 + off); c.textAlign = "left";
            }
          }
          c.shadowBlur = sel ? 10 : 0;
        }
        c.restore();

        if (state.showNumbers && pts.length) {
          // Как в реальном ГИДе: номер поезда — табличка на самой нитке, на прямом участке
          // между изломами. В начале и в конце нитки; на короткой нитке — одна табличка.
          c.font = "bold 10px Consolas, monospace";
          const tw = c.measureText(tr.number).width + 10;
          const head = pts[0], tail = pts[pts.length - 1];
          const span = Math.hypot(tail.x - head.x, tail.y - head.y);

          // годятся участки, где табличка помещается целиком и не наезжает на излом
          const fits = segs.filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= tw + 10);

          if (fits.length) {
            numLabels.push({ t: tr.number, col, seg: fits[0], fracs: [0.5, 0.28, 0.72, 0.16, 0.84], pri: 0 });
            if (span >= tw + 14) numLabels.push({ t: tr.number, col, seg: fits[fits.length - 1], fracs: [0.5, 0.72, 0.28, 0.84, 0.16], pri: 1 });
          } else {
            // нитка короткая — одна табличка в начале, на станционной линии
            numLabels.push({ t: tr.number, col, seg: { x1: head.x, y1: head.y, x2: head.x + tw, y2: head.y }, fracs: [0.5], pri: 0 });
          }
        }
      });

      // ---- Таблички с номерами: стоят на нитке, цветом нитки, стрелки не перекрывают ----
      if (state.showNumbers && numLabels.length) {
        c.save();
        c.font = "bold 10px Consolas, monospace";
        c.textAlign = "center";
        c.textBaseline = "middle";
        const boxH = 12;

        // сначала номера в начале ниток, потом в конце — при споре за место выигрывает начало
        numLabels.sort((a, b) => a.pri - b.pri);

        // занятые прямоугольники: стрелки уже заняты, табличка их не перекрывает
        const taken: { x0: number; y0: number; x1: number; y1: number }[] = arrowRects.map((r) => ({ ...r }));
        const GAP = 2;

        for (const l of numLabels) {
          const boxW = c.measureText(l.t).width + 10;
          let ang = Math.atan2(l.seg.y2 - l.seg.y1, l.seg.x2 - l.seg.x1);
          if (ang > Math.PI / 2) ang -= Math.PI;        // текст всегда слева направо
          else if (ang < -Math.PI / 2) ang += Math.PI;
          const cos = Math.cos(ang), sin = Math.sin(ang);
          const ux = cos, uy = sin;                      // вдоль нитки

          // Табличка строго на нитке и строго внутри её участка (между изломами):
          // перебираем доли участка и сдвиги вдоль линии, отступов в сторону нет.
          const segLen = Math.hypot(l.seg.x2 - l.seg.x1, l.seg.y2 - l.seg.y1);
          const maxShift = Math.max(0, (segLen - boxW + 12) / 2);
          const clamp = (v: number) => Math.max(-maxShift, Math.min(maxShift, v));

          const cands: { f: number; sh: number }[] = [];
          for (const f of l.fracs) for (const sh of [0, clamp(boxW + 8), clamp(-(boxW + 8))]) cands.push({ f, sh });

          let placed = false;
          outer: for (const { f, sh } of cands) {
            const px = l.seg.x1 + (l.seg.x2 - l.seg.x1) * f + ux * sh;
            const py = l.seg.y1 + (l.seg.y2 - l.seg.y1) * f + uy * sh;
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const [lx, ly] of [[-boxW / 2, -boxH / 2], [boxW / 2, -boxH / 2], [-boxW / 2, boxH / 2], [boxW / 2, boxH / 2]] as [number, number][]) {
              const ex = px + lx * cos - ly * sin;
              const ey = py + lx * sin + ly * cos;
              x0 = Math.min(x0, ex); y0 = Math.min(y0, ey);
              x1 = Math.max(x1, ex); y1 = Math.max(y1, ey);
            }
            if (taken.some((r) => x0 - GAP < r.x1 && x1 + GAP > r.x0 && y0 - GAP < r.y1 && y1 + GAP > r.y0)) continue;

            taken.push({ x0, y0, x1, y1 });
            c.save();
            c.translate(px, py);
            c.rotate(ang);
            // табличка лежит прямо на нитке: чёрный фон, рамка и цифры — цветом нитки
            c.fillStyle = "#000";
            c.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
            c.strokeStyle = l.col; c.lineWidth = 1;
            c.strokeRect(-boxW / 2 + .5, -boxH / 2 + .5, boxW - 1, boxH - 1);
            c.fillStyle = l.col;
            c.fillText(l.t, 0, .5);
            c.restore();
            placed = true;
            break outer;
          }
          // если все места заняты — номер не рисуем, лучше пусто, чем каша
          if (!placed) continue;
        }
        c.restore();
      }

      // ---- Текущее время ----
      const now = new Date();
      const nx = ((now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60) / 60) * W;
      c.strokeStyle = "#f00"; c.lineWidth = 1; c.setLineDash([5, 4]);
      c.beginPath(); c.moveTo(nx + .5, 0); c.lineTo(nx + .5, totalH); c.stroke(); c.setLineDash([]);
      c.fillStyle = "#f00"; c.beginPath();
      c.moveTo(nx - 5, 0); c.lineTo(nx + 5, 0); c.lineTo(nx, 8); c.closePath(); c.fill();
      c.font = "bold 9px Consolas, monospace"; c.fillStyle = "#f55";
      c.fillText(String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0"), nx + 7, 9);
    };

    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [state, hoverSt, hw]);

  // Применение якоря — СТРОГО после отрисовки (эффект ниже эффекта draw):
  // канвас уже новой ширины, и scrollLeft не обрежется по старому размеру.
  // Так точка времени под курсором остаётся на месте при Ctrl+колесо.
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
        if (cx >= x1 && cx <= x2 && cy >= (p + 1) * SH && cy <= (p + 2) * SH) return { type: "mark", id: mk.id };
      } else if (mk.type === "line") {
        const p = mk.peregon; if (p >= state.stations.length - 1) continue;
        if (cx >= x1 && cx <= x2 && Math.abs(cy - (p + 1.5) * SH) < 5) return { type: "mark", id: mk.id };
      }
    }
    for (let i = state.trains.length - 1; i >= 0; i--) {
      const tr = state.trains[i];
      for (let j = 0; j < tr.stops.length; j++) {
        const s1 = tr.stops[j];
        const si = state.stations.findIndex((s) => s.id === s1.stationId);
        if (si < 0) continue;
        const y1 = si * SH + SH / 2;
        const a = ttm(s1.arr), d = ttm(s1.dep);
        if (a !== null && Math.abs(cx - (a / 60) * W) < 7 && Math.abs(cy - y1) < 9) return { type: "train", id: tr.id };
        if (d !== null && Math.abs(cx - (d / 60) * W) < 7 && Math.abs(cy - y1) < 9) return { type: "train", id: tr.id };
        if (a !== null && d !== null && cy > y1 - 5 && cy < y1 + 5 && cx >= Math.min(a, d) / 60 * W && cx <= Math.max(a, d) / 60 * W) return { type: "train", id: tr.id };
        if (j < tr.stops.length - 1) {
          const s2 = tr.stops[j + 1];
          const si2 = state.stations.findIndex((s) => s.id === s2.stationId);
          if (si2 < 0) continue;
          const y2 = si2 * SH + SH / 2;
          const x1 = ((d ?? a ?? 0) / 60) * W, x2 = ((ttm(s2.arr) ?? ttm(s2.dep) ?? 0) / 60) * W;
          const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
          if (l2 < 1) continue;
          const t = ((cx - x1) * dx + (cy - y1) * dy) / l2;
          if (t < 0 || t > 1) continue;
          if (Math.hypot(cx - (x1 + t * dx), cy - (y1 + t * dy)) < 6) return { type: "train", id: tr.id };
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
    const si = Math.floor(y / SH);
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
    const si = Math.floor(y / SH);
    if (si >= 0 && si < state.stations.length) onNewTrainAt(si, Math.round((x / hw()) * 60));
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-[180px] bg-[#0a0a0a] shrink-0 flex flex-col overflow-hidden border-r border-[#222]">
        <div className="flex-1 overflow-hidden"><canvas ref={lcRef} className="block" /></div>
      </div>
      <div ref={contRef} className="flex-1 overflow-auto bg-black relative cursor-crosshair"
        onClick={onClick} onDoubleClick={onDbl} onMouseMove={onMove} onMouseLeave={() => { setTip(null); setHoverSt(-1); }}>
        <canvas ref={gcRef} className="block absolute top-0 left-0" />
      </div>
      {tip && <div className="gid-tooltip" style={{ left: tip.x + 16, top: tip.y - 8 }}>{tip.text}</div>}
    </div>
  );
}
