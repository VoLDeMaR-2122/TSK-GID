import { GidState } from "./types";

export const INITIAL_STATE: GidState = {
  stations: [
    { id: "s1", name: "Горький-Моск", km: 0, paths: 8, code: "26000" },
    { id: "s2", name: "Кр. Узел", km: 15, paths: 4, code: "26010" },
    { id: "s3", name: "Дзержинск", km: 24, paths: 6, code: "26020" },
    { id: "s4", name: "Игумново", km: 32, paths: 2, code: "26030" },
    { id: "s5", name: "Сейма", km: 45, paths: 3, code: "26040" },
    { id: "s6", name: "Вязьма", km: 58, paths: 4, code: "26050" },
    { id: "s7", name: "Петушки", km: 72, paths: 3, code: "26060" },
    { id: "s8", name: "Орехово", km: 85, paths: 2, code: "26070" },
    { id: "s9", name: "Москва-Кур", km: 105, paths: 10, code: "27000" },
  ],
  trains: [
    {
      id: "t1", number: "284А", category: "passenger", locoSeries: "ЧС7", locoNum: "210", driver: "Петров П.П.",
      weight: "950", length: "18", cargo: "пассаж", naturka: "1112221", index: "2600-1111-1", note: "",
      stops: [
        { stationId: "s1", arr: "08:00", dep: "08:05", path: 1 },
        { stationId: "s3", arr: "08:25", dep: "08:27", path: 2 },
        { stationId: "s5", arr: "08:45", dep: "08:47", path: 1 },
        { stationId: "s9", arr: "09:40", dep: null, path: 3 },
      ]
    },
    {
      id: "t2", number: "3401", category: "freight", locoSeries: "ВЛ10", locoNum: "1234", driver: "Иванов И.И.",
      weight: "4500", length: "71", cargo: "уголь", naturka: "3334441", index: "2600-2222-3", note: "Тяжеловес",
      stops: [
        { stationId: "s1", arr: null, dep: "09:00", path: 4 },
        { stationId: "s3", arr: "09:30", dep: "09:40", path: 3 },
        { stationId: "s6", arr: "10:15", dep: "10:25", path: 2 },
        { stationId: "s9", arr: "11:00", dep: null, path: 5 },
      ]
    }
  ],
  marks: [],
  view: { startHour: 0, hoursVisible: 8 },
  selected: null,
  showNumbers: true,
  showTimeMarks: true,
};
