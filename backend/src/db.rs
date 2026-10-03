// Слой доступа к PostgreSQL. Схема таблиц и все запросы повторяют server.ts,
// чтобы фронтенд работал без изменений.

use anyhow::{anyhow, Context, Result};
use deadpool_postgres::{Config as PoolConfig, Pool, Runtime};
use tokio_postgres::{NoTls, Row};

use crate::models::{
    Alert, AuditDraft, AuditEntry, GidState, Mark, Station, Stop, Train, UserMeta,
};

pub type Db = Pool;

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS users (
  session   TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'dsp',
  area      TEXT NOT NULL DEFAULT '',
  on_duty   BOOLEAN NOT NULL DEFAULT false,
  duty_time TEXT NOT NULL DEFAULT '',
  is_admin  BOOLEAN NOT NULL DEFAULT false
);

-- Учётные записи сотрудников. Логин — нормализованное ФИО.
-- Роль и пароль назначает администратор, клиент их не выбирает.
CREATE TABLE IF NOT EXISTS persons (
  login         TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'dsp',
  is_admin      BOOLEAN NOT NULL DEFAULT false,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    BIGINT NOT NULL,
  created_by    TEXT NOT NULL DEFAULT 'system',
  -- Владелец из переменных окружения. Ставится только при развёртывании,
  -- через панель не назначается и не снимается.
  protected     BOOLEAN NOT NULL DEFAULT false
);

-- Матрица прав ролей. Правится через панель администратора.
CREATE TABLE IF NOT EXISTS role_caps (
  role TEXT PRIMARY KEY,
  caps TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS stations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  km DOUBLE PRECISION NOT NULL DEFAULT 0,
  paths INT NOT NULL DEFAULT 3,
  code TEXT NOT NULL DEFAULT '',
  ord INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS trains (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  loco_series TEXT,
  loco_num TEXT,
  driver TEXT,
  weight TEXT,
  length TEXT,
  cargo TEXT,
  naturka TEXT,
  idx TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS train_stops (
  id TEXT PRIMARY KEY,
  train_id TEXT NOT NULL REFERENCES trains(id) ON DELETE CASCADE,
  station_id TEXT NOT NULL REFERENCES stations(id),
  arr TEXT,
  dep TEXT,
  path INT NOT NULL DEFAULT 1,
  ord INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS marks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  peregon INT NOT NULL DEFAULT 0,
  start TEXT NOT NULL,
  end_time TEXT NOT NULL,
  color TEXT NOT NULL,
  text TEXT,
  service TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  "full" TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  ts BIGINT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
"#;

pub fn build_pool(database_url: &str) -> Result<Pool> {
    let mut cfg = PoolConfig::new();

    // DATABASE_URL, если задан, заменяет собранные ниже части.
    if !database_url.is_empty() {
        cfg.url = Some(database_url.to_string());
    }
    cfg.host = Some(std::env::var("DB_HOST").unwrap_or_else(|_| "localhost".into()));
    cfg.port = Some(
        std::env::var("DB_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(5432),
    );
    cfg.user = Some(std::env::var("POSTGRES_USER").unwrap_or_else(|_| "gid".into()));
    cfg.password = std::env::var("POSTGRES_PASSWORD").ok();
    cfg.dbname = Some(std::env::var("POSTGRES_DB").unwrap_or_else(|_| "gid".into()));

    cfg.create_pool(Some(Runtime::Tokio1), NoTls)
        .context("не удалось создать пул соединений с Postgres")
}

/// Ждёт готовности БД — сервер может стартовать раньше Postgres.
pub async fn wait_for_db(pool: &Pool, retries: u32, delay_ms: u64) -> Result<()> {
    for i in 0..retries {
        match pool.get().await {
            Ok(c) => {
                tracing::info!("соединение с БД установлено");
                drop(c);
                return Ok(());
            }
            Err(e) => {
                tracing::warn!(
                    "попытка {}/{} не удалась: {}. Повтор через {} мс",
                    i + 1,
                    retries,
                    e,
                    delay_ms
                );
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
            }
        }
    }
    Err(anyhow!("БД недоступна после {} попыток", retries))
}

pub async fn apply_schema(pool: &Pool) -> Result<()> {
    let client = pool.get().await?;

    // Колонка добавлена позже — CREATE TABLE IF NOT EXISTS её не создаст
    // в уже существующей базе, поэтому добавляем отдельно.
    client
        .execute(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false",
            &[],
        )
        .await?;
    // Сессия теперь ссылается на учётную запись.
    client
        .execute(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS person_login TEXT NOT NULL DEFAULT ''",
            &[],
        )
        .await?;
    // Поля расширенного редактора оповещений — для баз, созданных раньше.
    client
        .execute(
            "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''",
            &[],
        )
        .await?;
    client
        .execute(
            "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS \"full\" TEXT NOT NULL DEFAULT ''",
            &[],
        )
        .await?;
    // Флаг неприкосновенности владельца — для баз, созданных раньше.
    client
        .execute(
            "ALTER TABLE persons ADD COLUMN IF NOT EXISTS protected BOOLEAN NOT NULL DEFAULT false",
            &[],
        )
        .await?;

    client.batch_execute(SCHEMA_SQL).await?;
    Ok(())
}

// ================= УЧЁТНЫЕ ЗАПИСИ =================

/// Первый администратор создаётся из переменных окружения при развёртывании.
/// Вызывается на старте: если активных администраторов ещё нет — заводит учётную
/// запись из GID_ADMIN_LOGIN / GID_ADMIN_PASSWORD. Пароль открытым текстом
/// в базу не попадает: сохраняется только argon2id-хеш.
pub async fn bootstrap_first_admin(pool: &Pool) -> Result<bool> {
    // Владелец из переменных помечается защищённым всегда — даже если
    // администраторы уже есть. Это же закрывает базы, созданные до флага.
    ensure_owner_protected(pool).await?;

    if db_count_active_admins(pool).await? > 0 {
        tracing::info!("администратор в базе уже есть — начальная настройка не требуется");
        return Ok(false);
    }

    let login = match std::env::var("GID_ADMIN_LOGIN") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => {
            tracing::warn!(
                "администраторов нет и GID_ADMIN_LOGIN не задан — вход в систему будет невозможен"
            );
            return Ok(false);
        }
    };
    let password = std::env::var("GID_ADMIN_PASSWORD").unwrap_or_default();

    if password.is_empty() {
        tracing::warn!("GID_ADMIN_PASSWORD не задан — администратор не создан");
        return Ok(false);
    }

    let normalized = crate::accounts::normalize_login(&login);
    let display_name = std::env::var("GID_ADMIN_NAME").unwrap_or_else(|_| login.clone());

    // Учётка могла остаться от прошлого развёртывания — обновляем пароль и права.
    if find_person(pool, &normalized).await?.is_some() {
        set_person_password(pool, &normalized, &password).await?;
        patch_person(
            pool,
            &normalized,
            Some(&display_name),
            Some("admin"),
            Some(true),
        )
        .await?;
        promote_person_admin(pool, &normalized).await?;
        set_person_protected(pool, &normalized, true).await?;
        tracing::info!(
            "начальный администратор {} обновлён из переменных окружения",
            normalized
        );
        return Ok(true);
    }

    create_person(
        pool,
        NewPerson {
            login: &normalized,
            name: &display_name,
            password: &password,
            role: "admin",
            is_admin: true,
            protected: true,
            created_by: "окружение",
        },
    )
    .await?;
    tracing::info!(
        "создан начальный администратор {} из переменных окружения (логин: {}, пароль в базу не пишется)",
        display_name,
        normalized
    );
    Ok(true)
}

async fn db_count_active_admins(pool: &Pool) -> Result<i64> {
    count_active_admins(pool).await
}

/// Назначает учётной записи права администратора.
pub async fn promote_person_admin(pool: &Pool, login: &str) -> Result<()> {
    let client = pool.get().await?;
    client
        .execute(
            "UPDATE persons SET is_admin = true, role = 'admin' WHERE login = $1",
            &[&login],
        )
        .await?;
    Ok(())
}

/// Ставит/снимает флаг неприкосновенности. Вызывается только из кода
/// развёртывания (владелец) — через панель флаг не меняется никогда.
pub async fn set_person_protected(pool: &Pool, login: &str, protected: bool) -> Result<()> {
    let client = pool.get().await?;
    client
        .execute(
            "UPDATE persons SET protected = $2 WHERE login = $1",
            &[&login, &protected],
        )
        .await?;
    Ok(())
}

/// Помечает владельца из переменных окружения защищённым.
/// Пароль, имя и прочее не трогает — только флаг.
async fn ensure_owner_protected(pool: &Pool) -> Result<()> {
    let login = match std::env::var("GID_ADMIN_LOGIN") {
        Ok(v) if !v.trim().is_empty() => crate::accounts::normalize_login(&v),
        _ => return Ok(()),
    };
    if login.is_empty() {
        return Ok(());
    }
    match find_person(pool, &login).await? {
        Some(p) if !p.protected || !p.is_admin || p.role != "admin" => {
            set_person_protected(pool, &login, true).await?;
            // Владелец — всегда полноправный админ: матрицей его не урезать.
            // Активность не трогаем.
            let client = pool.get().await?;
            client
                .execute(
                    "UPDATE persons SET is_admin = true, role = 'admin' WHERE login = $1",
                    &[&login],
                )
                .await?;
            tracing::info!("учётная запись {} помечена владельцем (защищена)", login);
        }
        Some(_) => {}
        None => {
            tracing::warn!(
                "GID_ADMIN_LOGIN={} — такой учётки нет, владелец НЕ защищён. \
                 Заведите учётку с этим логином через панель и перезапустите сервер",
                login
            );
        }
    }
    Ok(())
}

/// Параметры новой учётной записи. Структурой, а не восемью
/// аргументами — иначе clippy ругается на их число.
pub struct NewPerson<'a> {
    pub login: &'a str,
    pub name: &'a str,
    pub password: &'a str,
    pub role: &'a str,
    pub is_admin: bool,
    pub protected: bool,
    pub created_by: &'a str,
}

/// Создаёт учётную запись. Логин нормализуется, пароль хешируется.
pub async fn create_person(pool: &Pool, p: NewPerson<'_>) -> Result<crate::accounts::Person> {
    let login = crate::accounts::normalize_login(p.login);
    let hash = crate::accounts::hash_password(p.password)
        .map_err(|e| anyhow::anyhow!("не удалось посчитать хеш пароля: {}", e))?;

    let client = pool.get().await?;
    client
        .execute(
            "INSERT INTO persons(login, name, password_hash, role, is_admin, active, protected, created_at, created_by) \
             VALUES($1,$2,$3,$4,$5,true,$6,$7,$8)",
            &[&login, &p.name, &hash, &p.role, &p.is_admin, &p.protected, &now_ms(), &p.created_by],
        )
        .await?;

    tracing::info!("создана учётная запись {} ({})", login, p.role);

    Ok(crate::accounts::Person {
        login,
        name: p.name.to_string(),
        password_hash: hash,
        role: p.role.to_string(),
        is_admin: p.is_admin,
        active: true,
        protected: p.protected,
        created_at: now_ms(),
        created_by: p.created_by.to_string(),
    })
}

pub async fn find_person(pool: &Pool, login: &str) -> Result<Option<crate::accounts::Person>> {
    let client = pool.get().await?;
    let rows = client
        .query(
            "SELECT login, name, password_hash, role, is_admin, active, protected, created_at, created_by \
             FROM persons WHERE login = $1",
            &[&login],
        )
        .await?;

    Ok(rows.first().map(person_from_row))
}

pub async fn list_persons(pool: &Pool) -> Result<Vec<crate::accounts::Person>> {
    let client = pool.get().await?;
    let rows = client
        .query(
            "SELECT login, name, password_hash, role, is_admin, active, protected, created_at, created_by \
             FROM persons ORDER BY is_admin DESC, name",
            &[],
        )
        .await?;
    Ok(rows.iter().map(person_from_row).collect())
}

fn person_from_row(r: &Row) -> crate::accounts::Person {
    crate::accounts::Person {
        login: r.get("login"),
        name: r.get("name"),
        password_hash: r.get("password_hash"),
        role: r.get("role"),
        is_admin: r.get("is_admin"),
        active: r.get("active"),
        protected: r.get("protected"),
        created_at: r.get("created_at"),
        created_by: r.get("created_by"),
    }
}

/// Меняет пароль. Хеш пересчитывается, открытой строки в базе не остаётся.
pub async fn set_person_password(pool: &Pool, login: &str, password: &str) -> Result<()> {
    let hash = crate::accounts::hash_password(password)
        .map_err(|e| anyhow::anyhow!("не удалось посчитать хеш пароля: {}", e))?;
    let client = pool.get().await?;
    client
        .execute(
            "UPDATE persons SET password_hash = $2 WHERE login = $1",
            &[&login, &hash],
        )
        .await?;
    Ok(())
}

/// Изменение ФИО, активности и роли (роль админа здесь не трогаем).
pub async fn patch_person(
    pool: &Pool,
    login: &str,
    name: Option<&str>,
    role: Option<&str>,
    active: Option<bool>,
) -> Result<()> {
    // Фиксированный запрос с COALESCE — обновляется только переданное.
    let client = pool.get().await?;
    client
        .execute(
            "UPDATE persons SET \
               name   = COALESCE($2, name), \
               role   = COALESCE($3, role), \
               active = COALESCE($4, active) \
             WHERE login = $1",
            &[&login, &name, &role, &active],
        )
        .await?;
    Ok(())
}

/// Число активных администраторов — нужно, чтобы не остаться без прав.
/// Считаются и владельцы (is_admin), и назначенные (role = 'admin').
pub async fn count_active_admins(pool: &Pool) -> Result<i64> {
    let client = pool.get().await?;
    let rows = client
        .query(
            "SELECT COUNT(*)::bigint AS c FROM persons \
             WHERE (is_admin = true OR role = 'admin') AND active = true",
            &[],
        )
        .await?;
    Ok(rows.first().map(|r| r.get::<_, i64>("c")).unwrap_or(0))
}

pub async fn count_persons(pool: &Pool) -> Result<i64> {
    let client = pool.get().await?;
    let rows = client
        .query("SELECT COUNT(*)::bigint AS c FROM persons", &[])
        .await?;
    Ok(rows.first().map(|r| r.get::<_, i64>("c")).unwrap_or(0))
}

/// Удаляет учётную запись вместе с её сеансами.
pub async fn delete_person(pool: &Pool, login: &str) -> Result<()> {
    let client = pool.get().await?;
    client
        .execute("DELETE FROM users WHERE person_login = $1", &[&login])
        .await?;
    client
        .execute("DELETE FROM persons WHERE login = $1", &[&login])
        .await?;
    Ok(())
}

/// Убирает записи сессий, созданные старой системой, где роль мог
/// проставить себе клиент. Их person_login пуст — значит это не наши сеансы.
/// Без чистки 14 записей с ролью admin превратились бы в настоящих админов.
pub async fn purge_legacy_users(pool: &Pool) -> Result<u64> {
    let client = pool.get().await?;
    let deleted = client
        .execute("DELETE FROM users WHERE person_login = ''", &[])
        .await?;
    Ok(deleted)
}

// ================= МАТРИЦА ПРАВ =================

/// Читает матрицу из базы. Пустые роли добиваются значениями
/// по умолчанию уже в кеше (permissions::init_role_caps).
pub async fn load_role_caps(pool: &Pool) -> Result<std::collections::HashMap<String, Vec<String>>> {
    let client = pool.get().await?;
    let rows = client.query("SELECT role, caps FROM role_caps", &[]).await?;
    let mut map = std::collections::HashMap::new();
    for r in rows {
        map.insert(r.get::<_, String>("role"), r.get::<_, Vec<String>>("caps"));
    }
    Ok(map)
}

/// Сохраняет права роли. Неизвестные действия отбрасываются,
/// у роли admin право users.manage_roles снять нельзя.
pub async fn set_role_caps(pool: &Pool, role: &str, caps: &[String]) -> Result<()> {
    let clean: Vec<String> = caps
        .iter()
        .filter(|a| crate::permissions::is_known_action(a))
        .cloned()
        .collect();
    let client = pool.get().await?;
    client
        .execute(
            "INSERT INTO role_caps(role, caps) VALUES($1,$2) \
             ON CONFLICT(role) DO UPDATE SET caps = EXCLUDED.caps",
            &[&role, &clean],
        )
        .await?;
    Ok(())
}

/// Заливает значения по умолчанию для ролей, которых ещё нет в таблице.
/// Существующие настройки не трогает.
pub async fn seed_role_caps(pool: &Pool) -> Result<()> {
    let client = pool.get().await?;
    for (role, caps) in crate::permissions::default_caps_map() {
        client
            .execute(
                "INSERT INTO role_caps(role, caps) VALUES($1,$2) ON CONFLICT(role) DO NOTHING",
                &[&role, &caps],
            )
            .await?;
    }
    Ok(())
}

// ================= ЧТЕНИЕ СОСТОЯНИЯ =================

fn map_stop(r: &Row) -> Stop {
    Stop {
        station_id: r.get("station_id"),
        arr: r.get("arr"),
        dep: r.get("dep"),
        path: r.get("path"),
    }
}

pub async fn load_state(pool: &Pool) -> Result<GidState> {
    let client = pool.get().await?;

    let (stations, trains, marks, stops) = tokio::try_join!(
        client.query(
            "SELECT id, name, km, paths, code FROM stations ORDER BY ord, km",
            &[]
        ),
        client.query(
            "SELECT id, number, category, loco_series, loco_num, driver, weight, length, \
             cargo, naturka, idx, note FROM trains",
            &[]
        ),
        client.query(
            "SELECT id, type, peregon, start, end_time, color, text, service FROM marks",
            &[]
        ),
        client.query(
            "SELECT train_id, station_id, arr, dep, path FROM train_stops ORDER BY ord",
            &[]
        ),
    )?;

    // Остановки группируем поездам, сохраняя порядок из БД.
    let mut by_train: std::collections::HashMap<String, Vec<Stop>> =
        std::collections::HashMap::new();
    for r in &stops {
        by_train
            .entry(r.get::<_, String>("train_id"))
            .or_default()
            .push(map_stop(r));
    }

    let stations: Vec<Station> = stations
        .iter()
        .map(|r| Station {
            id: r.get("id"),
            name: r.get("name"),
            km: r.get("km"),
            paths: r.get("paths"),
            code: r.get("code"),
        })
        .collect();

    let trains: Vec<Train> = trains
        .iter()
        .map(|r| Train {
            id: r.get("id"),
            number: r.get("number"),
            category: r.get("category"),
            loco_series: r.get("loco_series"),
            loco_num: r.get("loco_num"),
            driver: r.get("driver"),
            weight: r.get("weight"),
            length: r.get("length"),
            cargo: r.get("cargo"),
            naturka: r.get("naturka"),
            index: r.get("idx"),
            note: r.get("note"),
            stops: by_train
                .get(&r.get::<_, String>("id"))
                .cloned()
                .unwrap_or_default(),
        })
        .collect();

    let marks: Vec<Mark> = marks
        .iter()
        .map(|r| Mark {
            id: r.get("id"),
            kind: r.get("type"),
            peregon: r.get("peregon"),
            start: r.get("start"),
            end_time: r.get("end_time"),
            color: r.get("color"),
            text: r.get("text"),
            service: r.get("service"),
        })
        .collect();

    Ok(GidState {
        stations,
        trains,
        marks,
    })
}

// ================= ЗАПИСЬ СОСТОЯНИЯ =================

/// Полная перезапись данных графа в одной транзакции.
pub async fn save_state(pool: &Pool, state: &GidState) -> Result<()> {
    let mut client = pool.get().await?;
    let tx = client.transaction().await?;

    // Порядок важен: stations чистим последним, иначе срежет внешние ключи.
    tx.execute("DELETE FROM train_stops", &[]).await?;
    tx.execute("DELETE FROM trains", &[]).await?;
    tx.execute("DELETE FROM stations", &[]).await?;
    tx.execute("DELETE FROM marks", &[]).await?;

    for (i, s) in state.stations.iter().enumerate() {
        tx.execute(
            "INSERT INTO stations(id, name, km, paths, code, ord) VALUES($1,$2,$3,$4,$5,$6)",
            &[&s.id, &s.name, &s.km, &s.paths, &s.code, &(i as i32)],
        )
        .await?;
    }

    for t in &state.trains {
        tx.execute(
            "INSERT INTO trains(id, number, category, loco_series, loco_num, driver, weight, \
             length, cargo, naturka, idx, note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
            &[
                &t.id,
                &t.number,
                &t.category,
                &t.loco_series,
                &t.loco_num,
                &t.driver,
                &t.weight,
                &t.length,
                &t.cargo,
                &t.naturka,
                &t.index,
                &t.note,
            ],
        )
        .await?;

        for (i, sp) in t.stops.iter().enumerate() {
            tx.execute(
                "INSERT INTO train_stops(id, train_id, station_id, arr, dep, path, ord) \
                 VALUES($1,$2,$3,$4,$5,$6,$7)",
                &[
                    &format!("{}_s{}", t.id, i),
                    &t.id,
                    &sp.station_id,
                    &sp.arr,
                    &sp.dep,
                    &sp.path,
                    &(i as i32),
                ],
            )
            .await?;
        }
    }

    for m in &state.marks {
        tx.execute(
            "INSERT INTO marks(id, type, peregon, start, end_time, color, text, service) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            &[
                &m.id,
                &m.kind,
                &m.peregon,
                &m.start,
                &m.end_time,
                &m.color,
                &m.text,
                &m.service,
            ],
        )
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

// ================= ПОЛЬЗОВАТЕЛИ =================

pub async fn upsert_user_login(pool: &Pool, u: &UserMeta) -> Result<()> {
    let client = pool.get().await?;
    client
        .execute(
            "INSERT INTO users(session, name, role, area, on_duty, duty_time, is_admin) \
             VALUES($1,$2,$3,$4,$5,$6,$7) \
             ON CONFLICT(session) DO UPDATE SET \
               name = EXCLUDED.name, role = EXCLUDED.role, area = EXCLUDED.area",
            // is_admin намеренно не входит в DO UPDATE: признак входа под
            // паролем администратора ставится только сервером после сверки.
            &[
                &u.session,
                &u.name,
                &u.role,
                &u.area,
                &u.on_duty,
                &u.duty_time,
                &u.is_admin,
            ],
        )
        .await?;
    Ok(())
}

pub async fn patch_user(pool: &Db, session: &str, patch: &crate::models::UserPatch) -> Result<()> {
    if patch.is_empty() {
        return Ok(());
    }

    // Фиксированный запрос с COALESCE: обновляются только переданные поля,
    // остальные сохраняются. Динамическая сборка SET не нужна — нет риска инъекций.
    let client = pool.get().await?;
    client
        .execute(
            "UPDATE users SET \
               name      = COALESCE($2, name), \
               role      = COALESCE($3, role), \
               area      = COALESCE($4, area), \
               on_duty   = COALESCE($5, on_duty), \
               duty_time = COALESCE($6, duty_time) \
             WHERE session = $1",
            &[
                &session,
                &patch.name,
                &patch.role,
                &patch.area,
                &patch.on_duty,
                &patch.duty_time,
            ],
        )
        .await?;
    Ok(())
}

pub async fn delete_user(pool: &Pool, session: &str) -> Result<()> {
    let client = pool.get().await?;
    client
        .execute("DELETE FROM users WHERE session = $1", &[&session])
        .await?;
    Ok(())
}

pub async fn release_duty(pool: &Pool, session: &str) -> Result<()> {
    let client = pool.get().await?;
    client
        .execute(
            "UPDATE users SET on_duty = false, duty_time = '' WHERE session = $1",
            &[&session],
        )
        .await?;
    Ok(())
}

pub async fn load_users_meta(pool: &Pool) -> Result<std::collections::HashMap<String, UserMeta>> {
    let client = pool.get().await?;
    let rows = client
        .query(
            "SELECT session, name, role, area, on_duty, duty_time, is_admin, person_login FROM users",
            &[],
        )
        .await?;

    let mut map = std::collections::HashMap::new();
    for r in rows {
        map.insert(
            r.get::<_, String>("session"),
            UserMeta {
                session: r.get("session"),
                name: r.get("name"),
                role: r.get("role"),
                area: r.get("area"),
                on_duty: r.get("on_duty"),
                duty_time: r.get("duty_time"),
                is_admin: r.get("is_admin"),
                person_login: r.get("person_login"),
            },
        );
    }
    Ok(map)
}

// ================= ТРЕВОГИ =================

pub async fn load_alerts(pool: &Pool) -> Result<Vec<Alert>> {
    let client = pool.get().await?;
    let rows = client
        .query(
            "SELECT id, type, title, text, \"full\", author, created_at, active \
             FROM alerts ORDER BY created_at DESC",
            &[],
        )
        .await?;
    Ok(rows
        .iter()
        .map(|r| Alert {
            id: r.get("id"),
            kind: r.get("type"),
            title: r.get("title"),
            text: r.get("text"),
            full: r.get("full"),
            author: r.get("author"),
            created_at: r.get("created_at"),
            active: r.get("active"),
        })
        .collect())
}

pub async fn add_alert(pool: &Pool, a: &Alert) -> Result<()> {
    let client = pool.get().await?;
    client
        .execute(
            "INSERT INTO alerts(id, type, title, text, \"full\", author, created_at, active) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            &[
                &a.id,
                &a.kind,
                &a.title,
                &a.text,
                &a.full,
                &a.author,
                &a.created_at,
                &a.active,
            ],
        )
        .await?;
    Ok(())
}

/// Полное редактирование оповещения из панели администратора.
/// Автор и время создания не меняются.
pub async fn update_alert(pool: &Pool, a: &Alert) -> Result<u64> {
    let client = pool.get().await?;
    let n = client
        .execute(
            "UPDATE alerts SET type = $2, title = $3, text = $4, \"full\" = $5 WHERE id = $1",
            &[&a.id, &a.kind, &a.title, &a.text, &a.full],
        )
        .await?;
    Ok(n)
}

pub async fn toggle_alert(pool: &Pool, id: &str) -> Result<()> {
    let client = pool.get().await?;
    client
        .execute("UPDATE alerts SET active = NOT active WHERE id=$1", &[&id])
        .await?;
    Ok(())
}

pub async fn remove_alert(pool: &Pool, id: &str) -> Result<()> {
    let client = pool.get().await?;
    client
        .execute("DELETE FROM alerts WHERE id=$1", &[&id])
        .await?;
    Ok(())
}

// ================= АУДИТ =================

pub async fn add_audit(pool: &Pool, draft: &AuditDraft) -> Result<String> {
    let id = format!(
        "audit_{}_{}",
        now_ms(),
        &uuid::Uuid::new_v4().to_string()[..8]
    );
    let client = pool.get().await?;
    client
        .execute(
            "INSERT INTO audit_log(id, ts, actor, action, target, detail) VALUES($1,$2,$3,$4,$5,$6)",
            &[
                &id,
                &now_ms(),
                &draft.actor,
                &draft.action,
                &draft.target,
                &draft.detail,
            ],
        )
        .await?;
    Ok(id)
}

pub async fn load_audit(pool: &Pool) -> Result<Vec<AuditEntry>> {
    let client = pool.get().await?;
    let rows = client
        .query(
            "SELECT id, ts, actor, action, target, detail FROM audit_log ORDER BY ts DESC LIMIT 200",
            &[],
        )
        .await?;
    Ok(rows
        .iter()
        .map(|r| AuditEntry {
            id: r.get("id"),
            ts: r.get("ts"),
            actor: r.get("actor"),
            action: r.get("action"),
            target: r.get("target"),
            detail: r.get("detail"),
        })
        .collect())
}

// ================= ПРОЧЕЕ =================

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Заполняет БД демонстрационными данными, если станций ещё нет.
pub async fn seed_if_empty(pool: &Pool) -> Result<bool> {
    let client = pool.get().await?;
    let rows = client
        .query("SELECT COUNT(*)::int AS c FROM stations", &[])
        .await?;
    let count: i32 = rows[0].get("c");
    if count > 0 {
        return Ok(false);
    }
    drop(client);

    let stations = vec![
        Station {
            id: "s1".into(),
            name: "Горький-Моск".into(),
            km: 0.0,
            paths: 8,
            code: "26000".into(),
        },
        Station {
            id: "s2".into(),
            name: "Кр. Узел".into(),
            km: 15.0,
            paths: 4,
            code: "26010".into(),
        },
        Station {
            id: "s3".into(),
            name: "Дзержинск".into(),
            km: 24.0,
            paths: 6,
            code: "26020".into(),
        },
        Station {
            id: "s4".into(),
            name: "Игумново".into(),
            km: 32.0,
            paths: 2,
            code: "26030".into(),
        },
        Station {
            id: "s5".into(),
            name: "Сейма".into(),
            km: 45.0,
            paths: 3,
            code: "26040".into(),
        },
        Station {
            id: "s6".into(),
            name: "Вязьма".into(),
            km: 58.0,
            paths: 4,
            code: "26050".into(),
        },
        Station {
            id: "s7".into(),
            name: "Петушки".into(),
            km: 72.0,
            paths: 3,
            code: "26060".into(),
        },
        Station {
            id: "s8".into(),
            name: "Орехово".into(),
            km: 85.0,
            paths: 2,
            code: "26070".into(),
        },
        Station {
            id: "s9".into(),
            name: "Москва-Кур".into(),
            km: 105.0,
            paths: 10,
            code: "27000".into(),
        },
    ];

    let trains = vec![
        Train {
            id: "t1".into(),
            number: "284А".into(),
            category: "passenger".into(),
            loco_series: Some("ЧС7".into()),
            loco_num: Some("210".into()),
            driver: Some("Петров П.П.".into()),
            weight: Some("950".into()),
            length: Some("18".into()),
            cargo: Some("пассаж".into()),
            naturka: Some("1112221".into()),
            index: Some("2600-1111-1".into()),
            note: Some(String::new()),
            stops: vec![
                Stop {
                    station_id: "s1".into(),
                    arr: Some("08:00".into()),
                    dep: Some("08:05".into()),
                    path: 1,
                },
                Stop {
                    station_id: "s3".into(),
                    arr: Some("08:25".into()),
                    dep: Some("08:27".into()),
                    path: 2,
                },
                Stop {
                    station_id: "s5".into(),
                    arr: Some("08:45".into()),
                    dep: Some("08:47".into()),
                    path: 1,
                },
                Stop {
                    station_id: "s9".into(),
                    arr: Some("09:40".into()),
                    dep: None,
                    path: 3,
                },
            ],
        },
        Train {
            id: "t2".into(),
            number: "3401".into(),
            category: "freight".into(),
            loco_series: Some("ВЛ10".into()),
            loco_num: Some("1234".into()),
            driver: Some("Иванов И.И.".into()),
            weight: Some("4500".into()),
            length: Some("71".into()),
            cargo: Some("уголь".into()),
            naturka: Some("3334441".into()),
            index: Some("2600-2222-3".into()),
            note: Some("Тяжеловес".into()),
            stops: vec![
                Stop {
                    station_id: "s1".into(),
                    arr: None,
                    dep: Some("09:00".into()),
                    path: 4,
                },
                Stop {
                    station_id: "s3".into(),
                    arr: Some("09:30".into()),
                    dep: Some("09:40".into()),
                    path: 3,
                },
                Stop {
                    station_id: "s6".into(),
                    arr: Some("10:15".into()),
                    dep: Some("10:25".into()),
                    path: 2,
                },
                Stop {
                    station_id: "s9".into(),
                    arr: Some("11:00".into()),
                    dep: None,
                    path: 5,
                },
            ],
        },
    ];

    save_state(
        pool,
        &GidState {
            stations,
            trains,
            marks: vec![],
        },
    )
    .await?;
    Ok(true)
}

// Подавляем предупреждение о неиспользуемом Arc при текущих фичах.
