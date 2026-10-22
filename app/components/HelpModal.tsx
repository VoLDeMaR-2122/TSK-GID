"use client";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CAT_COLORS, CAT_NAMES } from "@/lib/types";
import DraggableModal from "./DraggableModal";

/* --- Данные справки ------------------------------------------------------- */
const MOUSE: { icon: string; gesture: string; action: string }[] = [
  { icon: "fa-computer-mouse", gesture: "Колесо мыши", action: "прокрутка графика по времени суток" },
  { icon: "fa-magnifying-glass-plus", gesture: "Ctrl + колесо", action: "масштаб сетки 2–24 ч, шаг 0,5 ч" },
  { icon: "fa-plus", gesture: "Двойной клик", action: "новая нитка с отметкой времени под курсором" },
  { icon: "fa-hand-pointer", gesture: "Клик по нитке", action: "выбрать нитку и открыть карточку справа" },
  { icon: "fa-pen", gesture: "Двойной клик по пометке", action: "редактирование пометки" },
  { icon: "fa-up-down-left-right", gesture: "Заголовок окна", action: "перетаскивание окна" },
  { icon: "fa-up-right-and-down-left-from-center", gesture: "Правый нижний угол", action: "изменение размера окна" },
];

const HOTKEYS: [string, string][] = [
  ["F1", "справка"],
  ["F2", "новая нитка"],
  ["F3", "станции участка"],
  ["F4", "дежурство"],
  ["F5", "пометка на графике"],
  ["F6", "панель администратора"],
  ["F7", "статистика"],
  ["Del", "удалить выбранное"],
  ["Esc", "закрыть окна"],
];

/* Права ролей — по матрице сервера (backend/src/permissions.rs) */
const ROLES: { short: string; cls: string; name: string; rights: string[] }[] = [
  {
    short: "АДМИН",
    cls: "gid-chip-op",
    name: "Администратор",
    rights: ["все права ДНЦ", "учётные записи сотрудников", "назначение ролей и матрица прав"],
  },
  {
    short: "ДНЦ",
    cls: "gid-chip-dnc",
    name: "Поездной диспетчер",
    rights: ["нитки, станции и пометки", "оповещения", "дежурство ДСП", "панель и статистика"],
  },
  {
    short: "ДСП",
    cls: "gid-chip-dsp",
    name: "Дежурный по станции",
    rights: ["фактические отметки: прибытие, отправление, путь", "просмотр статистики"],
  },
];

/* Типы пометок — по MarkModal. Глифы повторяют отрисовку на графике (TrainGraph). */
const MARKS: { glyph: ReactNode; name: string; hint: string }[] = [
  {
    glyph: (
      <i
        className="block h-[12px] w-[22px] border border-[#ff0]"
        style={{ background: "repeating-linear-gradient(135deg, #ffff0040 0 1px, transparent 1px 5px)" }}
      />
    ),
    name: "Окно",
    hint: "закрытие перегона на интервал",
  },
  {
    glyph: <i className="block h-[2px] w-[22px] bg-[#ff0]" />,
    name: "Линия",
    hint: "предупреждение или работы на перегоне",
  },
  {
    glyph: (
      <span className="inline-flex items-center gap-[3px]">
        <i className="block h-[14px] w-px bg-[#ff0]" />
        <i className="font-mono text-[9px] not-italic leading-none text-[#ff0]">Abc</i>
      </span>
    ),
    name: "Текст",
    hint: "короткая подпись у станции",
  },
  {
    glyph: <i className="fas fa-xmark text-[14px] text-[#ff0]" />,
    name: "Задержка / сбой",
    hint: "отклонение от расписания",
  },
];

/* Цвета пометок — как в форме пометки (MarkModal) */
const MARK_COLORS: [string, string, string][] = [
  ["#ffffff", "Белый", "плановое"],
  ["#ffff00", "Жёлтый", "фактическое"],
  ["#ff0000", "Красный", "передержка"],
];

/* --- Блоки ---------------------------------------------------------------- */
function Section({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.8px] text-[#8a8a8a]">
        <i className={`fas ${icon} text-[10px] text-[#0c8a34]`} aria-hidden />
        {title}
        <span className="h-px flex-1 bg-[#1e1e1e]" aria-hidden />
      </h3>
      {children}
    </section>
  );
}

function KeyCap({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid min-w-[34px] place-items-center border border-[#3a3a3a] border-b-[#555] bg-gradient-to-b from-[#202020] to-[#121212] px-1.5 py-[3px] font-mono text-[10px] font-bold leading-none text-[#3ef03e] shadow-[0_1px_0_#000,0_0_6px_rgba(0,255,65,.1)]">
      {children}
    </kbd>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`border border-[#222] bg-[#0b0b0b] ${className}`}>{children}</div>;
}

/* --- Вкладки -------------------------------------------------------------- */
function TabBasics() {
  return (
    <div className="space-y-5">
      <div className="flex gap-3 border border-[#0a3a1a] bg-gradient-to-r from-[#07160c] to-[#0b0b0b] p-3">
        <i className="fas fa-train mt-0.5 text-[16px] text-[#00dd44]" aria-hidden />
        <p className="text-[#b4c0b8]">
          График исполненного движения поездов участка. Время идёт слева направо, станции — сверху
          вниз. Красная пунктирная линия — текущее московское время.
        </p>
      </div>

      <Section icon="fa-arrows-rotate" title="Как это работает">
        <div className="grid grid-cols-3 gap-2">
          {[
            { icon: "fa-bolt", title: "Сразу", text: "изменения применяются без кнопки «Сохранить»" },
            { icon: "fa-users", title: "У всех", text: "правки видны во всех открытых вкладках и у коллег" },
            { icon: "fa-shield-halved", title: "По правам", text: "доступные действия зависят от роли" },
          ].map((f) => (
            <Card key={f.title} className="p-2.5">
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-[#e4e4e4]">
                <i className={`fas ${f.icon} text-[10px] text-[#00dd44]`} aria-hidden />
                {f.title}
              </div>
              <div className="text-[10px] leading-[1.5] text-[#7d7d7d]">{f.text}</div>
            </Card>
          ))}
        </div>
      </Section>

      <Section icon="fa-magnifying-glass" title="Поиск">
        <p className="text-[#a6a6a6]">
          Кнопка «Поиск» в меню ищет по номеру поезда, локомотиву или машинисту. Найденная нитка
          выделяется, и график прокручивается к ней.
        </p>
      </Section>
    </div>
  );
}

function TabControls() {
  return (
    <div className="space-y-5">
      <Section icon="fa-keyboard" title="Горячие клавиши">
        <div className="grid grid-cols-3 gap-1.5">
          {HOTKEYS.map(([k, d]) => (
            <Card key={k} className="flex items-center gap-2 px-2 py-1.5">
              <KeyCap>{k}</KeyCap>
              <span className="truncate text-[#b3b3b3]">{d}</span>
            </Card>
          ))}
        </div>
      </Section>

      <Section icon="fa-computer-mouse" title="Мышь">
        <Card>
          {MOUSE.map((m, i) => (
            <div
              key={m.gesture}
              className={`flex items-center gap-3 px-3 py-[7px] ${i ? "border-t border-[#191919]" : ""}`}
            >
              <i className={`fas ${m.icon} w-3.5 text-center text-[10px] text-[#5a5a5a]`} aria-hidden />
              <span className="w-[160px] shrink-0 font-semibold text-[#e6e6e6]">{m.gesture}</span>
              <span className="text-[#9a9a9a]">{m.action}</span>
            </div>
          ))}
        </Card>
      </Section>
    </div>
  );
}

function TabLegend() {
  return (
    <div className="space-y-5">
      <Section icon="fa-palette" title="Категории поездов">
        <div className="grid grid-cols-3 gap-1.5">
          {Object.entries(CAT_NAMES).map(([key, name]) => (
            <Card key={key} className="flex items-center gap-2.5 px-2.5 py-2">
              <span className="relative h-[3px] w-[26px] shrink-0" style={{ background: CAT_COLORS[key] }}>
                <span
                  className="absolute inset-0 blur-[3px]"
                  style={{ background: CAT_COLORS[key], opacity: 0.6 }}
                  aria-hidden
                />
              </span>
              <span className="text-[#e4e4e4]">{name}</span>
            </Card>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-[#6f6f6f]">
          Категория задаётся при создании нитки (F2). Выбранная нитка подсвечивается.
        </p>
      </Section>

      <Section icon="fa-shapes" title="Пометки">
        <div className="grid grid-cols-2 gap-1.5">
          {MARKS.map((m) => (
            <Card key={m.name} className="flex items-center gap-3 px-2.5 py-2">
              <span className="grid h-[22px] w-[34px] shrink-0 place-items-center border border-[#1e1e1e] bg-black">
                {m.glyph}
              </span>
              <span className="leading-[1.4]">
                <span className="block font-semibold text-[#e4e4e4]">{m.name}</span>
                <span className="block text-[10px] text-[#7d7d7d]">{m.hint}</span>
              </span>
            </Card>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] text-[#6f6f6f]">Цвет пометки (F5):</span>
          {MARK_COLORS.map(([c, name, hint]) => (
            <span key={name} className="inline-flex items-center gap-1.5 border border-[#222] bg-[#0b0b0b] px-2 py-[3px]">
              <i className="inline-block h-[9px] w-[9px]" style={{ background: c, boxShadow: `0 0 5px ${c}88` }} aria-hidden />
              <span className="text-[#e2e2e2]">{name}</span>
              <span className="text-[#6f6f6f]">— {hint}</span>
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}

function TabRoles() {
  return (
    <div className="space-y-2">
      {ROLES.map((r) => (
        <Card key={r.short} className="flex gap-3 p-3">
          <span className={`gid-chip ${r.cls} h-fit w-[62px] shrink-0 justify-center`}>{r.short}</span>
          <div className="min-w-0">
            <div className="mb-1.5 font-semibold text-[#e4e4e4]">{r.name}</div>
            <ul className="flex flex-wrap gap-1.5">
              {r.rights.map((right) => (
                <li key={right} className="inline-flex items-center gap-1.5 border border-[#1e1e1e] bg-[#111] px-1.5 py-[2px] text-[10px] text-[#a0a0a0]">
                  <i className="fas fa-check text-[8px] text-[#0c8a34]" aria-hidden />
                  {right}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ))}
      <p className="pt-1 text-[10px] text-[#6f6f6f]">
        Права проверяет сервер. Администратор может изменить их в панели (F6).
      </p>
    </div>
  );
}

function TabData() {
  const items = [
    { icon: "fa-arrow-down", title: "Экспорт", text: "выгружает станции, нитки и пометки в файл JSON" },
    { icon: "fa-arrow-up", title: "Импорт", text: "загружает график из файла JSON и заменяет текущий" },
    { icon: "fa-rotate-left", title: "Сброс", text: "возвращает исходные данные участка" },
    { icon: "fa-box-archive", title: "Сейвы", text: "страница /saves — отдельные архивы станций и ниток" },
  ];
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <Card key={it.title} className="flex items-center gap-3 px-3 py-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center border border-[#0a3a1a] bg-[#07160c]">
            <i className={`fas ${it.icon} text-[11px] text-[#00dd44]`} aria-hidden />
          </span>
          <span>
            <span className="block font-semibold text-[#e4e4e4]">{it.title}</span>
            <span className="block text-[10px] text-[#7d7d7d]">{it.text}</span>
          </span>
        </Card>
      ))}
      <p className="flex items-center gap-2 border-l-2 border-[#8a6a00] bg-[#141000] px-3 py-2 text-[10px] text-[#c8b06a]">
        <i className="fas fa-triangle-exclamation" aria-hidden />
        Импорт и сброс меняют график у всех пользователей сразу.
      </p>
    </div>
  );
}

const TABS = [
  { id: "basics", icon: "fa-circle-info", label: "Основное", body: <TabBasics /> },
  { id: "controls", icon: "fa-keyboard", label: "Управление", body: <TabControls /> },
  { id: "legend", icon: "fa-palette", label: "Обозначения", body: <TabLegend /> },
  { id: "roles", icon: "fa-users", label: "Роли", body: <TabRoles /> },
  { id: "data", icon: "fa-database", label: "Данные", body: <TabData /> },
] as const;

/* --- Модалка -------------------------------------------------------------- */
export default function HelpModal({ onClose, version }: { onClose: () => void; version?: string }) {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Стрелки влево/вправо переключают вкладки — стандартное поведение tablist.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (active + step + TABS.length) % TABS.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <DraggableModal
      title={<><i className="fas fa-circle-question" /> Справка</>}
      width={640}
      minW={560}
      minH={420}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-[10px] text-[#555]">
            ГИД Урал-ВНИИЖТ{version ? ` · v${version}` : ""}
          </span>
          <button className="gid-btn gid-btn-primary" onClick={onClose}>
            <i className="fas fa-check" /> Понятно
          </button>
        </>
      }
    >
      <div className="-mx-3 -mt-3 mb-4 flex border-b border-[#1e1e1e] bg-[#0b0b0b] px-2" role="tablist" aria-label="Разделы справки">
        {TABS.map((t, i) => {
          const selected = i === active;
          return (
            <button
              key={t.id}
              ref={(el) => { tabRefs.current[i] = el; }}
              id={`help-tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`help-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={onTabKey}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[11px] font-semibold tracking-[.3px] outline-none transition-colors focus-visible:bg-[#151515] ${
                selected
                  ? "border-[#00dd44] text-white"
                  : "border-transparent text-[#6a6a6a] hover:text-[#bbb]"
              }`}
            >
              <i className={`fas ${t.icon} text-[10px] ${selected ? "text-[#00dd44]" : ""}`} aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      <div
        id={`help-panel-${TABS[active].id}`}
        role="tabpanel"
        aria-labelledby={`help-tab-${TABS[active].id}`}
        className="min-h-[300px] text-[11px] leading-relaxed"
      >
        {TABS[active].body}
      </div>
    </DraggableModal>
  );
}
