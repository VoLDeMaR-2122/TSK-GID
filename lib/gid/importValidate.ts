export type ImportResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; missing?: string[] };

// Проверка: каждая нитка ссылается только на станции, которые ЕСТЬ в текущем справочнике.
export function validateTrainsImport(
  trainsSave: TrainsSave,            // <твоё> тип сейва ниток
  currentStationCodes: Set<string>,  // коды станций из ТЕКУЩЕГО графика
): ImportResult<TrainsSave> {
  const missing = new Set<string>();
  for (const train of trainsSave.trains) {
    for (const stop of train.route) {
      if (!currentStationCodes.has(stop.stationCode)) {
        missing.add(stop.stationCode);
      }
    }
  }
  if (missing.size > 0) {
    return {
      ok: false,
      error: `В сейве ниток есть станции, которых нет в текущем графике: ${[...missing].join(", ")}. Импорт отменён.`,
      missing: [...missing],
    };
  }
  return { ok: true, data: trainsSave };
}

// Проверка схемы станций (минимум: уникальный code).
export function validateStationImport(stationSave: StationSave): ImportResult<StationSave> {
  const seen = new Set<string>();
  for (const s of stationSave.stations) {
    if (!s.code) return { ok: false, error: "Станция без кода в сейве." };
    if (seen.has(s.code)) return { ok: false, error: `Дубликат кода станции: ${s.code}` };
    seen.add(s.code);
  }
  return { ok: true, data: stationSave };
}
