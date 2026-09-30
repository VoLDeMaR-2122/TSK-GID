"use client";
import { useState, useRef, useEffect } from "react";

interface Props {
  label: string;
  options: { value: string; label: string; icon?: string }[];
  onSelect: (value: string) => void;
  className?: string;
}

export default function Dropdown({ label, options, onSelect, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        className="gid-btn gid-btn-sm"
        onClick={() => setOpen((v) => !v)}
      >
        {label} <i className={`fas fa-chevron-${open ? "up" : "down"} text-[8px] ml-0.5`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-[#111] border border-[#333] rounded shadow-xl z-50 min-w-[140px] py-1">
          {options.map((o) => (
            <button
              key={o.value}
              className="w-full text-left px-3 py-1.5 text-[11px] text-[#ccc] hover:bg-[#1a1a1a] hover:text-white transition-colors flex items-center gap-2"
              onClick={() => {
                onSelect(o.value);
                setOpen(false);
              }}
            >
              {o.icon && <i className={o.icon} />}
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
