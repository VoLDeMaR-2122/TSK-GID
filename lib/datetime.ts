/**
 * Московское время для всего ГИДа.
 *
 * Любая дата/время в интерфейсе берётся отсюда. Иначе у дежурного в другом
 * часовом поясе часы в шапке, метка «сейчас» на графике и отметки ДСП
 * разойдутся между собой.
 *
 * Europe/Moscow — это константный UTC+3 (перехода на летнее время больше нет),
 * но через Intl остаётся правильным даже если правило поменяют.
 */
export const MSK_TZ = "Europe/Moscow";

type MskParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const fmt = new Intl.DateTimeFormat("ru-RU", {
  timeZone: MSK_TZ,
  hourCycle: "h23", // иначе минута суток рисуется как "24:00"
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const p2 = (n: number) => String(n).padStart(2, "0");

/** Кривое значение не должно ронять рендер — подставляем текущий момент. */
export function toDate(v: Date | string | number): Date {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

// Часы тикают раз в секунду, а формат вызывается десятки раз за рендер —
// кэшируем разбор последней даты, чтобы не дёргать Intl на каждый вызов.
let lastKey = "";
let lastParts: MskParts = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 };

export function mskParts(v: Date | string | number = new Date()): MskParts {
  const d = toDate(v);
  const key = String(d.getTime());
  if (key === lastKey) return lastParts;
  const out: MskParts = { ...lastParts };
  for (const p of fmt.formatToParts(d)) {
    if (p.type === "year" || p.type === "month" || p.type === "day" || p.type === "hour" || p.type === "minute" || p.type === "second") {
      out[p.type] = Number(p.value);
    }
  }
  lastKey = key;
  lastParts = out;
  return out;
}

/** "14:23" */
export const mskTime = (v: Date | string | number = new Date()): string => {
  const p = mskParts(v);
  return `${p2(p.hour)}:${p2(p.minute)}`;
};

/** "14:23:07" */
export const mskTimeSec = (v: Date | string | number = new Date()): string => {
  const p = mskParts(v);
  return `${p2(p.hour)}:${p2(p.minute)}:${p2(p.second)}`;
};

/** "11.10.2026" */
export const mskDate = (v: Date | string | number = new Date()): string => {
  const p = mskParts(v);
  return `${p2(p.day)}.${p2(p.month)}.${p.year}`;
};

/** "11.10.2026, 14:23" */
export const mskDateTime = (v: Date | string | number = new Date()): string => `${mskDate(v)}, ${mskTime(v)}`;

/** "11.10, 14:23" — компактно для карточек и плашек */
export const mskDayTime = (v: Date | string | number = new Date()): string => {
  const p = mskParts(v);
  return `${p2(p.day)}.${p2(p.month)}, ${p2(p.hour)}:${p2(p.minute)}`;
};

/** Минуты от полуночи МСК — для позиции метки «сейчас» на графике. */
export const mskMinutes = (v: Date | string | number = new Date()): number => {
  const p = mskParts(v);
  return p.hour * 60 + p.minute + p.second / 60;
};

/** "2026-10-11T14-23-07" — для имён файлов (двоеточия в имени нельзя). */
export const mskStamp = (v: Date | string | number = new Date()): string => {
  const p = mskParts(v);
  return `${p.year}-${p2(p.month)}-${p2(p.day)}T${p2(p.hour)}-${p2(p.minute)}-${p2(p.second)}`;
};
