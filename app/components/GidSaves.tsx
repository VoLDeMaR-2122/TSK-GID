'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSaveStorage, type SaveMeta } from '@/lib/gid/saveStorage';
import { mskStamp, mskDateTime } from '@/lib/datetime';
import type { GidState, Station, Train } from '@/lib/types';

// ---------- УСТОЙЧИВЫЕ ACCESSOR'Ы (твой стиль: читаем и рус, и англ ключи) ----------
// Нужны ТОЛЬКО для валидации соответствия ниток и для импорта чужого файла.
// Экспорт/импорт нашего архива поля НЕ переименовывает (round-trip как есть).
type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord => (
  typeof value === 'object' && value !== null ? value as UnknownRecord : {}
);

const gStr = (o: unknown, ...keys: string[]) => {
  const record = asRecord(o);
  for (const k of keys) {
    const v = record[k];
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return '';
};
const stationKey = (s: unknown) => gStr(s, 'code', 'Код', 'id', 'Id');
const threadRef  = (p: unknown) => gStr(p, 'station', 'Станция', 'stationId', 'stationCode');
const threadPoints = (t: unknown): unknown[] => {
  const record = asRecord(t);
  const points = record.points;
  if (Array.isArray(points)) return points;
  const stops = record.stops;
  return Array.isArray(stops) ? stops : [];
};
const errorMessage = (error: unknown) => (
  typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)
);

// ---------- НОРМАЛИЗАЦИЯ ЧУЖОГО ФАЙЛА ----------
// Чужой/ручной файл может иметь русские ключи => прогоняем через устойчивые accessor'ы,
// нормализуя в канон Station / Train (stops[].stationId = id станции), дальше та же валидация/каскад.
const normStations = (raw: unknown[]): Station[] => raw.map((r, i) => ({
  id: gStr(r, 'id', 'Id') || String(i),
  name: gStr(r, 'name', 'Станция', 'Название'),
  code: gStr(r, 'code', 'Код'),
  km: Number(asRecord(r).km) || 0,
  paths: Number(asRecord(r).paths) || 1,
}));

// Ссылка на станцию в файле может быть и id, и кодом — приводим к id текущего графика.
// Неизвестные ссылки оставляем как есть, их отловит validateTrains.
const normTrains = (raw: unknown[], stations: Station[]): Train[] => {
  const idByRef = new Map<string, string>();
  for (const s of stations) {
    idByRef.set(s.id, s.id);
    if (s.code) idByRef.set(s.code, s.id);
  }
  return raw.map((r) => {
    const stops = threadPoints(r).map((p) => {
      const ref = threadRef(p);
      return { ...asRecord(p), stationId: idByRef.get(ref) ?? ref };
    });
    return { ...asRecord(r), stops } as unknown as Train;
  });
};

// ---------- ТИПЫ PROPS ----------
type Props = { state: GidState; setState: React.Dispatch<React.SetStateAction<GidState>> };

const DIR_OF = { stations: 'station', trains: 'trains' } as const;
const fileStamp = (prefix: string) => `${prefix}_${mskStamp()}.json`;

export function GidSaves({ state, setState }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [savesStation, setSavesStation] = useState<SaveMeta[]>([]);
  const [savesTrains, setSavesTrains] = useState<SaveMeta[]>([]);

  // ---------- ПРИМЕНЕНИЕ К LIVE-СОСТОЯНИЮ (каскад + WS-синхронизация сами) ----------
  // Импорт станций => нитки СБРАСЫВАЮТСЯ (ТЗ). marks не трогаем (см. вопрос в конце).
  const applyStations = useCallback((stations: Station[]) => {
    setState((prev) => ({ ...prev, stations, trains: [] }));
  }, [setState]);

  // Импорт ниток => станции/ marks не трогаем.
  const applyTrains = useCallback((trains: Train[]) => {
    setState((prev) => ({ ...prev, trains }));
  }, [setState]);

  // ---------- ВАЛИДАЦИЯ: нитки ссылаются только на АКТИВНЫЕ станции ----------
  // Возвращает строку-ошибку или null. Атомарно: либо все ссылки валидны, либо отказ.
  const validateTrains = useCallback((trains: unknown[], activeStations: unknown[]): string | null => {
    const allowed = new Set<string>();
    // Остановки ссылаются на id станции, чужие файлы — иногда на код: принимаем оба.
    for (const s of activeStations) {
      for (const k of [gStr(s, 'id', 'Id'), gStr(s, 'code', 'Код')]) if (k) allowed.add(k);
    }
    const missing = new Set<string>();
    for (const t of trains) {
      for (const p of threadPoints(t)) {
        const ref = threadRef(p);
        if (ref && !allowed.has(ref)) missing.add(ref);
      }
    }
    if (missing.size > 0) {
      return `В сейве ниток есть станции, которых нет в текущем графике: ${[...missing].join(', ')}. Импорт отменён.`;
    }
    return null;
  }, []);

  // ---------- ЗАГРУЗКА СПИСКА АРХИВА ----------
  const refreshSaves = useCallback(async () => {
    const storage = getSaveStorage();
    try { setSavesStation(await storage.list('station')); } catch { setSavesStation([]); }
    try { setSavesTrains(await storage.list('trains')); } catch { setSavesTrains([]); }
  }, []);

  // Первичная загрузка: setState только в колбэке промиса, с защитой от размонтирования.
  useEffect(() => {
    let cancelled = false;
    const storage = getSaveStorage();
    Promise.all([
      storage.list('station').catch(() => []),
      storage.list('trains').catch(() => []),
    ]).then(([station, trains]) => {
      if (cancelled) return;
      setSavesStation(station);
      setSavesTrains(trains);
    });
    return () => { cancelled = true; };
  }, []);

  // ---------- ЭКСПОРТ ----------
  const exportKind = useCallback(async (kind: 'stations' | 'trains') => {
    setError(null);
    const data = kind === 'stations' ? state.stations : state.trains;
    const storage = getSaveStorage();
    try {
      await storage.write(DIR_OF[kind], fileStamp(DIR_OF[kind]), data);
      await refreshSaves();
    } catch (e: unknown) { setError(errorMessage(e)); }
  }, [state.stations, state.trains, refreshSaves]);

  // ---------- ИМПОРТ ИЗ АРХИВА ----------
  const importFromSaves = useCallback(async (kind: 'stations' | 'trains', name: string) => {
    setError(null);
    const storage = getSaveStorage();
    try {
      const arr = await storage.read(DIR_OF[kind], name);
      if (!Array.isArray(arr)) throw new Error('Файл сейва не является списком.');
      if (kind === 'stations') {
        applyStations(arr);
      } else {
        const err = validateTrains(arr, state.stations);
        if (err) { setError(err); return; }
        applyTrains(arr);
      }
    } catch (e: unknown) { setError(errorMessage(e)); }
  }, [state.stations, applyStations, applyTrains, validateTrains]);

  // ---------- ИМПОРТ ПРОИЗВОЛЬНЫМ ФАЙЛОМ ----------
  const pickFile = useCallback(async (kind: 'stations' | 'trains', file: File) => {
    setError(null);
    try {
      const raw = JSON.parse(await file.text());
      if (!Array.isArray(raw)) throw new Error('Ожидался JSON-массив.');
      if (kind === 'stations') {
        applyStations(normStations(raw));
      } else {
        const trains = normTrains(raw, state.stations);
        const err = validateTrains(trains, state.stations);
        if (err) { setError(err); return; }
        applyTrains(trains);
      }
    } catch (e: unknown) { setError(errorMessage(e)); }
  }, [state.stations, applyStations, applyTrains, validateTrains]);

  // ---------- УДАЛЕНИЕ СЕЙВА ----------
  const removeSave = useCallback(async (kind: 'stations' | 'trains', name: string) => {
    setError(null);
    const storage = getSaveStorage();
    try { await storage.remove(DIR_OF[kind], name); await refreshSaves(); }
    catch (e: unknown) { setError(errorMessage(e)); }
  }, [refreshSaves]);

  // ---------- РЕНДЕР ----------
  const fmt = (iso: string) => { try { return mskDateTime(iso); } catch { return iso; } };
  const btn: React.CSSProperties = { fontSize: 13 };
  const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' };

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* колонка 1: экспорт/импорт + ошибка */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 240 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={btn} onClick={() => exportKind('stations')}>Экспорт станций</button>
          <button type="button" style={btn} onClick={() => exportKind('trains')}>Экспорт ниток</button>
        </div>
        <label style={{ fontSize: 13 }}>
          Импорт станций (файл)
          <input type="file" accept=".json" onChange={(e) => e.target.files?.[0] && pickFile('stations', e.target.files[0])} />
        </label>
        <label style={{ fontSize: 13 }}>
          Импорт ниток (файл)
          <input type="file" accept=".json" onChange={(e) => e.target.files?.[0] && pickFile('trains', e.target.files[0])} />
        </label>
        {error && <p style={{ color: '#ff6b6b', margin: 0 }}>{error}</p>}
      </div>

      {/* колонка 2: архив saves */}
      <div style={{ minWidth: 220 }}>
        <h3 style={{ margin: '0 0 4px' }}>Сейвы станций (saves/station)</h3>
        {savesStation.length === 0
          ? <p style={{ color: '#8a8aa0', fontSize: 13, margin: 0 }}>пусто</p>
          : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {savesStation.map(s => (
                <li key={s.name}>
                  <button type="button" style={linkBtn} onClick={() => importFromSaves('stations', s.name)}>{s.name}</button>
                  <small style={{ color: '#8a8aa0' }}> · {fmt(s.savedAt)} </small>
                  <button type="button" style={{ ...linkBtn, color: '#ff6b6b' }} onClick={() => removeSave('stations', s.name)}><i className="fas fa-xmark" /></button>
                </li>
              ))}
            </ul>}
        <h3 style={{ margin: '12px 0 4px' }}>Сейвы ниток (saves/trains)</h3>
        {savesTrains.length === 0
          ? <p style={{ color: '#8a8aa0', fontSize: 13, margin: 0 }}>пусто</p>
          : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {savesTrains.map(s => (
                <li key={s.name}>
                  <button type="button" style={linkBtn} onClick={() => importFromSaves('trains', s.name)}>{s.name}</button>
                  <small style={{ color: '#8a8aa0' }}> · {fmt(s.savedAt)} </small>
                  <button type="button" style={{ ...linkBtn, color: '#ff6b6b' }} onClick={() => removeSave('trains', s.name)}><i className="fas fa-xmark" /></button>
                </li>
              ))}
            </ul>}
      </div>

      {/* колонка 3: что сейчас активно (live-состояние) */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ margin: '0 0 4px' }}>Станции ({state.stations.length})</h3>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {state.stations.map((s, i) => <li key={stationKey(s) || i}>{gStr(s, 'name', 'Станция', 'Название') || '—'} <small style={{ color: '#8a8aa0' }}>{stationKey(s)}</small></li>)}
        </ul>
        <h3 style={{ margin: '12px 0 4px' }}>Нитки ({state.trains.length})</h3>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {state.trains.map((t, i) => <li key={gStr(t, 'number', 'Номер') || i}>{gStr(t, 'number', 'Номер') || '—'} · {gStr(t, 'category', 'kind', 'Тип') || '—'} · {threadPoints(t).length} уч.</li>)}
        </ul>
      </div>
    </div>
  );
}
