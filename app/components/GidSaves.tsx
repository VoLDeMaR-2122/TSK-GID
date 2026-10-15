'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSaveStorage, type SaveMeta } from '@/lib/gid/saveStorage';
import { mskStamp, mskDateTime } from '@/lib/datetime';

// ---------- УСТОЙЧИВЫЕ ACCESSOR'Ы (твой стиль: читаем и рус, и англ ключи) ----------
// Нужны ТОЛЬКО для валидации соответствия ниток и для импорта чужого файла.
// Экспорт/импорт нашего архива поля НЕ переименовывает (round-trip как есть).
const gStr = (o: any, ...keys: string[]) => {
  for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && v !== '') return String(v); }
  return '';
};
const stationKey = (s: any) => gStr(s, 'code', 'Код', 'id', 'Id');
const threadRef  = (p: any) => gStr(p, 'station', 'Станция', 'stationId', 'stationCode');
const threadPoints = (t: any): any[] => Array.isArray(t?.points) ? t.points : [];

// ---------- ТИПЫ PROPS (структурно, без зависимости от types.ts) ----------
type AnyState = { stations: any[]; trains: any[]; marks?: any[]; [k: string]: any };
type Props = { state: AnyState; setState: (arg: any) => void };

const DIR_OF = { stations: 'station', trains: 'trains' } as const;
const fileStamp = (prefix: string) => `${prefix}_${mskStamp()}.json`;

export function GidSaves({ state, setState }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [savesStation, setSavesStation] = useState<SaveMeta[]>([]);
  const [savesTrains, setSavesTrains] = useState<SaveMeta[]>([]);

  // ---------- ПРИМЕНЕНИЕ К LIVE-СОСТОЯНИЮ (каскад + WS-синхронизация сами) ----------
  // Импорт станций => нитки СБРАСЫВАЮТСЯ (ТЗ). marks не трогаем (см. вопрос в конце).
  const applyStations = useCallback((stations: any[]) => {
    setState((prev: AnyState) => ({ ...prev, stations, trains: [] }));
  }, [setState]);

  // Импорт ниток => станции/ marks не трогаем.
  const applyTrains = useCallback((trains: any[]) => {
    setState((prev: AnyState) => ({ ...prev, trains }));
  }, [setState]);

  // ---------- ВАЛИДАЦИЯ: нитки ссылаются только на АКТИВНЫЕ станции ----------
  // Возвращает строку-ошибку или null. Атомарно: либо все ссылки валидны, либо отказ.
  const validateTrains = useCallback((trains: any[], activeStations: any[]): string | null => {
    const allowed = new Set<string>();
    for (const s of activeStations) { const k = stationKey(s); if (k) allowed.add(k); }
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

  useEffect(() => {
    refreshSaves();
  }, [refreshSaves]);

  // ---------- ЭКСПОРТ ----------
  const exportKind = useCallback(async (kind: 'stations' | 'trains') => {
    setError(null);
    const data = kind === 'stations' ? state.stations : state.trains;
    const storage = getSaveStorage();
    try {
      await storage.write(DIR_OF[kind], fileStamp(DIR_OF[kind]), data);
      await refreshSaves();
    } catch (e: any) { setError(typeof e === 'string' ? e : (e?.message ?? String(e))); }
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
    } catch (e: any) { setError(typeof e === 'string' ? e : (e?.message ?? String(e))); }
  }, [state.stations, applyStations, applyTrains, validateTrains]);

  // ---------- ИМПОРТ ПРОИЗВОЛЬНЫМ ФАЙЛОМ ----------
  // Чужой/ручной файл может иметь русские ключи => прогоняем через устойчивые accessor'ы,
  // нормализуя в канон {code,...} / {...,points:[{station}]}, дальше та же валидация/каскад.
  const normStations = (raw: any[]) => raw.map((r, i) => ({
    id: gStr(r, 'id', 'Id') || String(i),
    name: gStr(r, 'name', 'Станция', 'Название'),
    code: gStr(r, 'code', 'Код'),
  }));
  const normTrains = (raw: any[]) => raw.map((r) => ({
    ...r,
    points: threadPoints(r).map((p) => ({ ...p, station: threadRef(p) })),
  }));

  const pickFile = useCallback(async (kind: 'stations' | 'trains', file: File) => {
    setError(null);
    try {
      const raw = JSON.parse(await file.text());
      if (!Array.isArray(raw)) throw new Error('Ожидался JSON-массив.');
      if (kind === 'stations') {
        applyStations(normStations(raw));
      } else {
        const trains = normTrains(raw);
        const err = validateTrains(trains, state.stations);
        if (err) { setError(err); return; }
        applyTrains(trains);
      }
    } catch (e: any) { setError(typeof e === 'string' ? e : (e?.message ?? String(e))); }
  }, [state.stations, applyStations, applyTrains, validateTrains]);

  // ---------- УДАЛЕНИЕ СЕЙВА ----------
  const removeSave = useCallback(async (kind: 'stations' | 'trains', name: string) => {
    setError(null);
    const storage = getSaveStorage();
    try { await storage.remove(DIR_OF[kind], name); await refreshSaves(); }
    catch (e: any) { setError(typeof e === 'string' ? e : (e?.message ?? String(e))); }
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
          {state.trains.map((t, i) => <li key={gStr(t, 'number', 'Номер') || i}>{gStr(t, 'number', 'Номер') || '—'} · {gStr(t, 'kind', 'Тип') || '—'} · {threadPoints(t).length} уч.</li>)}
        </ul>
      </div>
    </div>
  );
}
