"use client";
import { GidState, CAT_NAMES, CAT_COLORS } from "@/lib/types";
import { Role, can } from "@/lib/permissions";

interface Props {
  state: GidState;
  role: Role;
  onEditTrain: (id: string) => void;
  onEditMark: (id: string) => void;
  onDeleteTrain: (id: string) => void;
  onDeleteMark: (id: string) => void;
  onSetStopField: (trainId: string, stopIndex: number, field: "arr" | "dep" | "path", value: string | number) => void;
  onMarkNow: (trainId: string, stopIndex: number, field: "arr" | "dep") => void;
}
const MT: Record<string, string> = { window: "Окно", line: "Линия", text: "Текст", delay: "Задержка", failure: "Сбойный" };

export default function RightPanel({ state, role, onEditTrain, onEditMark, onDeleteTrain, onDeleteMark, onSetStopField, onMarkNow }: Props) {
  const sel = state.selected;
  const tr = sel?.type === "train" ? state.trains.find((t) => t.id === sel.id) : null;
  const mk = sel?.type === "mark" ? state.marks.find((m) => m.id === sel.id) : null;
  const canMark = can(role, "trains.mark");
  const canManage = can(role, "trains.manage");

  return (
    <div className="w-[260px] bg-[#0a0a0a] border-l border-[#222] shrink-0 flex flex-col overflow-hidden">
      <div className="gid-rp-head flex items-center justify-between">
        <span>{tr ? "Поезд" : mk ? "Пометка" : "Информация"}</span>
        {tr && <span className="w-2 h-2 rounded-full" style={{ background: CAT_COLORS[tr.category], boxShadow: `0 0 6px ${CAT_COLORS[tr.category]}` }} />}
      </div>
      <div className="flex-1 overflow-y-auto p-2.5 text-xs">
        {tr ? (
          <>
            <div className="gid-rp-section">
              <div className="gid-rp-title mb-1.5" style={{ color: CAT_COLORS[tr.category] }}>№ {tr.number}</div>
              <div className="gid-rp-row"><span className="k">Категория</span><span className="v">{CAT_NAMES[tr.category] || tr.category}</span></div>
              <div className="gid-rp-row"><span className="k">Локомотив</span><span className="v">{tr.locoSeries || "—"} {tr.locoNum ? "№" + tr.locoNum : ""}</span></div>
              <div className="gid-rp-row"><span className="k">Машинист</span><span className="v">{tr.driver || "—"}</span></div>
              <div className="gid-rp-row"><span className="k">Вес / длина</span><span className="v">{tr.weight || "—"} т · {tr.length || "—"} ваг.</span></div>
              {tr.naturka && <div className="gid-rp-row"><span className="k">Натурный лист</span><span className="v font-mono">{tr.naturka}</span></div>}
              {tr.note && <div className="text-[#888] mt-1.5 text-[10px] border-l-2 border-[#333] pl-2">{tr.note}</div>}
            </div>

            <div className="gid-rp-section">
              <div className="gid-label !mb-1.5">
                Фактическое движение · {tr.stops.length} станций
                {canMark && <span className="text-[#0f0] ml-1">· ДСП вводит</span>}
              </div>
              <div className="gid-sched">
                {tr.stops.map((s, i) => {
                  const st = state.stations.find((x) => x.id === s.stationId);
                  const maxPaths = st?.paths || 8;
                  return (
                    <div key={i} className="gid-sched-item">
                      <div className="st flex items-center justify-between">
                        <span>{st?.name || "?"}</span>
                        {canMark ? (
                          <select
                            className="gid-select !w-[64px] !py-0 !text-[10px] text-right"
                            value={s.path}
                            onChange={(e) => onSetStopField(tr.id, i, "path", Number(e.target.value))}
                            title="Путь приёма/отправления"
                          >
                            {Array.from({ length: maxPaths }, (_, k) => k + 1).map((p) => (
                              <option key={p} value={p}>путь {p}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-[#555] font-normal text-[9px]">путь {s.path}</span>
                        )}
                      </div>

                      {/* Прибытие */}
                      <div className="tm flex items-center gap-1 mt-0.5">
                        <span className="text-[#0f0] w-3 text-center"><i className="fas fa-arrow-down" /></span>
                        {canMark ? (
                          <>
                            <input
                              className="gid-input !w-[58px] !py-0 !text-[10px] text-center"
                              value={s.arr || ""} placeholder="--:--"
                              onChange={(e) => onSetStopField(tr.id, i, "arr", e.target.value)}
                            />
                            <button className="gid-btn !px-1 !py-0 !text-[8px] !border-[#0a4a24] hover:!text-[#0f0]" onClick={() => onMarkNow(tr.id, i, "arr")} title="Поставить текущее время">сейчас</button>
                          </>
                        ) : (
                          <span className={s.arr ? "text-[#0f0]" : "text-[#444]"}>{s.arr || "--:--"}</span>
                        )}
                      </div>

                      {/* Отправление */}
                      <div className="tm flex items-center gap-1">
                        <span className="text-[#0af] w-3 text-center"><i className="fas fa-arrow-up" /></span>
                        {canMark ? (
                          <>
                            <input
                              className="gid-input !w-[58px] !py-0 !text-[10px] text-center"
                              value={s.dep || ""} placeholder="--:--"
                              onChange={(e) => onSetStopField(tr.id, i, "dep", e.target.value)}
                            />
                            <button className="gid-btn !px-1 !py-0 !text-[8px] !border-[#0a3a6a] hover:!text-[#0af]" onClick={() => onMarkNow(tr.id, i, "dep")} title="Поставить текущее время">сейчас</button>
                          </>
                        ) : (
                          <span className={s.dep ? "text-[#0af]" : "text-[#444]"}>{s.dep || "--:--"}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {canManage && (
              <div className="flex gap-2">
                <button className="gid-btn gid-btn-info flex-1" onClick={() => onEditTrain(tr.id)}><i className="fas fa-pen" /> Редактировать нитку</button>
                <button className="gid-btn gid-btn-danger" onClick={() => onDeleteTrain(tr.id)}><i className="fas fa-trash-can" /></button>
              </div>
            )}
            {!canManage && canMark && (
              <div className="text-[9px] text-[#0a7a2a] border border-[#0a4a24] bg-[#06120a] rounded px-2 py-1.5 text-center">
                <i className="fas fa-check" /> Вы ДСП — вводите фактическое время и путь
              </div>
            )}
          </>
        ) : mk ? (
          <>
            <div className="gid-rp-section">
              <div className="gid-rp-title mb-1.5 text-[#ff0]">{MT[mk.type] || mk.type}</div>
              {mk.type === "window" || mk.type === "line" ? (
                <div className="gid-rp-row"><span className="k">Перегон</span><span className="v">{state.stations[mk.peregon]?.name} — {state.stations[mk.peregon + 1]?.name}</span></div>
              ) : (
                <div className="gid-rp-row"><span className="k">Станция</span><span className="v">{state.stations[mk.peregon]?.name}</span></div>
              )}
              <div className="gid-rp-row"><span className="k">Время</span><span className="v font-mono">{mk.start} — {mk.end}</span></div>
              <div className="gid-rp-row"><span className="k">Цвет</span><span className="v">{mk.color}</span></div>
              {mk.service && <div className="gid-rp-row"><span className="k">Служба</span><span className="v">{mk.service}</span></div>}
              {mk.text && <div className="text-[#aaa] mt-1.5 text-[10px] border-l-2 border-[#444] pl-2">{mk.text}</div>}
            </div>
            {can(role, "marks.manage") && (
              <div className="flex gap-2">
                <button className="gid-btn gid-btn-info flex-1" onClick={() => onEditMark(mk.id)}><i className="fas fa-pen" /> Редактировать</button>
                <button className="gid-btn gid-btn-danger" onClick={() => onDeleteMark(mk.id)}><i className="fas fa-trash-can" /></button>
              </div>
            )}
          </>
        ) : (
          <div className="text-[#4a4a4a] text-center mt-6 leading-relaxed text-[11px]">
            <div className="text-2xl mb-2 opacity-40"><i className="fas fa-asterisk" /></div>
            Выберите нитку поезда<br />на графике
            <div className="mt-4 text-[10px] text-[#3a3a3a] border-t border-[#1c1c1c] pt-3 space-y-0.5">
              {can(role, "trains.manage") && <div>F2 — новая нитка · F3 — станции</div>}
              {can(role, "marks.manage") && <div>F5 — пометка / окно</div>}
              {canMark && <div className="text-[#0a7a2a]">Клик по нитке → ввод прибытия,<br />отправления и пути</div>}
              <div>F7 — статистика</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
