import { GidState } from "./types";

export const INITIAL_STATE: GidState = {
  stations: [
    { id: "s1", name: "Горький-Моск", km: 0, paths: 6, code: "26000" },
    { id: "s2", name: "Кр. Узел", km: 90, paths: 3, code: "26010" },
    { id: "s3", name: "Дзержинск", km: 120, paths: 4, code: "26020" },
    { id: "s4", name: "Игумново", km: 155, paths: 6, code: "26030" },
    { id: "s5", name: "Сейма", km: 241, paths: 6, code: "26040" },
  ],
  trains: [
  // -
  ],
  marks: [],
  view: { startHour: 0, hoursVisible: 8 },
  selected: null,
  showNumbers: true,
  showTimeMarks: true,
};
