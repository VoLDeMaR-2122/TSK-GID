// Роли и названия — только для отображения.
//
// Правила доступа и пароль администратора живут на сервере
// (backend/src/permissions.rs). Здесь их нет: клиент получает от
// сервера готовый список своих прав в сообщении "capabilities"
// и только отображает интерфейс accordingly.

export type Role = "admin" | "dnc" | "dsp";

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

/**
 * Действия, которые может разрешить сервер. Матрица «роль → права»
 * намеренно отсутствует: её знает только сервер.
 */
export type Action =
  | "stations.manage"
  | "trains.manage"
  | "trains.mark"
  | "marks.manage"
  | "alerts.manage"
  | "users.manage_dsp"
  | "users.manage_roles"
  | "stats.view"
  | "admin.panel";

/** Права текущего пользователя, присланные сервером. */
export type Capabilities = readonly Action[];

/**
 * Есть ли право на действие.
 *
 * Это только отображение интерфейса — прятать кнопку удобно, но не
 * защищает: настоящую проверку делает сервер и отвечает "forbidden".
 * Если сервер ещё не прислал права, действие считается запрещённым.
 */
export function can(caps: Capabilities | undefined | null, action: Action): boolean {
  return !!caps?.includes(action);
}

/**
 * Может ли текущий пользователь управлять другим.
 *
 * Тоже дублирует серверную проверку исключительно для показа кнопок —
 * ДНЦ видит управление только ДСП, администратор видит всех.
 */
export function canManageRole(
  caps: Capabilities | undefined | null,
  actor: Role | undefined | null,
  target: Role,
): boolean {
  if (!caps || !actor) return false;
  if (can(caps, "users.manage_roles")) return true; // админ — всех
  if (can(caps, "users.manage_dsp")) return target === "dsp"; // ДНЦ — только ДСП
  return false;
}
