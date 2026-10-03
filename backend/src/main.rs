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

#[tokio::main]
async fn main() -> Result<()> {
    // Переменные из .env.local — как у Node-сервера.
    // Файл лежит в корне репозитория, а крейт собирается из backend/,
    // поэтому проверяем оба пути.
    let mut loaded = false;
    for path in [".env.local", "../.env.local"] {
        if dotenvy::from_path(path).is_ok() {
            loaded = true;
            break;
        }
    }
    if !loaded {
        let _ = dotenvy::dotenv();
    }

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

    let allowed_origins: Vec<String> = std::env::var("GID_ALLOWED_ORIGINS")
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
    let pool = db::build_pool(&std::env::var("DATABASE_URL").unwrap_or_default())?;
    db::wait_for_db(&pool, 20, 2000).await?;
    db::apply_schema(&pool).await?;

    if db::seed_if_empty(&pool).await? {
        tracing::info!("🌱 БД заполнена начальными данными");
    }

    // Первый администратор — из переменных окружения (GID_ADMIN_LOGIN/PASSWORD).
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
