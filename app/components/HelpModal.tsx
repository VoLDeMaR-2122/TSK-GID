"use client";
import DraggableModal from "./DraggableModal";

export default function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <DraggableModal title="Справка по системе" width={540} onClose={onClose}
      footer={<button className="gid-btn gid-btn-primary" onClick={onClose}>Понятно</button>}>
      <div className="space-y-4 text-[11px] leading-relaxed text-[#999]">
        <div>
          <div className="text-white font-bold mb-1 uppercase text-[10px] tracking-wider">Навигация по графику</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <span>Колесо мыши</span><span className="text-[#ccc]">прокрутка по времени</span>
            <span>Ctrl + колесо</span><span className="text-[#ccc]">масштаб 2–24 ч</span>
            <span>Двойной клик</span><span className="text-[#ccc]">новая нитка в точке</span>
            <span>Клик по нитке</span><span className="text-[#ccc]">выбор и информация</span>
            <span>Перетаскивание окон</span><span className="text-[#ccc]">за заголовок</span>
          </div>
        </div>
        <div>
          <div className="text-white font-bold mb-1 uppercase text-[10px] tracking-wider">Клавиши</div>
          <div className="flex flex-wrap gap-1.5">
            {[["F1", "справка"], ["F2", "нитка"], ["F3", "станции"], ["F4", "дежурство"], ["F5", "пометка"], ["Del", "удалить"], ["Esc", "закрыть окно"]].map(([k, d]) => (
              <span key={k} className="inline-flex items-center gap-1 bg-[#181818] border border-[#333] rounded px-1.5 py-0.5">
                <b className="text-[#0f0]">{k}</b><span className="text-[#777]">{d}</span>
              </span>
            ))}
          </div>
        </div>
        <div>
          <div className="text-white font-bold mb-1 uppercase text-[10px] tracking-wider">Цвета ниток</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {[["#f00", "пассажирский"], ["#0a0", "грузовой"], ["#0f0", "пригородный"], ["#f80", "хозяйственный"], ["#f0f", "локомотив"], ["#f0c", "прочий"]].map(([c, n]) => (
              <span key={n} className="inline-flex items-center gap-1.5"><i className="w-4 h-0.5 inline-block" style={{ background: c }} />{n}</span>
            ))}
          </div>
        </div>
        <div>
          <div className="text-white font-bold mb-1 uppercase text-[10px] tracking-wider">Пометки</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span><i className="w-3 h-3 inline-block border border-white mr-1 align-middle" />плановое окно</span>
            <span><i className="w-3 h-3 inline-block border border-yellow-400 bg-yellow-400/20 mr-1 align-middle" />фактическое</span>
            <span><i className="w-3 h-3 inline-block border border-red-500 bg-red-500/20 mr-1 align-middle" />передержка</span>
          </div>
        </div>
        <div className="text-[#555] border-t border-[#222] pt-2 text-[10px]">
          Синхронизация: изменения мгновенно отображаются во всех открытых вкладках браузера.
        </div>
      </div>
    </DraggableModal>
  );
}
