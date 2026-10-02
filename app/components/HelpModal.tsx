"use client";
import type { ReactNode } from "react";
import { CAT_COLORS, CAT_NAMES } from "@/lib/types";
import DraggableModal from "./DraggableModal";

/* --- Раскладка «жест — что делает» --------------------------------------- */
const MOUSE: [string, string][] = [
  ["Колесо мыши", "прокрутка графика по времени суток"],
  ["Ctrl + колесо", "масштаб сетки 2–24 ч, шаг 0,5 ч"],
  ["Двойной клик", "новая нитка с отметкой времени под курсором"],
  ["Клик по нитке", "выбрать нитку и открыть карточку справа"],
  ["Двойной клик по пометке", "редактирование пометки"],
  ["Заголовок окна", "перетаскивание окна"],
  ["Правый нижний угол", "изменение размера окна"],
];

const HOTKEYS: [string, string][] = [
  ["F1", "эта справка"],
  ["F2", "новая нитка"],
  ["F3", "станции участка"],
  ["F4", "дежурство"],
  ["F5", "пометка на графике"],
  ["F6", "панель администратора"],
  ["F7", "статистика"],
  ["Del", "удалить выбранное"],
  ["Esc", "закрыть окно"],
];

/* Права ролей — по матрице lib/permissions.ts */
const ROLES: { short: string; cls: string; name: string; rights: string }[] = [
  {
    short: "АДМИН",
    cls: "gid-chip-op",
    name: "Администратор",
    rights: "все права, включая назначение ролей и управление пользователями",
  },
  {
    short: "ДНЦ",
    cls: "gid-chip-dnc",
    name: "Поездной диспетчер",
    rights: "нитки, станции, пометки, оповещения, дежурство ДСП, панель и статистика",
  },
  {
    short: "ДСП",
    cls: "gid-chip-dsp",
    name: "Дежурный по станции",
    rights: "фактические отметки времени (прибытие, отправление, путь) и просмотр статистики",
  },
];

/* Типы пометок — по MarkModal. Глифы повторяют то, что рисуется на графике (TrainGraph). */
const MARKS: { glyph: ReactNode; name: string; hint: string }[] = [
  {
    glyph: <i className="block h-[9px] w-[18px] border border-[#f55] bg-[#f5500022]" />,
    name: "Окно",
    hint: "закрытие перегона на интервал",
  },
  {
    glyph: <i className="block h-[2px] w-[18px] bg-[#ff0]" />,
    name: "Линия",
    hint: "предупреждение или работы на перегоне",
  },
  {
    /* На графике: вертикальная засечка у времени + подпись рядом — показываем букву «А» */
    glyph: (
      <span className="inline-flex items-center gap-[3px]">
        <i className="block h-[14px] w-[2px] bg-[#0f0]" />
        <i className="grid h-[10px] w-[10px] place-items-center border border-[#0f0] font-mono text-[8px] leading-none text-[#0f0]">
          А
        </i>
      </span>
    ),
    name: "Текст",
    hint: "короткая подпись у станции",
  },
  {
    glyph: <i className="fas fa-xmark text-[13px] text-[#f00]" />,
    name: "Задержка / сбой",
    hint: "отклонение от расписания",
  },
];

/* Цвета из формы пометки (MarkModal): белый — плановое, жёлтый — фактическое, красный — передержка */
const MARK_COLORS: [string, string, string][] = [
  ["#fff", "белый", "плановое"],
  ["#ff0", "жёлтый", "фактическое"],
  ["#f00", "красный", "передержка"],
];

/* --- Строчные блоки ------------------------------------------------------- */
/* В CAT/MarkModal цвета записаны коротким hex (#fff), а не #ffffff — разворачиваем,
   иначе приклеивание альфы даёт невалидный цвет и квадрат не рисуется. */
function withAlpha(hex: string, alpha: string) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  return `#${full}${alpha}`;
}

function Section({
  icon,
  title,
  divider,
  children,
}: {
  icon: string;
  title: string;
  divider?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={divider ? "border-t border-[#1e1e1e] pt-4" : undefined}>
      <h3 className="gid-label mb-2 flex items-center gap-2 !text-[#9c9c9c]">
        <i className={`fas ${icon} text-[10px] !text-[#6f6f6f]`} />
        {title}
      </h3>
      {children}
    </section>
  );
}

function KeyCap({ children }: { children: ReactNode }) {
  return (
    <kbd className="shrink-0 border border-[#3f3f3f] bg-[#161616] px-1.5 py-0.5 font-mono text-[10px] font-bold leading-[1.4] text-[#3ef03e] shadow-[0_0_6px_rgba(0,255,65,.12)]">
      {children}
    </kbd>
  );
}

function Rows({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-1.5">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-right text-[#e6e6e6]">{k}</dt>
          <dd className="text-[#a6a6a6]">
            <span className="mr-2 text-[#4a4a4a]">—</span>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* --- Модалка -------------------------------------------------------------- */
export default function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <DraggableModal
      title={<>Справка по системе «ГИД Урал-ВНИИЖТ»</>}
      width={620}
      minW={520}
      onClose={onClose}
      footer={
        <button className="gid-btn gid-btn-primary" onClick={onClose}>
          <i className="fas fa-check" /> Понятно
        </button>
      }
    >
      <div className="space-y-5 text-[11px] leading-relaxed">
        <p className="border-l-2 border-[#0a8a34] bg-[#0b120c] py-2 pl-3 pr-2 text-[#b4c0b8]">
          График движения поездов участка. Нитки рисуются по времени слева направо, станции —
          сверху вниз; вертикальная красная пунктирная линия — текущее время.
        </p>

        <Section icon="fa-compass" title="Мышь">
          <Rows items={MOUSE} />
        </Section>

        <Section icon="fa-keyboard" title="Горячие клавиши" divider>
          <div className="flex flex-wrap gap-1.5">
            {HOTKEYS.map(([k, d]) => (
              <span
                key={k}
                className="inline-flex items-center gap-1.5 border border-[#2b2b2b] bg-[#131313] py-0.5 pl-1.5 pr-2"
              >
                <KeyCap>{k}</KeyCap>
                <span className="text-[#b3b3b3]">{d}</span>
              </span>
            ))}
          </div>
          <p className="mt-2 text-[#7d7d7d]">
            Поиск по номеру поезда, локомотиву или машинисту — кнопка «Поиск» в меню: нитка будет
            найдена и подсвечена на графике.
          </p>
        </Section>

        <Section icon="fa-palette" title="Цвета ниток" divider>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {Object.entries(CAT_NAMES).map(([key, name]) => (
              <span key={key} className="inline-flex items-center gap-2">
                {/* Образец нитки: чёрная подложка + рамка, иначе тёмный цвет сливается с фоном окна */}
                <span className="inline-flex h-[15px] w-[26px] shrink-0 items-center justify-center border border-[#3d3d3d] bg-black">
                  <i className="block h-[3px] w-full" style={{ background: CAT_COLORS[key] }} />
                </span>
                <span className="text-[#e4e4e4]">{name.toLowerCase()}</span>
              </span>
            ))}
          </div>
          <p className="mt-2.5 text-[#7d7d7d]">
            Цвет нитки соответствует категории поезда и назначается при её создании (F2).
            Выбранная нитка выделяется на графике свечением, номер — подписью в рамке.
          </p>
        </Section>

        <Section icon="fa-shapes" title="Пометки на графике" divider>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
            {MARKS.map((m) => (
              <span key={m.name} className="inline-flex items-start gap-2">
                <i className="mt-[3px] inline-flex h-[14px] w-5 shrink-0 items-center justify-center">
                  {m.glyph}
                </i>
                <span className="block leading-[1.45]">
                  <span className="block font-semibold text-[#e4e4e4]">{m.name}</span>
                  <span className="block text-[#7d7d7d]">{m.hint}</span>
                </span>
              </span>
            ))}
          </div>

          <div className="mt-3.5 border-t border-[#1e1e1e] pt-3">
            <div className="mb-2 text-[10px] text-[#8f8f8f]">
              Цвет выбирается в форме пометки (F5) и показывает характер отметки:
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {MARK_COLORS.map(([c, name, hint]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-2 border border-[#2b2b2b] bg-[#131313] py-[4px] pl-[7px] pr-2.5"
                >
                  <i
                    className="inline-block h-[13px] w-[13px] shrink-0"
                    style={{ background: withAlpha(c, "55"), border: `1px solid ${c}` }}
                  />
                  <span className="text-[#e2e2e2]">{name}</span>
                  <span className="text-[#7d7d7d]">— {hint}</span>
                </span>
              ))}
            </div>
          </div>
        </Section>

        <Section icon="fa-users" title="Роли и права" divider>
          <div className="space-y-1.5">
            {ROLES.map((r) => (
              <div key={r.short} className="flex items-center gap-2">
                <span className={`gid-chip ${r.cls} w-[62px] shrink-0 justify-center`}>{r.short}</span>
                <span className="text-[#e4e4e4]">{r.name}</span>
                <span className="text-[#7d7d7d]">— {r.rights}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section icon="fa-arrows-rotate" title="Синхронизация и данные" divider>
          <p className="text-[#a6a6a6]">
            Изменения применяются сразу и видны во всех открытых вкладках. График выгружается и
            загружается файлом JSON — «Экспорт» и «Импорт» в меню, «Сброс» возвращает исходные
            данные участка.
          </p>
        </Section>
      </div>
    </DraggableModal>
  );
}
