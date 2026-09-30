export async function applyStationImport(stationSave: StationSave) {
  // 1) заменяем справочник станций графика
  await <твоё>: setStations(stationSave.stations);
  // 2) СБРАСЫВАЕМ нитки — маршрут старых ниток больше не валиден
  await <твоё>: clearTrains();
  // 3) синхронизация на сервер (WS + Postgres) — как у тебя сейчас уходит изменение графика
  await <твоё>: syncToServer();
}

export async function applyTrainsImport(trainsSave: TrainsSave) {
  await <твоё>: setTrains(trainsSave.trains);
  await <твоё>: syncToServer();
}
