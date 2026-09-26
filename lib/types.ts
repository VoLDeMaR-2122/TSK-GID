export interface Station {
  id: string;
  name: string;
  km: number;
  paths: number;
  code: string;
}

export interface TrainStop {
  stationId: string;
  arr: string | null;
  dep: string | null;
  path: number;
}

export interface Train {
  id: string;
  number: string;
  category: string;
  locoSeries?: string;
  locoNum?: string;
  driver?: string;
  weight?: string;
  length?: string;
  cargo?: string;
  naturka?: string;
  index?: string;
  note?: string;
  stops: TrainStop[];
}

export interface Mark {
  id: string;
  type: string;
  peregon: number;
  start: string;
  end: string;
  color: string;
  text?: string;
  service?: string;
}

export interface View {
  startHour: number;
  hoursVisible: number;
}

export interface GidState {
  stations: Station[];
  trains: Train[];
  marks: Mark[];
  view: View;
  selected: { type: string; id: string } | null;
  showNumbers: boolean;
  showTimeMarks: boolean;
}

export const CAT_COLORS: Record<string, string> = {
  passenger: "#f00", freight: "#0a0", suburban: "#0f0",
  service: "#f80", loco: "#f0f", other: "#f0c"
};

export const CAT_NAMES: Record<string, string> = {
  passenger: "Пассажирский", freight: "Грузовой", suburban: "Пригородный",
  service: "Хозяйственный", loco: "Локомотив", other: "Прочий"
};
