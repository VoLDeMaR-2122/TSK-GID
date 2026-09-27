import { GidState } from "./types";

export const INITIAL_STATE: GidState = {
  stations: [
    { id: "s1", name: "Ростов-Глав", km: 0, paths: 6, code: "510204" },
    { id: "s2", name: "Кущевка", km: 90, paths: 3, code: "514402" },
    { id: "s3", name: "Крыловская", km: 120, paths: 4, code: "514703" },
    { id: "s4", name: "Тихоерцкая", km: 155, paths: 6, code: "520102" },
    { id: "s5", name: "Кавказская", km: 241, paths: 6, code: "520009" },
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
