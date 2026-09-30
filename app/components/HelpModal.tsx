"use client";
import DraggableModal from "./DraggableModal";

export default function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <DraggableModal title="Справка по системе" width={560} onClose={onClose}
      footer={<button className="gid-btn gid-btn-primary" onClick={onClose}>Понятно</button>}>
      <div className="space-y-5 text-[11px] leading-relaxed text-[#999]">
        {/* Навигация */}
        <div>
          <div className="text-white font-bold mb-2 uppercase text-[10px] tracking-wider flex items-center gap-2">
            <i className="fas fa-compass" /> Навигация по графику
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            <span className="text-[#777]">Колесо мыши</span><span className="text-[#ccc]">прокрутка по времени</span>
            <span className="text-[#777]">Ctrl + колесо</span><span className="text-[#ccc]">масштаб 2–24 ч</span>
            <span className="text-[#777]">Двойной клик</span><span className="text-[#ccc]">новая нитка в точке</span>
            <span className="text-[#777]">Клик по нитке</span><span className="text-[#ccc]">выбор и информация</span>
            <span className="text-[#777]">Перетаскивание окон</span><span className="text-[#ccc]">за заголовок</span>
          </div>
        </div>

        {/* Клавиши */}
        <div>
          <div className="text-white font-bold mb-2 uppercase text-[10px] tracking-wider flex items-center gap-2">
            <i className="fas fa-keyboard" /> Горячие клавиши
          </div>
          <div className="flex flex-wrap gap-2">
            {[["F1", "справка"], ["F2", "нитка"], ["F3", "станции"], ["F4", "дежурство"], ["F5", "пометка"], ["F6", "панель"], ["F7", "статистика"], ["Del", "удалить"], ["Esc", "закрыть"]].map(([k, d]) => (
              <span key={k} className="inline-flex items-center gap-1.5 bg-[#141414] border border-[#2a2a2a] px-2 py-1">
                <b className="text-[#0f0] font-mono text-[10px]">{k}</b>
                <span className="text-[#777] text-[10px]">{d}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Цвета ниток */}
        <div>
          <div className="text-white font-bold mb-2 uppercase text-[10px] tracking-wider flex items-center gap-2">
            <i className="fas fa-palette" /> Цвета ниток
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {[["#f00", "пассажирский"], ["#0a0", "грузовой"], ["#0f0", "пригородный"], ["#f80", "хозяйственный"], ["#f0f", "локомотив"], ["#f0c", "прочий"]].map(([c, n]) => (
              <span key={n} className="inline-flex items-center gap-2">
                <i className="w-5 h-1 inline-block" style={{ background: c }} />
                <span className="text-[#999]">{n}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Пометки */}
        <div>
          <div className="text-white font-bold mb-2 uppercase text-[10px] tracking-wider flex items-center gap-2">
            <i className="fas fa-shapes" /> Пометки на графике
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <span className="inline-flex items-center gap-2">
              <i className="w-3 h-3 inline-block border border-white" />
              <span className="text-[#999]">плановое окно</span>
            </span>
            <span className="inline-flex items-center gap-2">
              <i className="w-3 h-3 inline-block border border-yellow-400 bg-yellow-400/20" />
              <span className="text-[#999]">фактическое</span>
            </span>
            <span className="inline-flex items-center gap-2">
              <i className="w-3 h-3 inline-block border border-red-500 bg-red-500/20" />
              <span className="text-[#999]">передержка</span>
            </span>
          </div>
        </div>

        {/* Роли */}
        <div>
          <div className="text-white font-bold mb-2 uppercase text-[10px] tracking-wider flex items-center gap-2">
            <i className="fas fa-users" /> Роли и права
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="gid-chip gid-chip-op w-16 justify-center">АДМИН</span>
              <span className="text-[#777]">полный доступ, управление пользователями</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="gid-chip gid-chip-dnc w-16 justify-center">ДНЦ</span>
              <span className="text-[#777]">управление поездами, дежурство ДНЦ</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="gid-chip gid-chip-dsp w-16 justify-center">ДСП</span>
              <span className="text-[#777]">отметки времени, дежурство ДСП</span>
            </div>
          </div>
        </div>

        {/* Синхронизация */}
        <div className="text-[#555] border-t border-[#222] pt-3 text-[10px] flex items-center gap-2">
          <i className="fas fa-rotate" />
          <span>Синхронизация: изменения мгновенно отображаются во всех открытых вкладках браузера.</span>
        </div>
      </div>
    </DraggableModal>
  );
}
