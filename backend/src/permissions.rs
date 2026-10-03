// Права доступа.
// Матрица «роль → права» хранится в базе (таблица role_caps) и правится
// через панель администратора. Здесь — кеш в памяти, значения по умолчанию
// и проверки. Фронтенд матрицы не знает: он получает готовый список прав.
//
// Пароли здесь не хранятся и не сравниваются — учётные записи и argon2id
// лежат в accounts.rs.

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

// ================= РОЛИ =================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    Admin,
    Dnc,
    Dsp,
}

impl Role {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "admin" => Some(Role::Admin),
            "dnc" => Some(Role::Dnc),
            "dsp" => Some(Role::Dsp),
            _ => None,
        }
    }

    /// Разбор с проверкой: неизвестное значение не проходит.
    pub fn parse_checked(s: &str) -> Result<Self, String> {
        Self::parse(s).ok_or_else(|| format!("неизвестная роль: {}", s))
    }

    /// Строковое имя роли для записи в базу.
    pub fn as_str_str(&self) -> &'static str {
        match self {
            Role::Admin => "admin",
            Role::Dnc => "dnc",
            Role::Dsp => "dsp",
        }
    }

    pub fn all() -> [Role; 3] {
        [Role::Admin, Role::Dnc, Role::Dsp]
    }
}

// ================= ДЕЙСТВИЯ =================

/// Права на действия — те же строки, что ждёт интерфейс.
pub const ACTIONS: &[&str] = &[
    "stations.manage",
    "trains.manage",
    "trains.mark",
    "marks.manage",
    "alerts.manage",
    "users.manage_dsp",
    "users.manage_roles",
    "stats.view",
    "admin.panel",
];

pub fn is_known_action(a: &str) -> bool {
    ACTIONS.contains(&a)
}

/// Значения по умолчанию — заливаются в базу при первом запуске.
/// Роль admin обязана хранить users.manage_roles: иначе назначенные
/// администраторы потеряют управление ролями и систему будет некому вести.
fn default_matrix(role: Role) -> &'static [&'static str] {
    match role {
        Role::Admin => &[
            "stations.manage",
            "trains.manage",
            "trains.mark",
            "marks.manage",
            "alerts.manage",
            "users.manage_dsp",
            "users.manage_roles",
            "stats.view",
            "admin.panel",
        ],
        // ДНЦ ведёт график и руководит ДСП, но роли не назначает.
        Role::Dnc => &[
            "stations.manage",
            "trains.manage",
            "trains.mark",
            "marks.manage",
            "alerts.manage",
            "users.manage_dsp",
            "stats.view",
            "admin.panel",
        ],
        // ДСП только отметки и наблюдение.
        Role::Dsp => &["trains.mark", "stats.view"],
    }
}

pub fn default_caps_map() -> HashMap<String, Vec<String>> {
    Role::all()
        .iter()
        .map(|r| {
            (
                r.as_str_str().to_string(),
                default_matrix(*r).iter().map(|s| s.to_string()).collect(),
            )
        })
        .collect()
}

// ================= КЕШ МАТРИЦЫ =================

static ROLE_CAPS: OnceLock<RwLock<HashMap<String, Vec<String>>>> = OnceLock::new();

/// Вызывается один раз на старте: подхватывает матрицу из базы.
/// Пустые роли добиваются значениями по умолчанию.
pub fn init_role_caps(db_map: HashMap<String, Vec<String>>) {
    let mut map = default_caps_map();
    for (role, caps) in db_map {
        if Role::parse(&role).is_some() {
            map.insert(role, caps.into_iter().filter(|a| is_known_action(a)).collect());
        }
    }
    let _ = ROLE_CAPS.set(RwLock::new(map));
}

/// Обновляет кеш после сохранения в базу.
pub fn update_role_caps_cache(role: &str, caps: Vec<String>) {
    if let Some(cache) = ROLE_CAPS.get() {
        if let Ok(mut guard) = cache.write() {
            guard.insert(role.to_string(), caps);
        }
    }
}

fn caps_for(role: Role) -> Vec<String> {
    if let Some(cache) = ROLE_CAPS.get() {
        if let Ok(guard) = cache.read() {
            if let Some(v) = guard.get(role.as_str_str()) {
                return v.clone();
            }
        }
    }
    default_matrix(role).iter().map(|s| s.to_string()).collect()
}

/// Проверка права. `is_admin` — владелец из переменных окружения:
/// у него всегда полный набор, матрицей его не урезать.
pub fn can(role: Option<Role>, action: &str, is_admin: bool) -> bool {
    if is_admin {
        return ACTIONS.contains(&action);
    }
    let role = match role {
        Some(r) => r,
        None => return false,
    };
    caps_for(role).iter().any(|a| a == action)
}

/// Права конкретного пользователя — уходит на клиент, чтобы тот
/// показывал и прятал нужные пункты меню.
pub fn capabilities(role: Option<Role>, is_admin: bool) -> Vec<String> {
    if is_admin {
        return ACTIONS.iter().map(|s| s.to_string()).collect();
    }
    let role = match role {
        Some(r) => r,
        None => return Vec::new(),
    };
    let source = caps_for(role);
    ACTIONS
        .iter()
        .map(|s| s.to_string())
        .filter(|a| source.iter().any(|x| x == a))
        .collect()
}

/// Может ли actor управлять пользователем с ролью target.
pub fn can_manage_role(actor: Option<Role>, target: Role, is_admin: bool) -> bool {
    let actor = match actor {
        Some(r) => r,
        None => return false,
    };
    if is_admin || actor == Role::Admin {
        return true;
    }
    if actor == Role::Dnc {
        return target == Role::Dsp;
    }
    false
}

// ================= ТЕСТЫ ПРАВ =================

#[cfg(test)]
mod tests {
    use super::*;

    fn has(caps: &[String], action: &str) -> bool {
        caps.iter().any(|a| a == action)
    }

    #[test]
    fn права_по_ролям() {
        // ДСП не управляет станциями.
        assert!(!can(Some(Role::Dsp), "stations.manage", false));
        assert!(can(Some(Role::Dsp), "trains.mark", false));

        // ДНЦ не назначает роли.
        assert!(can(Some(Role::Dnc), "users.manage_dsp", false));
        assert!(!can(Some(Role::Dnc), "users.manage_roles", false));

        // Админ может всё.
        assert!(can(Some(Role::Admin), "users.manage_roles", false));
    }

    #[test]
    fn вошедший_под_админом_сохраняет_права_при_смене_роли() {
        // Роль отображается как dsp, но is_admin=true — права админские.
        assert!(can(Some(Role::Dsp), "users.manage_roles", true));
        assert!(has(&capabilities(Some(Role::Dsp), true), "users.manage_roles"));
    }

    #[test]
    fn управление_ролями() {
        assert!(can_manage_role(Some(Role::Admin), Role::Dsp, false));
        // ДНЦ руководит только ДСП.
        assert!(can_manage_role(Some(Role::Dnc), Role::Dsp, false));
        assert!(!can_manage_role(Some(Role::Dnc), Role::Admin, false));
        assert!(!can_manage_role(Some(Role::Dsp), Role::Dsp, false));
    }

    #[test]
    fn список_прав_не_пустой_и_совпадает_с_матрицей() {
        let caps = capabilities(Some(Role::Dsp), false);
        assert_eq!(caps.len(), 2);
        assert!(has(&caps, "trains.mark"));
        assert_eq!(capabilities(Some(Role::Admin), false).len(), ACTIONS.len());
    }

    #[test]
    fn значения_по_умолчанию_корректны() {
        let map = default_caps_map();
        assert_eq!(map.len(), 3);
        // ДСП — минимум, админ — всё, ДНЦ — без назначения ролей.
        assert_eq!(map["dsp"], vec!["trains.mark", "stats.view"]);
        assert_eq!(map["admin"].len(), ACTIONS.len());
        assert!(!map["dnc"].contains(&"users.manage_roles".to_string()));
        // Владелец кешем не ограничивается.
        assert!(can(Some(Role::Dsp), "trains.mark", true));
    }
}
