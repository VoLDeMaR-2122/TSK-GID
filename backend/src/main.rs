// ГИД Урал-ВНИИЖТ — backend на Rust.
// Вся логика и работа с БД здесь; отрисовка остаётся на Next.js.

mod accounts;
mod db;
mod hub;
mod models;
mod permissions;
mod ws;

use std::net::SocketAddr;

use anyhow::Result;
use axum::routing::get;
use axum::Router;

use crate::hub::Hub;

/// Читает переменную окружения по списку имён: сначала новое короткое,
/// потом прежнее. Пустые и состоящие из пробелов значения считаются
/// не заданными. Нужно, чтобы сервер на новом развёртывании и локальный
/// запуск со старым .env.local работали одновременно.
pub fn env_any(names: &[&str]) -> Option<String> {
    for name in names {
        if let Ok(value) = std::env::var(name) {
            if !value.trim().is_empty() {
                return Some(value);
            }
        }
    }
    None
}

#[tokio::main]
async fn main() -> Result<()> {
    // Переменные из .env.local — как у Node-сервера.
    // Файл лежит в корне репозитория, а запускаться можно откуда угодно,
    // поэтому ищем по абсолютным путям: от CWD, от родителя CWD и вверх
    // от папки бинарника. Относительным путям не доверяем.
    // Загрузка — после init логгера, чтобы ошибки было видно.
    let env_path = find_env_file();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    // Порт бэкенда — свой: PORT в .env.local занят Next.js.
    let port: u16 = std::env::var("BACKEND_PORT")
        .ok()
        .or_else(|| std::env::var("PORT").ok())
        .and_then(|p| p.parse().ok())
        .unwrap_or(3001);
    let hostname = std::env::var("BACKEND_HOST").unwrap_or_else(|_| "127.0.0.1".into());

    let allowed_origins: Vec<String> = env_any(&["allowed_origins", "GID_ALLOWED_ORIGINS"])
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    tracing::info!(
        "ГИД backend: порт {}, разрешённые origin: {:?}",
        port,
        allowed_origins
    );
    if let Some(path) = &env_path {
        // Грузим построчно, а не from_path: одна битая строка (например,
        // значение с пробелом без кавычек) не должна ронять весь файл.
        // Значения с пробелами — только в кавычках: LOGIN="Иванов И.И.".
        match dotenvy::from_path_iter(path) {
            Ok(iter) => {
                for item in iter {
                    match item {
                        Ok((k, v)) => {
                            if std::env::var(&k).is_err() {
                                std::env::set_var(&k, v);
                            }
                        }
                        Err(e) => tracing::warn!("пропуск битой строки .env: {}", e),
                    }
                }
            }
            Err(e) => tracing::warn!("не удалось загрузить {}: {}", path.display(), e),
        }
    } else {
        let _ = dotenvy::dotenv();
    }
    tracing::info!(
        "конфиг: env-файл={}, cwd={:?}, admin_login={}",
        env_path
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "(не найден)".into()),
        std::env::current_dir(),
        env_any(&["admin_login", "GID_ADMIN_LOGIN"]).unwrap_or_else(|| "(не задан)".into()),
    );
    let pool = db::build_pool(&std::env::var("DATABASE_URL").unwrap_or_default())?;
    db::wait_for_db(&pool, 20, 2000).await?;
    db::apply_schema(&pool).await?;

    if db::seed_if_empty(&pool).await? {
        tracing::info!("🌱 БД заполнена начальными данными");
    }

    // Матрица прав: заливаем значения по умолчанию для новых ролей,
    // читаем из базы в кеш. Дальше её правит администратор через панель.
    db::seed_role_caps(&pool).await?;
    let role_caps = db::load_role_caps(&pool).await?;
    permissions::init_role_caps(role_caps);

    // Первый администратор — из переменных окружения (admin_login/admin_password).
    db::bootstrap_first_admin(&pool).await?;

    // Чистим сеансы старой системы: роль в них ставил клиент,
    // и 14 записей с ролью admin стали бы настоящими администраторами.
    let purged = db::purge_legacy_users(&pool).await?;
    if purged > 0 {
        tracing::info!("удалено старых сеансов с клиентской ролью: {}", purged);
    }
    tracing::info!(
        "учётных записей в базе: {}",
        db::count_persons(&pool).await?
    );

    let hub = Hub::new();

    // Подтягиваем пользователей из БД, чтобы список онлайн был полным
    // до первого входа (как userCache в server.ts).
    if let Ok(users) = db::load_users_meta(&pool).await {
        tracing::info!("в БД найдено пользователей: {}", users.len());
    }

    let app = Router::new()
        .route("/ws", get(ws::ws_route))
        .route("/health", get(health))
        .with_state((pool, hub, allowed_origins));

    let addr: SocketAddr = format!("{}:{}", hostname, port).parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("🚂 backend запущен: ws://{}:{}/ws", hostname, port);

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}

async fn health() -> &'static str {
    "ok"
}

/// Ищет .env.local: сначала рядом с CWD, потом вверх от папки бинарника.
/// Возвращает первый существующий файл.
fn find_env_file() -> Option<std::path::PathBuf> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join(".env.local"));
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.join(".env.local"));
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..5 {
            match dir {
                Some(d) => {
                    candidates.push(d.join(".env.local"));
                    dir = d.parent().map(|p| p.to_path_buf());
                }
                None => break,
            }
        }
    }

    candidates.into_iter().find(|p| p.is_file())
}
