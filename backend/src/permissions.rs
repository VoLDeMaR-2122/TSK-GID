// Права доступа.
// Это единственное место, где живут правила: фронтенд их не знает,
// он получает от сервера готовый список своих возможностей.
//
// Пароли здесь не хранятся и не сравниваются — учётные записи и argon2id
// лежат в accounts.rs.

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

/// Матрица прав. Единственный источник: сервер решает, что кому можно.
fn matrix(role: Role) -> &'static [&'static str] {
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

/// Проверка права. `is_admin` — вошёл под паролем администратора,
/// такие сохраняют полные права при любой текущей роли.
pub fn can(role: Option<Role>, action: &str, is_admin: bool) -> bool {
    let role = match role {
        Some(r) => r,
        None => return false,
    };
    if is_admin {
        return matrix(Role::Admin).contains(&action);
    }
    matrix(role).contains(&action)
}

/// Права конкретного пользователя — уходит на клиент, чтобы тот
/// показывал и прятал нужные пункты меню.
pub fn capabilities(role: Option<Role>, is_admin: bool) -> Vec<&'static str> {
    let source = if is_admin {
        matrix(Role::Admin)
    } else {
        match role {
            Some(r) => matrix(r),
            None => return Vec::new(),
        }
    };
    ACTIONS
        .iter()
        .copied()
        .filter(|a| source.contains(a))
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
        assert!(capabilities(Some(Role::Dsp), true).contains(&"users.manage_roles"));
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
        assert!(caps.contains(&"trains.mark"));
        assert_eq!(capabilities(Some(Role::Admin), false).len(), ACTIONS.len());
    }
}
