// Учётные записи: логин (ФИО), пароль, роль.
// Пароли хранятся только в виде argon2id-хеша, открытых паролей в базе нет.

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use password_hash::rand_core::OsRng;

/// Учётная запись сотрудника.
#[derive(Debug, Clone)]
pub struct Person {
    /// Нормализованный логин — по нему идёт вход.
    pub login: String,
    /// ФИО в том виде, в каком его показывают.
    pub name: String,
    pub password_hash: String,
    pub role: String,
    pub is_admin: bool,
    pub active: bool,
    pub created_at: i64,
    pub created_by: String,
}

/// Нормализация логина: без разных написаний одного и того же ФИО.
/// Регистр, лишние пробелы и типографские дефисы не имеют значения.
pub fn normalize_login(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .filter(|c| !matches!(c, '\u{200b}' | '\u{200c}' | '\u{200d}' | '\u{feff}'))
        .collect();

    let chars: Vec<char> = cleaned.chars().collect();
    let mut out = String::new();

    for (i, &ch) in chars.iter().enumerate() {
        // Типографские тире и неразрывный пробел приводим к обычным.
        let ch = match ch {
            '\u{2010}' | '\u{2011}' | '\u{2012}' | '\u{2013}' | '\u{2014}' | '\u{2212}' => '-',
            c => c,
        };

        if ch.is_whitespace() {
            if out.is_empty() || out.ends_with(' ') {
                continue;
            }
            // Пробел перед знаком препинания не нужен: "П .П" → "П.П".
            let next = chars[i + 1..].iter().find(|c| !c.is_whitespace());
            let before_punct = next
                .map(|c| matches!(c, '.' | ',' | ';' | ':' | '!' | '?' | ')' | ']'))
                .unwrap_or(true);
            if !before_punct {
                out.push(' ');
            }
            continue;
        }

        for lower in ch.to_lowercase() {
            out.push(lower);
        }
    }

    out.trim().to_string()
}

/// Проверка пароля на соответствие минимальным требованиям.
pub fn validate_password(pw: &str) -> Result<(), String> {
    if pw.chars().count() < 6 {
        return Err("Пароль короче 6 символов".into());
    }
    if pw.chars().count() > 128 {
        return Err("Пароль длиннее 128 символов".into());
    }
    Ok(())
}

/// Проверка логина.
pub fn validate_login(raw: &str) -> Result<String, String> {
    let normalized = normalize_login(raw);
    if normalized.is_empty() {
        return Err("Пустой логин".into());
    }
    if normalized.chars().count() > 64 {
        return Err("Логин длиннее 64 символов".into());
    }
    if normalized.contains('\u{0000}') {
        return Err("Логин содержит недопустимый символ".into());
    }
    Ok(normalized)
}

/// Считает хеш пароля со случайной солью.
pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("не удалось посчитать хеш пароля: {}", e))
}

/// Сверяет пароль с сохранённым хешем.
pub fn verify_password(password: &str, stored_hash: &str) -> bool {
    match PasswordHash::new(stored_hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok(),
        // Нечитаемый хеш — считаем, что пароль не подошёл.
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn логин_нормализуется() {
        assert_eq!(normalize_login("  Иванов  И.И. "), "иванов и.и.");
        assert_eq!(normalize_login("ИВАНОВ  И.И"), "иванов и.и");
        // Типографское тире и неразрывный пробел
        assert_eq!(normalize_login("Петров\u{2013}П\u{a0}.П"), "петров-п.п");
        // Пробел перед точкой в инициалах не сохраняется
        assert_eq!(normalize_login("Сидоров  С.И."), "сидоров с.и.");
        assert_eq!(normalize_login("Петров\u{a0}П\u{a0}.П"), "петров п.п");
    }

    #[test]
    fn хеш_не_равен_паролю_и_проверяется() {
        let h = hash_password("verysecret").unwrap();
        assert!(!h.contains("verysecret"));
        assert!(verify_password("verysecret", &h));
        assert!(!verify_password("wrong", &h));
        assert!(!verify_password("verysecret", "мусор"));
    }

    #[test]
    fn одна_и_та_же_соль_не_даёт_одинаковые_хеши() {
        let a = hash_password("same").unwrap();
        let b = hash_password("same").unwrap();
        assert_ne!(a, b, "соль должна быть случайной");
        assert!(verify_password("same", &a) && verify_password("same", &b));
    }

    #[test]
    fn требования_к_паролю() {
        assert!(validate_password("123456").is_ok());
        assert!(validate_password("12345").is_err());
        assert!(validate_password(&"x".repeat(200)).is_err());
    }

    #[test]
    fn пустой_логин_отклоняется() {
        assert!(validate_login("   ").is_err());
        assert_eq!(validate_login(" Иванов ").unwrap(), "иванов");
    }
}
