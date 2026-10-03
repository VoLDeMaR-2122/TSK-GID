// Модели данных. Сериализуются в camelCase — этого ждёт фронтенд на Next.js.
// Имена колонок в Postgres остаются snake_case (см. db.rs).

use serde::{Deserialize, Serialize};

// ================= ПОЛЬЗОВАТЕЛИ =================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMeta {
    pub session: String,
    pub name: String,
    pub role: String,
    pub area: String,
    pub on_duty: bool,
    pub duty_time: String,
    /// Признак входа под паролем администратора. Ставит только сервер
    /// после успешной сверки пароля, клиент его не присылает.
    #[serde(default)]
    pub is_admin: bool,
    /// Логин учётной записи, которой принадлежит сеанс.
    /// Роль и права берутся из неё, а не из клиентских данных.
    #[serde(default)]
    pub person_login: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub area: Option<String>,
    #[serde(default)]
    pub on_duty: Option<bool>,
    #[serde(default)]
    pub duty_time: Option<String>,
}

impl UserPatch {
    pub fn is_empty(&self) -> bool {
        self.name.is_none()
            && self.role.is_none()
            && self.area.is_none()
            && self.on_duty.is_none()
            && self.duty_time.is_none()
    }
}

// ================= ГРАФ =================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stop {
    #[serde(rename = "stationId")]
    pub station_id: String,
    pub arr: Option<String>,
    pub dep: Option<String>,
    pub path: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Station {
    pub id: String,
    pub name: String,
    pub km: f64,
    pub paths: i32,
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Train {
    pub id: String,
    pub number: String,
    pub category: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loco_series: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loco_num: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub driver: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weight: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub length: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cargo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub naturka: Option<String>,
    /// В БД колонка называется `idx` (зарезервированное слово), наружу — `index`.
    #[serde(rename = "index", skip_serializing_if = "Option::is_none")]
    pub index: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default)]
    pub stops: Vec<Stop>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mark {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub peregon: i32,
    pub start: String,
    /// В БД колонка `end_time` — слово `end` в SQL требует кавычек.
    #[serde(rename = "end")]
    pub end_time: String,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service: Option<String>,
}

/// Полное состояние графа — то, что фронтенд шлёт и получает целиком.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GidState {
    pub stations: Vec<Station>,
    pub trains: Vec<Train>,
    pub marks: Vec<Mark>,
}

// ================= ТРЕВОГИ И АУДИТ =================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    pub id: String,
    #[serde(rename = "type", default)]
    pub kind: String,
    /// Название — показывается в полоске и заголовке.
    #[serde(default)]
    pub title: String,
    /// Краткое описание — строка в списке и под заголовком.
    #[serde(default)]
    pub text: String,
    /// Полное описание — открывается по клику на полоску.
    #[serde(default)]
    pub full: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default = "default_true")]
    pub active: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub ts: i64,
    pub actor: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AuditDraft {
    pub actor: String,
    pub action: String,
    pub target: Option<String>,
    pub detail: Option<String>,
}
