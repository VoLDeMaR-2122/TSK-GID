export function makeSaveName(prefix: string) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${prefix}_${ts}.json`; // напр. trains_2026-09-28T12-00-00.json
}
