// Протокол WebSocket. Полный паритет с server.ts:
// входящие — login, logout, userPatch, kick, state, alertAdd, alertToggle, alertRemove;
// исходящие — hello, state, alerts, presence, audit.

use axum::extract::ws::{Message, WebSocket};
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::json;
use std::net::SocketAddr;
use tokio::sync::broadcast;

use crate::accounts;
use crate::db::{self, Db};
use crate::hub::{Hub, FORCE_CLOSE_MSG};
use crate::models::{AuditDraft, GidState, UserMeta, UserPatch};
use crate::permissions;

// ================= ВХОДЯЩИЕ СООБЩЕНИЯ =================

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Incoming {
    /// Вход по учётной записи: ФИО и пароль. Роль клиент не передаёт.
    Login {
        #[serde(default)]
        login: String,
        #[serde(default)]
        password: String,
    },
    /// Продолжение сеанса без повторного ввода пароля.
    Resume {
        #[serde(default)]
        session: String,
    },
    Logout,
    /// Смена своей учётной записи (пароль, ФИО).
    PasswordChange {
        #[serde(default)]
        current: String,
        #[serde(default)]
        next: String,
    },
    /// Управление учётными записями — только администратору.
    AccountCreate {
        #[serde(default)]
        login: String,
        #[serde(default)]
        name: String,
        #[serde(default)]
        password: String,
        #[serde(default)]
        role: String,
    },
    AccountPatch {
        #[serde(default)]
        login: String,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        role: Option<String>,
        #[serde(default)]
        active: Option<bool>,
    },
    AccountSetPassword {
        #[serde(default)]
        login: String,
        #[serde(default)]
        password: String,
    },
    /// Удаление учётной записи — только администратору.
    /// Владельца, себя и последнего админа удалить нельзя.
    AccountDelete {
        #[serde(default)]
        login: String,
    },
    /// Запрос актуального списка учётных записей (только администратору).
    AccountsList,
    /// Матрица прав: прочитать (только администратору).
    RolesList,
    /// Матрица прав: записать права роли (только администратору).
    RolesSet {
        #[serde(default)]
        role: String,
        #[serde(default)]
        caps: Vec<String>,
    },
    UserPatch {
        #[serde(default)]
        session: String,
        #[serde(default)]
        patch: UserPatch,
    },
    Kick {
        #[serde(default)]
        session: String,
    },
    State {
        state: GidState,
    },
    AlertAdd {
        alert: crate::models::Alert,
    },
    AlertUpdate {
        alert: crate::models::Alert,
    },
    AlertToggle {
        #[serde(default)]
        id: String,
    },
    AlertRemove {
        #[serde(default)]
        id: String,
    },
}

impl Incoming {
    /// Имя сообщения для журнала — Incoming разбирается деструктуризацией.
    fn kind_name(&self) -> &'static str {
        match self {
            Self::Login { .. } => "login",
            Self::Resume { .. } => "resume",
            Self::Logout => "logout",
            Self::PasswordChange { .. } => "passwordChange",
            Self::AccountCreate { .. } => "accountCreate",
            Self::AccountPatch { .. } => "accountPatch",
            Self::AccountSetPassword { .. } => "accountSetPassword",
            Self::AccountDelete { .. } => "accountDelete",
            Self::AccountsList => "accountsList",
            Self::RolesList => "rolesList",
            Self::RolesSet { .. } => "rolesSet",
            Self::UserPatch { .. } => "userPatch",
            Self::Kick { .. } => "kick",
            Self::State { .. } => "state",
            Self::AlertAdd { .. } => "alertAdd",
            Self::AlertUpdate { .. } => "alertUpdate",
            Self::AlertToggle { .. } => "alertToggle",
            Self::AlertRemove { .. } => "alertRemove",
        }
    }
}

// ================= СОСТОЯНИЕ СОЕДИНЕНИЯ =================

struct Conn {
    pool: Db,
    hub: Hub,
    /// Сессия этого сокета. Меняется при login.
    session: String,
    /// Личный канал сокета — по нему шлём адресные сообщения (kick).
    own_tx: tokio::sync::broadcast::Sender<String>,
}

pub async fn handle_socket(socket: WebSocket, pool: Db, hub: Hub) {
    let (mut sink, mut stream) = socket.split();

    let anon_session = format!("anon-{}", &uuid::Uuid::new_v4().to_string()[..8]);
    let (own_tx, mut own_rx) = tokio::sync::broadcast::channel(64);
    let mut global_rx = hub.tx.subscribe();

    // Держим линию живой. Пока сокет молчит, молчаливое соединение убивают
    // NAT и прокси примерно через 5 минут простоя — клиент переподключается,
    // а без работающего resume его выкидывало на экран входа.
    let mut keepalive = tokio::time::interval(std::time::Duration::from_secs(30));
    keepalive.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    let mut conn = Conn {
        pool: pool.clone(),
        hub: hub.clone(),
        session: anon_session.clone(),
        own_tx: own_tx.clone(),
    };

    // Персональное приветствие и стартовый снимок — как в server.ts.
    conn.send_to_self(&json!({ "kind": "hello", "clientId": anon_session }).to_string())
        .await;
    conn.send_initial_snapshot().await;

    loop {
        tokio::select! {
            // Входящие от клиента.
            next = stream.next() => {
                let Some(next) = next else { break };
                match next {
                    Ok(Message::Text(text)) => {
                        match serde_json::from_str::<Incoming>(text.as_str()) {
                            Ok(msg) => {
                                let kind = msg.kind_name();
                                if let Err(e) = conn.handle(msg).await {
                                    tracing::error!("ошибка обработки {}: {}", kind, e);
                                }
                            }
                            Err(e) => tracing::warn!("неизвестный формат сообщения: {}", e),
                        }
                    }
                    Ok(Message::Binary(bin)) => {
                        if let Ok(text) = String::from_utf8(bin.to_vec()) {
                            if let Ok(msg) = serde_json::from_str::<Incoming>(&text) {
                                let _ = conn.handle(msg).await;
                            }
                        }
                    }
                    Ok(Message::Close(_)) => break,
                    // Ping/Pong обслуживает axum сам.
                    Ok(_) => {}
                    Err(e) => {
                        tracing::warn!("ошибка чтения сокета: {}", e);
                        break;
                    }
                }
            }

            // Общая рассылка: state, alerts, presence, audit.
            msg = global_rx.recv() => {
                match msg {
                    Ok(text) => {
                        if sink.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        // Клиент не успевает — сообщения потеряны, предупреждаем в лог.
                        tracing::warn!("клиент отстал, пропущено {} сообщений", n);
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }

            // Дежурный ping: пока в линии идут пакеты, соединение не считается
            // простаивающим и его не обрывает промежуточное оборудование.
            // Браузер отвечает pong сам, отдельной обработки не нужно.
            _ = keepalive.tick() => {
                if sink.send(Message::Ping(Vec::new().into())).await.is_err() {
                    break;
                }
            }

            // Личные сообщения: hello, стартовый снимок, kick.
            msg = own_rx.recv() => {
                match msg {
                    Ok(text) => {
                        if text == FORCE_CLOSE_MSG {
                            let _ = sink.send(Message::Close(None)).await;
                            break;
                        }
                        if sink.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!("личный канал отстал, пропущено {} сообщений", n);
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    conn.on_close().await;
}

impl Conn {
    async fn send_to_self(&mut self, payload: &str) {
        let _ = self.own_tx.send(payload.to_string());
    }

    /// Рассылка всем: audit, presence, state, alerts.
    fn broadcast(&self, value: serde_json::Value) {
        let _ = self.hub.tx.send(value.to_string());
    }

    async fn send_initial_snapshot(&mut self) {
        if let Ok(state) = db::load_state(&self.pool).await {
            self.send_to_self(&json!({ "kind": "state", "state": state }).to_string())
                .await;
        }
        if let Ok(alerts) = db::load_alerts(&self.pool).await {
            self.send_to_self(&json!({ "kind": "alerts", "alerts": alerts }).to_string())
                .await;
        }
        let presence = self.hub.presence_list().await;
        self.send_to_self(&json!({ "kind": "presence", "users": presence }).to_string())
            .await;
        if let Ok(audit) = db::load_audit(&self.pool).await {
            self.send_to_self(&json!({ "kind": "audit", "audit": audit }).to_string())
                .await;
        }
    }

    async fn actor_name(&self) -> String {
        self.hub
            .user_name(&self.session)
            .await
            .unwrap_or_else(|| "system".into())
    }

    async fn handle(&mut self, msg: Incoming) -> anyhow::Result<()> {
        match msg {
            Incoming::Login { login, password } => self.on_login(login, password).await,
            Incoming::Resume { session } => self.on_resume(session).await,
            Incoming::Logout => self.on_logout().await,
            Incoming::PasswordChange { current, next } => {
                self.on_password_change(current, next).await
            }
            Incoming::AccountCreate {
                login,
                name,
                password,
                role,
            } => self.on_account_create(login, name, password, role).await,
            Incoming::AccountPatch {
                login,
                name,
                role,
                active,
            } => self.on_account_patch(login, name, role, active).await,
            Incoming::AccountSetPassword { login, password } => {
                self.on_account_set_password(login, password).await
            }
            Incoming::AccountDelete { login } => self.on_account_delete(login).await,
            Incoming::AccountsList => {
                self.send_accounts().await;
                Ok(())
            }
            Incoming::RolesList => {
                self.send_roles().await;
                Ok(())
            }
            Incoming::RolesSet { role, caps } => self.on_roles_set(role, caps).await,
            Incoming::UserPatch { session, patch } => self.on_user_patch(session, patch).await,
            Incoming::Kick { session } => self.on_kick(session).await,
            Incoming::State { state } => self.on_state(state).await,
            Incoming::AlertAdd { alert } => self.on_alert_add(alert).await,
            Incoming::AlertUpdate { alert } => self.on_alert_update(alert).await,
            Incoming::AlertToggle { id } => self.on_alert_toggle(id).await,
            Incoming::AlertRemove { id } => self.on_alert_remove(id).await,
        }
    }

    /// Вход по логину и паролю. Логин — нормализованное ФИО,
    /// роль берётся только из учётной записи, клиент её не присылает.
    async fn on_login(&mut self, login: String, password: String) -> anyhow::Result<()> {
        let normalized = accounts::normalize_login(&login);

        if normalized.is_empty() {
            self.reject_login("Введите логин").await;
            return Ok(());
        }

        let person = match db::find_person(&self.pool, &normalized).await {
            Ok(Some(p)) => p,
            Ok(None) => {
                // Одинаковый ответ для неизвестного логина и неверного пароля,
                // чтобы нельзя было перебирать список сотрудников.
                self.reject_login("Неверный логин или пароль").await;
                db::add_audit(
                    &self.pool,
                    &AuditDraft {
                        actor: normalized,
                        action: "login_denied".into(),
                        target: None,
                        detail: Some("неизвестный логин".into()),
                    },
                )
                .await?;
                self.broadcast_audit().await;
                return Ok(());
            }
            Err(e) => {
                tracing::error!("не удалось найти учётную запись: {}", e);
                self.reject_login("Ошибка базы данных").await;
                return Ok(());
            }
        };

        if !person.active {
            self.reject_login("Учётная запись отключена").await;
            return Ok(());
        }

        if !accounts::verify_password(&password, &person.password_hash) {
            self.reject_login("Неверный логин или пароль").await;
            db::add_audit(
                &self.pool,
                &AuditDraft {
                    actor: person.name.clone(),
                    action: "login_denied".into(),
                    target: None,
                    detail: Some("неверный пароль".into()),
                },
            )
            .await?;
            self.broadcast_audit().await;
            return Ok(());
        }

        self.start_session(&person).await
    }

    /// Продолжение сеанса: пароль повторно не спрашивается.
    async fn on_resume(&mut self, session: String) -> anyhow::Result<()> {
        if session.is_empty() {
            return Ok(());
        }

        let record = match db::load_users_meta(&self.pool).await {
            Ok(map) => match map.get(&session) {
                Some(u) => u.clone(),
                None => {
                    self.reject_resume().await;
                    return Ok(());
                }
            },
            Err(_) => {
                self.reject_resume().await;
                return Ok(());
            }
        };

        let login = record.person_login.clone();
        if login.is_empty() {
            self.reject_resume().await;
            return Ok(());
        }

        // Учётная запись могли отключить или сменить роль — проверяем заново.
        let person = match db::find_person(&self.pool, &login).await {
            Ok(Some(p)) if p.active => p,
            _ => {
                self.reject_resume().await;
                return Ok(());
            }
        };

        self.start_session(&person).await
    }

    /// Заводит сеанс для проверенного сотрудника.
    async fn start_session(&mut self, person: &accounts::Person) -> anyhow::Result<()> {
        // Сессия генерируется сервером — клиент не может её подделать.
        let session = format!(
            "s{}{}",
            db::now_ms(),
            &uuid::Uuid::new_v4().to_string()[..8]
        );

        let record = UserMeta {
            session: session.clone(),
            name: person.name.clone(),
            role: person.role.clone(),
            area: String::new(),
            on_duty: false,
            duty_time: String::new(),
            is_admin: person.is_admin,
            person_login: person.login.clone(),
        };

        db::upsert_user_login(&self.pool, &record).await?;

        // Та же учётка в другой вкладке — отключаем прежнюю.
        if self.hub.is_online(&session).await {
            self.hub.close_session(&session).await;
        }

        self.session = session.clone();
        self.hub
            .attach(&session, record.clone(), self.own_tx.clone())
            .await;

        // Клиенту: идентификатор сеанса, профиль и его права.
        self.send_to_self(
            &json!({
                "kind": "loginOk",
                "session": session,
                "user": record,
            })
            .to_string(),
        )
        .await;
        self.send_capabilities(&record).await;
        // Администратору сразу отдаём список сотрудников, чтобы панель
        // не показывала пустую таблицу до первого действия.
        self.send_accounts().await;
        // И матрицу прав для редактора.
        self.send_roles().await;

        db::add_audit(
            &self.pool,
            &AuditDraft {
                actor: person.name.clone(),
                action: "login".into(),
                target: None,
                detail: Some(format!("Роль: {}", person.role)),
            },
        )
        .await?;

        self.broadcast_audit().await;
        self.broadcast_presence().await;
        Ok(())
    }

    async fn reject_login(&mut self, message: &str) {
        self.send_to_self(&json!({ "kind": "authError", "message": message }).to_string())
            .await;
    }

    async fn reject_resume(&mut self) {
        self.send_to_self(
            &json!({
                "kind": "sessionExpired",
                "message": "Сеанс недействителен, войдите заново"
            })
            .to_string(),
        )
        .await;
    }

    /// Смена своего пароля — текущий проверяется обязательно.
    async fn on_password_change(&mut self, current: String, next: String) -> anyhow::Result<()> {
        let login = self.person_login().await;
        let person = match db::find_person(&self.pool, &login).await {
            Ok(Some(p)) => p,
            _ => {
                self.reject_login("Сеанс недействителен").await;
                return Ok(());
            }
        };

        if !accounts::verify_password(&current, &person.password_hash) {
            self.reject_login("Текущий пароль неверен").await;
            return Ok(());
        }

        if let Err(e) = accounts::validate_password(&next) {
            self.reject_login(&e).await;
            return Ok(());
        }

        db::set_person_password(&self.pool, &person.login, &next).await?;

        let name = self.actor_name().await;
        db::add_audit(
            &self.pool,
            &AuditDraft {
                actor: name,
                action: "password_change".into(),
                target: Some(person.login.clone()),
                detail: None,
            },
        )
        .await?;
        self.send_to_self(&json!({ "kind": "notice", "message": "Пароль изменён" }).to_string())
            .await;
        self.broadcast_audit().await;
        Ok(())
    }

    /// Заведение новой учётной записи — только администратору.
    async fn on_account_create(
        &mut self,
        login: String,
        name: String,
        password: String,
        role: String,
    ) -> anyhow::Result<()> {
        if !self.allowed("users.manage_roles").await {
            self.deny("users.manage_roles").await?;
            return Ok(());
        }

        let normalized = match accounts::validate_login(&login) {
            Ok(l) => l,
            Err(e) => {
                self.reject_login(&e).await;
                return Ok(());
            }
        };
        if let Err(e) = accounts::validate_password(&password) {
            self.reject_login(&e).await;
            return Ok(());
        }

        // Роль сверяется с серверным списком. Назначать админа через панель
        // можно: это обычный администратор (не владелец), его в любой момент
        // может понизить другой админ. Владельцем так не стать и не перестать быть.
        let role = match permissions::Role::parse_checked(&role) {
            Ok(r) => r.as_str_str(),
            Err(_) => "dsp",
        };

        if db::find_person(&self.pool, &normalized).await?.is_some() {
            self.reject_login("Такая учётная запись уже есть").await;
            return Ok(());
        }

        let actor = self.actor_name().await;
        db::create_person(
            &self.pool,
            db::NewPerson {
                login: &normalized,
                name: &name,
                password: &password,
                role,
                is_admin: false,
                protected: false,
                created_by: &actor,
            },
        )
        .await?;

        db::add_audit(
            &self.pool,
            &AuditDraft {
                actor,
                action: "account_create".into(),
                target: Some(normalized),
                detail: Some(format!("роль: {}", role)),
            },
        )
        .await?;

        self.send_to_self(
            &json!({ "kind": "notice", "message": "Учётная запись создана" }).to_string(),
        )
        .await;
        self.send_accounts().await;
        self.broadcast_audit().await;
        Ok(())
    }

    /// Смена роли, ФИО или активности — только администратору.
    async fn on_account_patch(
        &mut self,
        login: String,
        name: Option<String>,
        role: Option<String>,
        active: Option<bool>,
    ) -> anyhow::Result<()> {
        if !self.allowed("users.manage_roles").await {
            self.deny("users.manage_roles").await?;
            return Ok(());
        }

        let normalized = accounts::normalize_login(&login);
        let target = match db::find_person(&self.pool, &normalized).await? {
            Some(p) => p,
            None => {
                self.reject_login("Учётная запись не найдена").await;
                return Ok(());
            }
        };

        // Владелец неприкосновенен: через панель его не трогает никто,
        // включая его самого. Свой пароль он меняет отдельно.
        if target.protected {
            self.reject_login("Учётная запись владельца защищена").await;
            return Ok(());
        }

        // Кому админ управлять не может.
        let actor_role = self.hub.user_name_role(&self.session).await;
        let actor_admin = self.hub.user_is_admin(&self.session).await;
        let target_role = permissions::Role::parse(&target.role).unwrap_or(permissions::Role::Dsp);
        if !permissions::can_manage_role(actor_role, target_role, actor_admin)
            && target_role != permissions::Role::Admin
        {
            self.deny("управление этой учётной записью").await?;
            return Ok(());
        }

        if role.is_some() {
            let r = role.clone().unwrap();
            if permissions::Role::parse_checked(&r).is_err() {
                self.reject_login("Неизвестная роль").await;
                return Ok(());
            }
        }

        // Нельзя оставить систему без единого администратора.
        // Админом считается и владелец, и назначенный (role = 'admin'):
        // снимаем галочку, только если админы останутся.
        let was_admin = target.is_admin || target.role == "admin";
        let new_role = role.clone().unwrap_or_else(|| target.role.clone());
        let loses_admin = was_admin && (new_role != "admin" || active == Some(false));
        if loses_admin && db::count_active_admins(&self.pool).await? <= 1 {
            self.reject_login("Это последний администратор — его нельзя отключить")
                .await;
            return Ok(());
        }

        let actor = self.actor_name().await;
        db::patch_person(
            &self.pool,
            &normalized,
            name.as_deref(),
            role.as_deref(),
            active,
        )
        .await?;

        // Отключённого выкидываем из активных сеансов.
        if active == Some(false) {
            self.kick_by_person(&normalized).await;
        }
        self.refresh_person_sessions(&normalized).await;

        db::add_audit(
            &self.pool,
            &AuditDraft {
                actor,
                action: "account_patch".into(),
                target: Some(normalized),
                detail: Some(
                    serde_json::json!({ "name": name, "role": role, "active": active }).to_string(),
                ),
            },
        )
        .await?;

        self.send_accounts().await;
        self.broadcast_audit().await;
        self.broadcast_presence().await;
        Ok(())
    }

    /// Сброс пароля чужой учётной записи — только администратору.
    async fn on_account_set_password(
        &mut self,
        login: String,
        password: String,
    ) -> anyhow::Result<()> {
        if !self.allowed("users.manage_roles").await {
            self.deny("users.manage_roles").await?;
            return Ok(());
        }
        if let Err(e) = accounts::validate_password(&password) {
            self.reject_login(&e).await;
            return Ok(());
        }

        let normalized = accounts::normalize_login(&login);
        let target = match db::find_person(&self.pool, &normalized).await? {
            Some(p) => p,
            None => {
                self.reject_login("Учётная запись не найдена").await;
                return Ok(());
            }
        };
        if target.protected {
            self.reject_login("Учётная запись владельца защищена").await;
            return Ok(());
        }

        db::set_person_password(&self.pool, &normalized, &password).await?;

        let actor = self.actor_name().await;
        db::add_audit(
            &self.pool,
            &AuditDraft {
                actor,
                action: "account_password_reset".into(),
                target: Some(normalized),
                detail: None,
            },
        )
        .await?;

        self.send_to_self(&json!({ "kind": "notice", "message": "Пароль сброшен" }).to_string())
            .await;
        self.broadcast_audit().await;
        Ok(())
    }

    /// Удаление учётной записи — только администратору.
    /// Запрещено: владелец, своя учётка, последний администратор.
    async fn on_account_delete(&mut self, login: String) -> anyhow::Result<()> {
        if !self.allowed("users.manage_roles").await {
            self.deny("users.manage_roles").await?;
            return Ok(());
        }

        let normalized = accounts::normalize_login(&login);
        if normalized.is_empty() {
            self.reject_login("Пустой логин").await;
            return Ok(());
        }
        let target = match db::find_person(&self.pool, &normalized).await? {
            Some(p) => p,
            None => {
                self.reject_login("Учётная запись не найдена").await;
                return Ok(());
            }
        };

        if target.protected {
            self.reject_login("Учётная запись владельца защищена").await;
            return Ok(());
        }

        // Себя удалять нельзя: сеанс повиснет без учётки.
        // Для ухода есть отключение, для смены — другая учётка.
        let own = self.person_login().await;
        if !own.is_empty() && own == normalized {
            self.reject_login("Нельзя удалить свою учётную запись").await;
            return Ok(());
        }

        let was_admin = target.is_admin || target.role == "admin";
        if was_admin && target.active && db::count_active_admins(&self.pool).await? <= 1 {
            self.reject_login("Это последний администратор — его нельзя удалить")
                .await;
            return Ok(());
        }

        // Сначала рвём живые сеансы, потом удаляем строки.
        self.kick_by_person(&normalized).await;
        db::delete_person(&self.pool, &normalized).await?;

        let actor = self.actor_name().await;
        db::add_audit(
            &self.pool,
            &AuditDraft {
                actor,
                action: "account_delete".into(),
                target: Some(normalized),
                detail: None,
            },
        )
        .await?;

        self.send_to_self(&json!({ "kind": "notice", "message": "Учётная запись удалена" }).to_string())
            .await;
        self.send_accounts().await;
        self.broadcast_audit().await;
        self.broadcast_presence().await;
        Ok(())
    }

    /// Список учётных записей — администратору.
    async fn send_accounts(&mut self) {
        if !self.allowed("users.manage_roles").await {
            return;
        }
        match db::list_persons(&self.pool).await {
            Ok(list) => {
                // Хеши паролей наружу не уходят.
                let public: Vec<serde_json::Value> = list
                    .iter()
                    .map(|p| {
                        json!({
                            "login": p.login,
                            "name": p.name,
                            "role": p.role,
                            "isAdmin": p.is_admin,
                            "active": p.active,
                            "protected": p.protected,
                            "createdAt": p.created_at,
                            "createdBy": p.created_by,
                        })
                    })
                    .collect();
                self.send_to_self(&json!({ "kind": "accounts", "accounts": public }).to_string())
                    .await;
            }
            Err(e) => tracing::error!("не удалось получить список учётных записей: {}", e),
        }
    }

    /// Матрица прав — администратору. Клиент рисует по ней редактор.
    async fn send_roles(&mut self) {
        if !self.allowed("users.manage_roles").await {
            return;
        }
        match db::load_role_caps(&self.pool).await {
            Ok(map) => {
                self.send_to_self(
                    &json!({
                        "kind": "roles",
                        "actions": permissions::ACTIONS,
                        "roles": map,
                    })
                    .to_string(),
                )
                .await;
            }
            Err(e) => tracing::error!("не удалось получить матрицу прав: {}", e),
        }
    }

    /// Запись прав роли. После сохранения всем онлайн-сеансам этой роли
    /// досылаются новые права — интерфейс перестраивается без перезахода.
    async fn on_roles_set(&mut self, role: String, caps: Vec<String>) -> anyhow::Result<()> {
        if !self.allowed("users.manage_roles").await {
            self.deny("users.manage_roles").await?;
            return Ok(());
        }

        let role_parsed = match permissions::Role::parse_checked(&role) {
            Ok(r) => r,
            Err(e) => {
                self.reject_login(&e).await;
                return Ok(());
            }
        };

        // У роли admin право управлять ролями снять нельзя: иначе назначенные
        // администраторы потеряют панель, и вести систему будет некому.
        // Владелец этим не ограничен — у него полный набор всегда.
        let mut clean: Vec<String> = caps
            .into_iter()
            .filter(|a| permissions::is_known_action(a))
            .collect();
        clean.sort();
        clean.dedup();
        if role_parsed == permissions::Role::Admin
            && !clean.iter().any(|a| a == "users.manage_roles")
        {
            self.reject_login("У роли администратора нельзя забирать управление ролями")
                .await;
            return Ok(());
        }

        db::set_role_caps(&self.pool, role_parsed.as_str_str(), &clean).await?;
        permissions::update_role_caps_cache(role_parsed.as_str_str(), clean.clone());

        let actor = self.actor_name().await;
        db::add_audit(
            &self.pool,
            &AuditDraft {
                actor,
                action: "roles_set".into(),
                target: Some(role_parsed.as_str_str().to_string()),
                detail: Some(clean.join(",")),
            },
        )
        .await?;

        // Досылаем новые права всем, кто сейчас в этой роли.
        for session in self.hub.sessions_of_role(role_parsed.as_str_str()).await {
            let is_admin = self.hub.user_is_admin(&session).await;
            let list = permissions::capabilities(Some(role_parsed), is_admin);
            self.hub
                .send_to(
                    &session,
                    &json!({
                        "kind": "capabilities",
                        "role": role_parsed.as_str_str(),
                        "isAdmin": is_admin,
                        "caps": list,
                    })
                    .to_string(),
                )
                .await;
        }

        self.send_to_self(&json!({ "kind": "notice", "message": "Права роли обновлены" }).to_string())
            .await;
        self.send_roles().await;
        self.broadcast_audit().await;
        Ok(())
    }

    /// Логин учётной записи, под которой открыт текущий сеанс.
    async fn person_login(&self) -> String {
        let role = self.hub.user_name_role(&self.session).await;
        let _ = role;
        self.hub
            .person_login(&self.session)
            .await
            .unwrap_or_default()
    }

    /// Закрывает сеансы сотрудника.
    async fn kick_by_person(&self, login: &str) {
        let sessions = self.hub.sessions_of_person(login).await;
        for s in sessions {
            self.hub.close_session(&s).await;
            let _ = db::release_duty(&self.pool, &s).await;
        }
    }

    /// Обновляет права уже открытых сеансов сотрудника (смена роли).
    async fn refresh_person_sessions(&self, login: &str) {
        if let Ok(Some(person)) = db::find_person(&self.pool, login).await {
            for s in self.hub.sessions_of_person(login).await {
                let record = UserMeta {
                    session: s.clone(),
                    name: person.name.clone(),
                    role: person.role.clone(),
                    area: String::new(),
                    on_duty: false,
                    duty_time: String::new(),
                    is_admin: person.is_admin,
                    person_login: person.login.clone(),
                };
                self.hub.set_user(&s, record).await;
            }
        }
    }

    /// Отправляет клиенту список его прав и роль.
    async fn send_capabilities(&mut self, user: &UserMeta) {
        let role = permissions::Role::parse(&user.role);
        let caps = permissions::capabilities(role, user.is_admin);
        self.send_to_self(
            &json!({
                "kind": "capabilities",
                "role": user.role,
                "isAdmin": user.is_admin,
                "caps": caps,
            })
            .to_string(),
        )
        .await;
    }

    /// Проверка права текущего пользователя.
    async fn allowed(&self, action: &str) -> bool {
        let role = self.hub.user_name_role(&self.session).await;
        let is_admin = self.hub.user_is_admin(&self.session).await;
        permissions::can(role, action, is_admin)
    }

    /// Отказ: клиенту объяснение, в журнал — попытка.
    async fn deny(&mut self, action: &str) -> anyhow::Result<()> {
        let name = self
            .hub
            .user_name(&self.session)
            .await
            .unwrap_or_else(|| "?".into());
        self.send_to_self(
            &json!({
                "kind": "forbidden",
                "message": format!("Недостаточно прав: {}", action),
            })
            .to_string(),
        )
        .await;
        db::add_audit(
            &self.pool,
            &AuditDraft {
                actor: name,
                action: "denied".into(),
                target: Some(action.to_string()),
                detail: None,
            },
        )
        .await?;
        self.broadcast_audit().await;
        Ok(())
    }

    async fn on_logout(&mut self) -> anyhow::Result<()> {
        let name = self.hub.user_name(&self.session).await;
        self.hub.detach(&self.session).await;

        if let Some(n) = name {
            db::add_audit(
                &self.pool,
                &AuditDraft {
                    actor: n,
                    action: "logout".into(),
                    target: None,
                    detail: None,
                },
            )
            .await?;
        }
        self.broadcast_audit().await;
        self.broadcast_presence().await;
        Ok(())
    }

    async fn on_user_patch(&mut self, target: String, patch: UserPatch) -> anyhow::Result<()> {
        if target.is_empty() {
            return Ok(());
        }

        // Смена роли — только администратору. Остальное — старшим над дежурными.
        let changing_role = patch.role.is_some();
        let needed = if changing_role {
            "users.manage_roles"
        } else {
            "users.manage_dsp"
        };
        if !self.allowed(needed).await {
            self.deny(needed).await?;
            return Ok(());
        }

        // ДНЦ не может поднять человека выше себя или назначить админа.
        if changing_role {
            let target_role = patch.role.clone().unwrap_or_default();
            let actor_role = self.hub.user_name_role(&self.session).await;
            let actor_admin = self.hub.user_is_admin(&self.session).await;
            let target_parsed = permissions::Role::parse(&target_role);
            if !permissions::can_manage_role(
                actor_role,
                target_parsed.unwrap_or(permissions::Role::Dsp),
                actor_admin,
            ) {
                self.deny("управление этой ролью").await?;
                return Ok(());
            }
            // Повысить до админа можно только входом с паролем, не через назначение роли.
            if target_parsed == Some(permissions::Role::Admin) {
                self.send_to_self(
                    &json!({
                        "kind": "forbidden",
                        "message": "Роль администратора выдаётся только входом с паролем",
                    })
                    .to_string(),
                )
                .await;
                return Ok(());
            }
        }

        let actor = self.actor_name().await;
        let target_name = self
            .hub
            .user_name(&target)
            .await
            .unwrap_or_else(|| target.clone());

        db::patch_user(&self.pool, &target, &patch).await?;

        db::add_audit(
            &self.pool,
            &AuditDraft {
                actor,
                action: "userPatch".into(),
                target: Some(target_name),
                detail: serde_json::to_string(&patch).ok(),
            },
        )
        .await?;

        if let Ok(map) = db::load_users_meta(&self.pool).await {
            if let Some(fresh) = map.get(&target) {
                self.hub.set_user(&target, fresh.clone()).await;
            }
        }

        self.broadcast_audit().await;
        self.broadcast_presence().await;
        Ok(())
    }

    async fn on_kick(&mut self, target: String) -> anyhow::Result<()> {
        if target.is_empty() {
            return Ok(());
        }

        // Отключать пользователей может только администратор.
        if !self.allowed("users.manage_roles").await {
            self.deny("users.manage_roles").await?;
            return Ok(());
        }

        let actor = self.actor_name().await;
        let target_name = self
            .hub
            .user_name(&target)
            .await
            .unwrap_or_else(|| target.clone());

        // Рвём сокет, вычищаем из кэша и БД.
        self.hub.close_session(&target).await;
        db::delete_user(&self.pool, &target).await?;

        db::add_audit(
            &self.pool,
            &AuditDraft {
                actor,
                action: "kick".into(),
                target: Some(target_name),
                detail: None,
            },
        )
        .await?;

        self.broadcast_audit().await;
        self.broadcast_presence().await;
        Ok(())
    }

    async fn on_state(&mut self, state: GidState) -> anyhow::Result<()> {
        // Протокол передаёт гра целиком, поэтому разделить изменения ДСП
        // и ДНЦ на сервере нельзя — проверяем лишь факт входа.
        // Пофайловое разграничение потребует передачи правок, а не снимка.
        if !self.allowed("trains.mark").await {
            self.deny("trains.mark").await?;
            return Ok(());
        }

        let actor = self.actor_name().await;
        let trains_n = state.trains.len();
        let stations_n = state.stations.len();

        db::save_state(&self.pool, &state).await?;

        db::add_audit(
            &self.pool,
            &AuditDraft {
                actor,
                action: "state_save".into(),
                target: None,
                detail: Some(format!("Поездов: {}, Станций: {}", trains_n, stations_n)),
            },
        )
        .await?;

        self.broadcast_audit().await;

        if let Ok(fresh) = db::load_state(&self.pool).await {
            self.broadcast(json!({ "kind": "state", "state": fresh }));
        }
        Ok(())
    }

    async fn on_alert_add(&mut self, alert: crate::models::Alert) -> anyhow::Result<()> {
        if !self.allowed("alerts.manage").await {
            self.deny("alerts.manage").await?;
            return Ok(());
        }
        if !matches!(alert.kind.as_str(), "info" | "warning" | "critical") {
            self.reject_login("Неизвестный тип оповещения").await;
            return Ok(());
        }

        // Автор всегда серверный: клиент не может подписаться чужим именем.
        let alert = crate::models::Alert {
            author: self.actor_name().await,
            ..alert
        };

        db::add_alert(&self.pool, &alert).await?;

        db::add_audit(
            &self.pool,
            &AuditDraft {
                actor: alert.author.clone(),
                action: "alert_add".into(),
                target: None,
                detail: Some(alert.text.clone()),
            },
        )
        .await?;

        self.broadcast_audit().await;
        self.broadcast_alerts().await;
        Ok(())
    }

    /// Редактирование оповещения: тип, название, краткое и полное описание.
    /// Автор и время создания не меняются. Несуществующий id — тихий пропуск.
    async fn on_alert_update(&mut self, alert: crate::models::Alert) -> anyhow::Result<()> {
        if !self.allowed("alerts.manage").await {
            self.deny("alerts.manage").await?;
            return Ok(());
        }
        if !matches!(alert.kind.as_str(), "info" | "warning" | "critical") {
            self.reject_login("Неизвестный тип оповещения").await;
            return Ok(());
        }

        let changed = db::update_alert(&self.pool, &alert).await?;

        if changed > 0 {
            let actor = self.actor_name().await;
            db::add_audit(
                &self.pool,
                &AuditDraft {
                    actor,
                    action: "alert_update".into(),
                    target: Some(alert.id.clone()),
                    detail: alert.title.clone().into(),
                },
            )
            .await?;

            self.broadcast_audit().await;
            self.broadcast_alerts().await;
        }
        Ok(())
    }

    async fn on_alert_toggle(&mut self, id: String) -> anyhow::Result<()> {
        if !self.allowed("alerts.manage").await {
            self.deny("alerts.manage").await?;
            return Ok(());
        }
        db::toggle_alert(&self.pool, &id).await?;

        let actor = self.actor_name().await;
        db::add_audit(
            &self.pool,
            &AuditDraft {
                actor,
                action: "alert_toggle".into(),
                target: Some(id),
                detail: None,
            },
        )
        .await?;

        self.broadcast_audit().await;
        self.broadcast_alerts().await;
        Ok(())
    }

    async fn on_alert_remove(&mut self, id: String) -> anyhow::Result<()> {
        if !self.allowed("alerts.manage").await {
            self.deny("alerts.manage").await?;
            return Ok(());
        }
        db::remove_alert(&self.pool, &id).await?;

        let actor = self.actor_name().await;
        db::add_audit(
            &self.pool,
            &AuditDraft {
                actor,
                action: "alert_remove".into(),
                target: Some(id),
                detail: None,
            },
        )
        .await?;

        self.broadcast_audit().await;
        self.broadcast_alerts().await;
        Ok(())
    }

    async fn broadcast_audit(&self) {
        if let Ok(audit) = db::load_audit(&self.pool).await {
            self.broadcast(json!({ "kind": "audit", "audit": audit }));
        }
    }

    async fn broadcast_presence(&self) {
        let users = self.hub.presence_list().await;
        self.broadcast(json!({ "kind": "presence", "users": users }));
    }

    async fn broadcast_alerts(&self) {
        if let Ok(alerts) = db::load_alerts(&self.pool).await {
            self.broadcast(json!({ "kind": "alerts", "alerts": alerts }));
        }
    }

    /// Разрыв соединения: снимаем с дежурства, как в server.ts.
    async fn on_close(&self) {
        if self.hub.is_online(&self.session).await {
            self.hub.detach(&self.session).await;

            if let Err(e) = db::release_duty(&self.pool, &self.session).await {
                tracing::error!("не удалось снять дежурство: {}", e);
            }
            self.broadcast_presence().await;
        }
    }
}

/// Обработчик апгрейда: проверка origin и запуск handle_socket.
pub async fn ws_route(
    State((pool, hub, allowed)): State<(Db, Hub, Vec<String>)>,
    upgrade: axum::extract::ws::WebSocketUpgrade,
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    if !allowed.is_empty() {
        if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
            if !allowed.iter().any(|a| a == origin) {
                tracing::warn!("[SECURITY] WS-соединение отклонено, origin: {}", origin);
                return (
                    StatusCode::FORBIDDEN,
                    [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                    "origin не разрешён",
                )
                    .into_response();
            }
        }
    }

    tracing::info!("WS-подключение от {}", addr);
    upgrade
        .on_upgrade(move |socket| handle_socket(socket, pool, hub))
        .into_response()
}
