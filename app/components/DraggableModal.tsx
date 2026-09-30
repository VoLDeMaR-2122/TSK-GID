"use client";
import { useEffect, useRef, useState, useCallback, ReactNode } from "react";

interface Props {
  title: string;
  width?: number;
  minW?: number;
  minH?: number;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

export default function DraggableModal({
  title, width = 520, minW = 320, minH = 180, onClose, footer, children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const drag = useRef<{ mode: "move" | "resize" | null; ox: number; oy: number }>({ mode: null, ox: 0, oy: 0 });

  // ВАЖНО: окно рендерится ВСЕГДА, ref прикреплён.
  // Здесь после mount читаем реальные размеры и ставим в центр.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const maxH = window.innerHeight - 32;
    setSize({ w, h: Math.min(h, maxH) });
    setPos({
      x: Math.max(8, Math.round((window.innerWidth - w) / 2)),
      y: 16,
    });
  }, []);

  const onHeaderDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { mode: "move", ox: e.clientX - (pos?.x ?? 0), oy: e.clientY - (pos?.y ?? 0) };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos]);

  const onResizeDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    drag.current = { mode: "resize", ox: e.clientX, oy: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.mode) return;
    if (d.mode === "move") {
      setPos({
        x: Math.min(window.innerWidth - 80, Math.max(0, e.clientX - d.ox)),
        y: Math.min(window.innerHeight - 34, Math.max(0, e.clientY - d.oy)),
      });
    } else {
      setSize((s) => ({
        w: Math.max(minW, Math.min(window.innerWidth - (pos?.x ?? 0) - 8, (s?.w ?? width) + (e.clientX - d.ox))),
        h: Math.max(minH, Math.min(window.innerHeight - (pos?.y ?? 0) - 8, (s?.h ?? 300) + (e.clientY - d.oy))),
      }));
      d.ox = e.clientX;
      d.oy = e.clientY;
    }
  }, [pos, minW, minH, width]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    drag.current.mode = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }, []);

  const center = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setPos({
      x: Math.max(8, Math.round((window.innerWidth - el.offsetWidth) / 2)),
      y: 16,
    });
  }, []);

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Затемнение фона */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Окно рендерится ВСЕГДА. Пока pos нет — visibility:hidden (но размеры считаются). */}
      <div
        ref={ref}
        className="gid-modal absolute"
        style={{
          left: pos?.x ?? 0,
          top: pos?.y ?? 0,
          width: size?.w ?? width,
          height: size?.h ?? undefined,
          maxHeight: "calc(100vh - 32px)",
          visibility: pos ? "visible" : "hidden",
        }}
      >
        <div
          className="gid-modal-header"
          style={{ cursor: "grab" }}
          onPointerDown={onHeaderDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <span className="gid-modal-title"><span className="dot" />{title}</span>
          <span className="flex items-center gap-0.5">
            <button className="gid-modal-icon-btn" onClick={center} title="В центр"><i className="fas fa-circle-dot" /></button>
            <button className="gid-modal-icon-btn close" onClick={onClose} title="Закрыть (Esc)"><i className="fas fa-xmark" /></button>
          </span>
        </div>

        <div className="gid-modal-body">{children}</div>

        {footer && <div className="gid-modal-footer">{footer}</div>}

        <div className="gid-resize-handle" onPointerDown={onResizeDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
      </div>
    </div>
  );
}
