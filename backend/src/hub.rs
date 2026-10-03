// Реестр живых WebSocket-соединений и кэш пользователей.
// Аналог liveSockets + userCache в server.ts.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{broadcast, Mutex};

use crate::models::UserMeta;

/// Сколько сообщений держим в буфере доставки на клиента.
const BROADCAST_BUFFER: usize = 256;

/// Служебное сообщение: клиент должен закрыть соединение сам.
pub const FORCE_CLOSE_MSG: &str = r#"{"kind":"__force_close__"}"#;

#[derive(Clone)]
pub struct Hub {
    /// Рассылка всем, включая отправителя (как в ws-сервере на Node).
    pub tx: broadcast::Sender<String>,
    inner: Arc<Mutex<Inner>>,
}

struct Inner {
    /// session -> канал конкретного сокета (для адресных отправок и kick).
    sockets: HashMap<String, broadcast::Sender<String>>,
    /// session -> данные пользователя для списка онлайн.
    users: HashMap<String, UserMeta>,
}

impl Hub {
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(BROADCAST_BUFFER);
        Hub {
            tx,
            inner: Arc::new(Mutex::new(Inner {
                sockets: HashMap::new(),
                users: HashMap::new(),
            })),
        }
    }

    /// Регистрирует сокет под сессией.
    ///
    /// Передаётся именно тот канал, который уже слушает соединение:
    /// если создать здесь новый, адресные сообщения (принудительное
    /// отключение) уйдут в никуда.
    pub async fn attach(
        &self,
        session: &str,
        meta: UserMeta,
        tx: tokio::sync::broadcast::Sender<String>,
    ) {
        let mut inner = self.inner.lock().await;
        inner.sockets.insert(session.to_string(), tx);
        inner.users.insert(session.to_string(), meta);
    }

    pub async fn detach(&self, session: &str) {
        let mut inner = self.inner.lock().await;
        inner.sockets.remove(session);
        inner.users.remove(session);
    }

    pub async fn set_user(&self, session: &str, meta: UserMeta) {
        let mut inner = self.inner.lock().await;
        inner.users.insert(session.to_string(), meta);
    }

    /// Список пользователей в сети — в порядке появления сессий.
    pub async fn presence_list(&self) -> Vec<UserMeta> {
        let inner = self.inner.lock().await;
        inner.users.values().cloned().collect()
    }

    pub async fn user_name(&self, session: &str) -> Option<String> {
        let inner = self.inner.lock().await;
        inner.users.get(session).map(|u| u.name.clone())
    }

    pub async fn user_name_role(&self, session: &str) -> Option<crate::permissions::Role> {
        let inner = self.inner.lock().await;
        inner
            .users
            .get(session)
            .and_then(|u| crate::permissions::Role::parse(&u.role))
    }

    pub async fn user_is_admin(&self, session: &str) -> bool {
        let inner = self.inner.lock().await;
        inner
            .users
            .get(session)
            .map(|u| u.is_admin)
            .unwrap_or(false)
    }

    pub async fn person_login(&self, session: &str) -> Option<String> {
        let inner = self.inner.lock().await;
        inner
            .users
            .get(session)
            .map(|u| u.person_login.clone())
            .filter(|l| !l.is_empty())
    }

    /// Все сеансы сотрудника — чтобы отключить его разом.
    pub async fn sessions_of_person(&self, login: &str) -> Vec<String> {
        let inner = self.inner.lock().await;
        inner
            .users
            .iter()
            .filter(|(_, u)| u.person_login == login)
            .map(|(s, _)| s.clone())
            .collect()
    }

    /// Закрывает соединение клиента (kick).
    pub async fn close_session(&self, session: &str) {
        let mut inner = self.inner.lock().await;
        if let Some(tx) = inner.sockets.get(session) {
            // Помечаем канал закрытым: у клиента onclose сработает по обрыву.
            let _ = tx.send(FORCE_CLOSE_MSG.to_string());
        }
        inner.sockets.remove(session);
        inner.users.remove(session);
    }

    pub async fn is_online(&self, session: &str) -> bool {
        let inner = self.inner.lock().await;
        inner.sockets.contains_key(session)
    }
}
