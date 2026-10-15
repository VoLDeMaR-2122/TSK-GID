import { mskStamp } from "@/lib/datetime";

export function makeSaveName(prefix: string) {
  // напр. trains_2026-10-11T14-23-07.json — по московскому времени
  return `${prefix}_${mskStamp()}.json`;
}
