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

const SH = 42;                                 // базовая высота строки станции
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
  const [wideSt, setWideSt] = useState(-1); // индекс станции с расширенной линией (двойной клик слева)
  const [rowScale, setRowScale] = useState(1); // коэффициент высоты строки станции (ручное управление)
  const [btnHover, setBtnHover] = useState<'minus' | 'plus' | null>(null); // наведение на кнопку −/+ на строке станции

  // Высота строки станции: только выбранная станция может быть расширена (х3 при двойном клике),
  // остальные — всегда базовой высоты SH. rowScale управляет только высотой wideSt.
  const stationHeight = useCallback((i: number) => {
    if (i === wideSt) return SH * rowScale;
    return SH;
  }, [wideSt, rowScale]);

  // Верхняя координата строки станции с учётом расширенных станций выше
  const stationTop = useCallback((i: number) => {
    let top = HEADER_H;
    for (let k = 0; k < i; k++) {
      top += stationHeight(k);
    }
    return top;
  }, [stationHeight]);

  const stationCenter = useCallback((i: number) => stationTop(i) + stationHeight(i) / 2, [stationTop, stationHeight]);

  // Найти индекс станции по координате Y с учётом расширенных строк
  const stationIndexFromY = useCallback((y: number) => {
    let top = HEADER_H;
    for (let i = 0; i < state.stations.length; i++) {
      const h = stationHeight(i);
      if (y >= top && y < top + h) return i;
      top += h;
    }
    return -1;
  }, [stationHeight, state.stations.length]);

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
      const totalH = Math.max(contRef.current?.clientHeight || 700,
        HEADER_H + state.stations.reduce((sum, _, i) => sum + stationHeight(i), 0) + 40);

      // ---- Левая панель со станциями ----
      const lc = lcRef.current;
      if (lc) {
        const c = lc.getContext("2d")!;
        lc.width = LEFT_W; lc.height = totalH;
        c.fillStyle = "#060606"; c.fillRect(0, 0, LEFT_W, totalH);

        // Заголовок колонки станций
        c.fillStyle = "#555"; c.font = "bold 10px Consolas, monospace";
        c.fillText("СТАНЦИЯ", 8, 18);

        state.stations.forEach((st, i) => {
          const cy = stationCenter(i);
          const ch = stationHeight(i);
          const top = stationTop(i);
          const isWide = i === wideSt;

          // Фон строки станции (расширенная — темно-красный, наведение — тёмный зелёный)
          if (i === hoverSt && !isWide) {
            c.fillStyle = "#141c14";
            c.fillRect(0, top, LEFT_W, ch);
          }
          if (isWide) {
            c.fillStyle = "#1a0a0a";
            c.fillRect(0, top, LEFT_W, ch);
          }

          // Горизонтальный разделитель между станциями (полная ширина панели)
          c.strokeStyle = "#151515"; c.beginPath();
          c.moveTo(0, top + ch - .5); c.lineTo(LEFT_W, top + ch - .5); c.stroke();

          // Название станции (крупное, слева, отдельная строка)
          c.font = "bold 15px Consolas, monospace";
          c.fillStyle = isWide ? "#ff9999" : i === hoverSt ? "#fff" : "#e8e8e8";
          c.fillText(st.name, 8, top + 18, 140);

          // КМ (зеленый, слева снизу строки станции)
          c.font = "11px Consolas, monospace";
          c.fillStyle = "#00cc44";
          c.fillText("км " + st.km.toFixed(0), 8, top + 32, 60);

          // Число путей (серый, справа сверху строки станции)
          c.fillStyle = "#7a7a7a";
          c.textAlign = "right";
          c.fillText(st.paths + " пут", LEFT_W - 8, top + 15, 50); c.textAlign = "left";

          // Код станции (серый, справа снизу строки станции)
          c.fillStyle = isWide ? "#ff6666" : "#6a6a6a";
          c.textAlign = "right";
          c.fillText(st.code || "—", LEFT_W - 8, top + ch - 10); c.textAlign = "left";

          // Кнопки управления высотой строки (только на расширенной станции, вертикально)
          if (isWide) {
            const btnW = 24, btnH = 16;
            const gap = 4;
            const totalH = btnH * 2 + gap;
            const btnX = LEFT_W - 4 - btnW;
            const btnY = cy - totalH / 2;
            const btnY2 = btnY + btnH + gap;

            // Кнопка + (верхняя)
            c.fillStyle = btnHover === 'plus' ? "#2a2a2a" : "#121212";
            c.strokeStyle = btnHover === 'plus' ? "#5a5a5a" : "#3a3a3a";
            c.lineWidth = 1.5;
            c.beginPath(); c.roundRect(btnX, btnY, btnW, btnH, 2); c.fill(); c.stroke();
            c.fillStyle = "#fff"; c.font = "bold 12px Consolas, monospace";
            c.textAlign = "center"; c.textBaseline = "middle";
            c.fillText("+", btnX + btnW / 2, btnY + btnH / 2);

            // Кнопка − (нижняя)
            c.fillStyle = btnHover === 'minus' ? "#2a2a2a" : "#121212";
            c.strokeStyle = btnHover === 'minus' ? "#5a5a5a" : "#3a3a3a";
            c.beginPath(); c.roundRect(btnX, btnY2, btnW, btnH, 2); c.fill(); c.stroke();
            c.fillStyle = "#fff";
            c.fillText("−", btnX + btnW / 2, btnY2 + btnH / 2);
            c.textAlign = "left"; c.textBaseline = "alphabetic";
          }

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

      // Подсветка строки станции под курсором (только её блок)
      if (hoverSt >= 0 && hoverSt < state.stations.length) {
        c.fillStyle = "#0a100a"; c.fillRect(0, stationTop(hoverSt), totalW, stationHeight(hoverSt));
      }

      // Сетка: полные вертикальные линии между станциями (через весь график)
      c.strokeStyle = "#0c0c0c"; c.lineWidth = 1; c.beginPath();
      for (let hr = 0; hr < 24; hr++) for (const m of [10, 20, 30, 40, 50]) {
        const x = (hr + m / 60) * W; c.moveTo(x + .5, HEADER_H); c.lineTo(x + .5, totalH);
      }
      c.stroke();
      // Получас
      c.strokeStyle = "#121212"; c.beginPath();
      for (let hr = 0; hr < 24; hr++) { const x = (hr + .5) * W; c.moveTo(x + .5, HEADER_H); c.lineTo(x + .5, totalH); }
      c.stroke();
      // Часы + подписи сверху
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

      // Горизонтальные линии станций через весь график с делениями (как у настоящего ГИДа)
      state.stations.forEach((_, i) => {
        const cy = stationCenter(i);
        const ch = stationHeight(i);
        const top = stationTop(i);
        const isWide = i === wideSt;

        // Серáя линия посередине для ВСЕХ станций (отметки ниток)
        c.strokeStyle = "#222"; c.lineWidth = 2;
        c.beginPath(); c.moveTo(0, cy + .5); c.lineTo(totalW, cy + .5); c.stroke();
        c.lineWidth = 1;

        if (isWide) {
          // Красная обводка только по краям (верх и низ) для расширенной станции
          c.strokeStyle = "#ff4444"; c.lineWidth = 2;
          c.beginPath(); c.moveTo(0, top + .5); c.lineTo(totalW, top + .5); c.stroke();
          c.beginPath(); c.moveTo(0, top + ch - .5); c.lineTo(totalW, top + ch - .5); c.stroke();
          c.lineWidth = 1;
        }

        // Деления на линии станции (отметки времени, как на линейке ГИДа)
        c.strokeStyle = "#1a1a1a"; c.lineWidth = 1; c.beginPath();
        for (let hr = 0; hr <= 24; hr++) {
          for (const m of [0, 10, 20, 30, 40, 50]) {
            const x = (hr + m / 60) * W;
            if (x > 0 && x < totalW) {
              c.moveTo(x + .5, cy - 4);
              c.lineTo(x + .5, cy + 4);
            }
          }
        }
        c.stroke();
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
          const y1 = stationCenter(p + 1), y2 = stationCenter(p + 2);
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
          const my = (stationCenter(p + 1) + stationCenter(p + 2)) / 2;
          c.strokeStyle = col; c.lineWidth = sel ? 3 : 2;
          c.beginPath(); c.moveTo(x1, my); c.lineTo(x2, my); c.stroke();
          if (mk.text) { c.fillStyle = col; c.font = "9px Consolas, monospace"; c.fillText(mk.text, x1 + 4, my - 5); }
        } else if (mk.type === "text") {
          const p = mk.peregon; if (p >= state.stations.length - 1) return;
          const y = (stationCenter(p) + stationCenter(p + 1)) / 2;
          c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.moveTo(x1, y - 8); c.lineTo(x1, y + 8); c.stroke();
          c.fillStyle = col; c.font = "10px Consolas, monospace"; c.fillText(mk.text || "", x1 + 4, y + 3);
        } else {
          const p = mk.peregon; if (p >= state.stations.length - 1) return;
          const y = (stationCenter(p) + stationCenter(p + 1)) / 2;
          c.strokeStyle = col; c.lineWidth = 2;
          c.beginPath(); c.moveTo(x1 - 5, y - 5); c.lineTo(x1 + 5, y + 5); c.moveTo(x1 + 5, y - 5); c.lineTo(x1 - 5, y + 5); c.stroke();
          if (mk.text) { c.fillStyle = col; c.font = "9px Consolas, monospace"; c.fillText(mk.text, x1 + 9, y + 3); }
        }
      });

      // ---- Нитки поездов (чистые, без точек разъединения) ----
      // Массив уже posicionovaných номеров для проверки наложения
      const placedNums: { x: number; y: number; w: number; h: number }[] = [];

      const tryDrawNum = (x: number, y: number, ang: number, number: string, col: string) => {
        c.font = "bold 11px Consolas, monospace";
        const tw = c.measureText(number).width + 10;
        const boxH = 15;
        const halfW = tw / 2;
        const halfH = boxH / 2;

        // Проверка наложения с уже поставленными номерами (с отступом 6 px)
        for (const pn of placedNums) {
          if (Math.abs(x - pn.x) < halfW + pn.w / 2 + 6 && Math.abs(y - pn.y) < halfH + pn.h / 2 + 6) {
            return false;
          }
        }

        c.save();
        c.translate(x, y);
        c.rotate(ang);
        c.fillStyle = "#000";
        c.fillRect(-halfW, -halfH, tw, boxH);
        c.strokeStyle = col; c.lineWidth = 1.5;
        c.strokeRect(-halfW + .5, -halfH + .5, tw - 1, boxH - 1);
        c.fillStyle = col;
        c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(number, 0, 1);
        c.restore();

        placedNums.push({ x, y, w: tw, h: boxH });
        return true;
      };

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
          const y1 = stationCenter(si);
          const isWideSt = si === wideSt;
          const a = ttm(s1.arr), d = ttm(s1.dep);

          // Горизонтальный участок на станции (прибытие → отправление)
          if (a !== null && d !== null && a !== d) {
            c.beginPath(); c.moveTo((a / 60) * W, y1); c.lineTo((d / 60) * W, y1); c.stroke();
          }

          // Диагональ к следующей станции (перегон) — чистая линия без точек
          if (i < tr.stops.length - 1) {
            const s2 = tr.stops[i + 1];
            const si2 = state.stations.findIndex((s) => s.id === s2.stationId);
            if (si2 < 0) continue;
            const y2 = stationCenter(si2);
            const sm = d !== null ? d : a, em = ttm(s2.arr) ?? ttm(s2.dep);
            if (sm !== null && em !== null) {
              c.beginPath(); c.moveTo((sm / 60) * W, y1); c.lineTo((em / 60) * W, y2); c.stroke();
            }
          }

          // Время прибытия/отправления у станции (подпись только, без точек)
          for (const [mm, lbl, off] of [[a, s1.arr, -10], [d, s1.dep, 20]] as [number | null, string | null | undefined, number][]) {
            if (mm === null || !lbl) continue;
            const x = (mm / 60) * W;
            c.font = "8px Consolas, monospace";
            const twl = c.measureText(lbl).width;
            c.fillStyle = "#0008"; c.fillRect(x - twl / 2 - 1, y1 + off - 7, twl + 2, 9);
            c.fillStyle = isWideSt ? col : "#888"; c.textAlign = "center"; c.fillText(lbl, x, y1 + off); c.textAlign = "left";
          }
        }
        c.restore();

        // ---- Номера поездов вдоль нитки, без наложения на соседей ----
        if (!state.showNumbers) continue;

        // Собираем все точки нитки (станции с временем)
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i < tr.stops.length; i++) {
          const s1 = tr.stops[i];
          const si = state.stations.findIndex((s) => s.id === s1.stationId);
          if (si < 0) continue;
          const y = stationCenter(si);
          const a = ttm(s1.arr), d = ttm(s1.dep);
          const t = d !== null ? d : a;
          if (t !== null) pts.push({ x: (t / 60) * W, y });
        }

        if (pts.length < 1) continue;

        c.font = "bold 11px Consolas, monospace";
        const tw = c.measureText(tr.number).width + 10;

        // Ставим номера на каждом участке нитки, где хватает места, с проверкой наложения
        for (let i = 0; i < pts.length - 1; i++) {
          const x1 = pts[i].x, y1 = pts[i].y;
          const x2 = pts[i + 1].x, y2 = pts[i + 1].y;
          const dx = x2 - x1, dy = y2 - y1;
          const len = Math.hypot(dx, dy);
          if (len < tw + 20) continue;

          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          let ang = Math.atan2(dy, dx);
          if (ang > Math.PI / 2) ang -= Math.PI;
          else if (ang < -Math.PI / 2) ang += Math.PI;

          tryDrawNum(mx, my, ang, tr.number, col);
        }

        // Если только одна точка — ставим номер горизонтально
        if (pts.length === 1) {
          tryDrawNum(pts[0].x, pts[0].y, 0, tr.number, col);
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
  }, [state, hoverSt, wideSt, rowScale, hw, stationTop, stationHeight, stationCenter, btnHover]);

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
        if (cx >= x1 && cx <= x2 && cy >= stationTop(p + 1) && cy <= stationTop(p + 2) + stationHeight(p + 2)) return { type: "mark", id: mk.id };
      } else if (mk.type === "line") {
        const p = mk.peregon; if (p >= state.stations.length - 1) continue;
        if (cx >= x1 && cx <= x2 && Math.abs(cy - (stationCenter(p + 1) + stationCenter(p + 2)) / 2) < 6) return { type: "mark", id: mk.id };
      }
    }
    for (let i = state.trains.length - 1; i >= 0; i--) {
      const tr = state.trains[i];
      for (let j = 0; j < tr.stops.length; j++) {
        const s1 = tr.stops[j];
        const si = state.stations.findIndex((s) => s.id === s1.stationId);
        if (si < 0) continue;
        const y1 = stationCenter(si);
        const a = ttm(s1.arr), d = ttm(s1.dep);
        if (a !== null && Math.abs(cx - (a / 60) * W) < 8 && Math.abs(cy - y1) < 10) return { type: "train", id: tr.id };
        if (d !== null && Math.abs(cx - (d / 60) * W) < 8 && Math.abs(cy - y1) < 10) return { type: "train", id: tr.id };
        if (a !== null && d !== null && cy > y1 - 6 && cy < y1 + 6 && cx >= Math.min(a, d) / 60 * W && cx <= Math.max(a, d) / 60 * W) return { type: "train", id: tr.id };
        if (j < tr.stops.length - 1) {
          const s2 = tr.stops[j + 1];
          const si2 = state.stations.findIndex((s) => s.id === s2.stationId);
          if (si2 < 0) continue;
          const y2 = stationCenter(si2);
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
    const si = stationIndexFromY(y);
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
    const si = stationIndexFromY(y);
    if (si >= 0 && si < state.stations.length) onNewTrainAt(si, Math.round((x / hw()) * 60));
  };

  const onDblLeft = (e: React.MouseEvent) => {
    const r = lcRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    // Если двойной клик по кнопкам −/+ — не переключаем станцию
    if (wideSt >= 0) {
      const cy = stationCenter(wideSt);
      const btnW = 24, btnH = 16;
      const gap = 4;
      const totalH = btnH * 2 + gap;
      const btnX = LEFT_W - 4 - btnW;
      const btnY = cy - totalH / 2;
      const btnY2 = btnY + btnH + gap;
      if (x >= btnX && x <= btnX + btnW) {
        if ((y >= btnY && y <= btnY + btnH) || (y >= btnY2 && y <= btnY2 + btnH)) return;
      }
    }
    const si = stationIndexFromY(y);
    if (si >= 0 && si < state.stations.length) {
      if (si === wideSt) {
        setWideSt(-1);
        setRowScale(1);
      } else {
        setWideSt(si);
        setRowScale(3);
      }
    }
  };

  const onMoveLeft = (e: React.MouseEvent) => {
    const r = lcRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (wideSt >= 0) {
      const cy = stationCenter(wideSt);
      const btnW = 24, btnH = 16;
      const gap = 4;
      const totalH = btnH * 2 + gap;
      const btnX = LEFT_W - 4 - btnW;
      const btnY = cy - totalH / 2;
      const btnY2 = btnY + btnH + gap;
      if (x >= btnX && x <= btnX + btnW) {
        if (y >= btnY && y <= btnY + btnH) setBtnHover('plus');
        else if (y >= btnY2 && y <= btnY2 + btnH) setBtnHover('minus');
        else setBtnHover(null);
      } else setBtnHover(null);
    } else {
      setBtnHover(null);
    }
  };

  const onClickLeft = (e: React.MouseEvent) => {
    const r = lcRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    // Кнопки −/+ на строке расширенной станции (вертикально, внутри границ)
    if (wideSt >= 0) {
      const cy = stationCenter(wideSt);
      const btnW = 24, btnH = 16;
      const gap = 4;
      const totalH = btnH * 2 + gap;
      const btnX = LEFT_W - 4 - btnW;
      const btnY = cy - totalH / 2;
      const btnY2 = btnY + btnH + gap;
      if (x >= btnX && x <= btnX + btnW) {
        if (y >= btnY && y <= btnY + btnH) {
          setRowScale((prev) => Math.min(5.0, Math.round((prev + 0.1) * 10) / 10));
          return;
        }
        if (y >= btnY2 && y <= btnY2 + btnH) {
          setRowScale((prev) => Math.max(0.5, Math.round((prev - 0.1) * 10) / 10));
          return;
        }
      }
    }
    // Клик по станции — сброс наведения/выделения
    const si = stationIndexFromY(y);
    if (si >= 0) setHoverSt(si);
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className={`w-[${LEFT_W}px] bg-[#060606] shrink-0 flex flex-col overflow-hidden border-r border-[#1f1f1f]`}
        onClick={onClickLeft} onDoubleClick={onDblLeft} onMouseMove={onMoveLeft} onMouseLeave={() => { setHoverSt(-1); setBtnHover(null); }}>
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
