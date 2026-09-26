export type Role = "admin" | "dnc" | "dsp";

export const ADMIN_PASSWORD = "vold2122";

// Порядок важен: старший → младший
export const ROLE_NAMES: Record<Role, string> = {
  admin: "Администратор",
  dnc: "ДНЦ — поездной диспетчер",
  dsp: "ДСП — дежурный по станции",
};

export const ROLE_SHORT: Record<Role, string> = {
  admin: "АДМИН",
  dnc: "ДНЦ",
  dsp: "ДСП",
};

export type Action =
  | "stations.manage"   // редактировать станции
  | "trains.manage"     // создать / редактировать / удалить нитку поезда
  | "trains.mark"       // отметить прибытие / отправление / путь
  | "marks.manage"      // пометки, окна, задержки, сбои
  | "alerts.manage"     // оповещения
  | "users.manage_dsp"  // управлять дежурством ДСП
  | "users.manage_roles"// назначать роли (только админ)
  | "stats.view"
  | "admin.panel";

const MATRIX: Record<Role, Action[]> = {
  admin: [
    "stations.manage", "trains.manage", "trains.mark", "marks.manage",
    "alerts.manage", "users.manage_dsp", "users.manage_roles",
    "stats.view", "admin.panel",
  ],
  // ДНЦ — ведёт график, расставляет поезда, ставит пометки, руководит ДСП
  dnc: [
    "stations.manage", "trains.manage", "trains.mark", "marks.manage",
    "alerts.manage", "users.manage_dsp", "stats.view", "admin.panel",
  ],
  // ДСП — только фактические отметки + наблюдение
  dsp: [
    "trains.mark", "stats.view",
  ],
};

export function can(role: Role | undefined | null, action: Action): boolean {
  if (!role) return false;
  return MATRIX[role]?.includes(action) ?? false;
}

// Может ли текущий пользователь (actor) управлять юзером с ролью target
export function canManageRole(actor: Role | undefined, target: Role): boolean {
  if (!actor) return false;
  if (actor === "admin") return true;   // админ — всех
  if (actor === "dnc") return target === "dsp"; // ДНЦ — только ДСП
  return false;
}
