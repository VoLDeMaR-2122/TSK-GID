// 1. ЗАГРУЖАЕМ ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ ИЗ ФАЙЛА .env ИЛИ .env.local
import { config } from "dotenv";
config({ path: ".env.local" });

import http from "http";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { Pool } from "pg";

// ================= КОНФИГУРАЦИЯ =================
const DEV = process.env.NODE_ENV !== "production";
const PORT = Number(process.env.PORT || 3000);
const HOSTNAME = "0.0.0.0";

const PG_USER = process.env.POSTGRES_USER || "gid";
const PG_PASS = process.env.POSTGRES_PASSWORD || "gidpass";
const PG_DB = process.env.POSTGRES_DB || "gid";
const PG_HOST = process.env.DB_HOST || "localhost";
const PG_PORT = process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432;

const DATABASE_URL = process.env.DATABASE_URL ||
  `postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${PG_DB}`;

console.log(`[CONFIG] App will listen on ${HOSTNAME}:${PORT}`);
console.log(`[CONFIG] DB Target: ${PG_HOST}:${PG_PORT} (User: ${PG_USER}, DB: ${PG_DB})`);

const ALLOWED_ORIGINS = (process.env.GID_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const pool = new Pool({ connectionString: DATABASE_URL });

// ================= ТИПЫ ДАННЫХ =================
type UserMeta = {
  session: string;
  name: string;
  role: string;
  area: string;
  onDuty: boolean;
  dutyTime: string;
};

type Station = { id: string; name: string; km: number; paths: number; code: string };
type Stop = { stationId: string; arr: string | null; dep: string | null; path: number };
type Train = {
  id: string; number: string; category: string;
  locoSeries?: string; locoNum?: string; driver?: string; weight?: string; length?: string;
  cargo?: string; naturka?: string; index?: string; note?: string; stops: Stop[];
};
type Mark = {
  id: string; type: string; peregon: number; start: string; end: string;
  color: string; text?: string; service?: string;
};
type Alert = {
  id: string; type: string; text: string; author: string; createdAt: number; active: boolean;
};

// Интерфейсы для строк из Postgres (snake_case)
interface DbStationRow { id: string; name: string; km: number; paths: number; code: string }
interface DbTrainRow {
  id: string; number: string; category: string;
  loco_series: string | null; loco_num: string | null; driver: string | null;
  weight: string | null; length: string | null; cargo: string | null;
  naturka: string | null; idx: string | null; note: string | null;
}
interface DbStopRow { train_id: string; station_id: string; arr: string | null; dep: string | null; path: number }
interface DbMarkRow { id: string; type: string; peregon: number; start: string; end_time: string; color: string; text: string | null; service: string | null }
interface DbAlertRow { id: string; type: string; text: string; author: string; created_at: string | number; active: boolean }
interface DbUserRow { session: string; name: string; role: string; area: string; on_duty: boolean; duty_time: string }

// ================= СХЕМА БД =================
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  session   TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'dsp',
  area      TEXT NOT NULL DEFAULT '',
  on_duty   BOOLEAN NOT NULL DEFAULT false,
  duty_time TEXT NOT NULL DEFAULT ''
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
  text TEXT NOT NULL,
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
`;

// ================= УТИЛИТЫ ДЛЯ БД =================

async function waitForDb(retries = 20, delayMs = 2000): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      console.log("[DB] Connection established successfully.");
      return;
    } catch (err: any) {
      console.warn(`[DB] Attempt ${i + 1}/${retries} failed: ${err.message}. Retrying in ${delayMs}ms...`);
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

async function loadState() {
  // 1. Выполняем параллельные запросы к БД
  const [stationsRes, trainsRes, marksRes, stopsRes] = await Promise.all([
    pool.query<DbStationRow>("SELECT id, name, km, paths, code FROM stations ORDER BY ord, km"),
    pool.query<DbTrainRow>("SELECT id, number, category, loco_series, loco_num, driver, weight, length, cargo, naturka, idx, note FROM trains"),
    pool.query<DbMarkRow>("SELECT id, type, peregon, start, end_time, color, text, service FROM marks"),
    pool.query<DbStopRow>("SELECT train_id, station_id, arr, dep, path FROM train_stops ORDER BY ord"),
  ]);

  // 2. Группируем остановки по поездам
  const stopsByTrain = new Map<string, Stop[]>();
  for (const r of stopsRes.rows) {
    if (!stopsByTrain.has(r.train_id)) stopsByTrain.set(r.train_id, []);
    stopsByTrain.get(r.train_id)!.push({
      stationId: r.station_id,
      arr: r.arr,
      dep: r.dep,
      path: r.path,
    });
  }

  // 3. Маппим станции
  const stations: Station[] = stationsRes.rows.map(r => ({
    id: r.id,
    name: r.name,
    km: r.km,
    paths: r.paths,
    code: r.code
  }));

  // 4. Маппим поезда
  const trains: Train[] = trainsRes.rows.map(r => ({
    id: r.id,
    number: r.number,
    category: r.category,
    locoSeries: r.loco_series ?? undefined,
    locoNum: r.loco_num ?? undefined,
    driver: r.driver ?? undefined,
    weight: r.weight ?? undefined,
    length: r.length ?? undefined,
    cargo: r.cargo ?? undefined,
    naturka: r.naturka ?? undefined,
    index: r.idx ?? undefined,
    note: r.note ?? undefined,
    stops: stopsByTrain.get(r.id) || [],
  }));

  // 5. Маппим пометки (ИСПРАВЛЕНО: используем r.end_time из SQL)
  const marks: Mark[] = marksRes.rows.map(r => ({
    id: r.id,
    type: r.type,
    peregon: r.peregon,
    start: r.start,
    end: r.end_time, // <-- Правильное маппинг поля из БД в модель TS
    color: r.color,
    text: r.text ?? undefined,
    service: r.service ?? undefined,
  }));

  return { stations, trains, marks };
}

async function loadAlerts(): Promise<Alert[]> {
  const res = await pool.query<DbAlertRow>("SELECT * FROM alerts ORDER BY created_at DESC");
  return res.rows.map(r => ({
    id: r.id, type: r.type, text: r.text, author: r.author,
    createdAt: Number(r.created_at), active: r.active
  }));
}

async function loadUsersMeta(): Promise<Map<string, UserMeta>> {
  const res = await pool.query<DbUserRow>("SELECT * FROM users");
  const map = new Map<string, UserMeta>();
  for (const r of res.rows) {
    map.set(r.session, {
      session: r.session, name: r.name, role: r.role, area: r.area,
      onDuty: r.on_duty, dutyTime: r.duty_time
    });
  }
  return map;
}

async function saveState(payload: { stations: Station[]; trains: Train[]; marks: Mark[] }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Очищаем таблицы данных (но не users/alerts)
    await client.query("DELETE FROM train_stops");
    await client.query("DELETE FROM trains");
    await client.query("DELETE FROM stations");
    await client.query("DELETE FROM marks");

    // Сохраняем станции
    for (const [i, s] of payload.stations.entries()) {
      await client.query(
        "INSERT INTO stations(id, name, km, paths, code, ord) VALUES($1,$2,$3,$4,$5,$6)",
        [s.id, s.name, s.km, s.paths, s.code, i]
      );
    }

    // Сохраняем поезда и остановки
    for (const t of payload.trains) {
      await client.query(
        `INSERT INTO trains(id, number, category, loco_series, loco_num, driver, weight, length, cargo, naturka, idx, note)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [t.id, t.number, t.category, t.locoSeries ?? null, t.locoNum ?? null, t.driver ?? null,
         t.weight ?? null, t.length ?? null, t.cargo ?? null, t.naturka ?? null, t.index ?? null, t.note ?? null]
      );

      for (const [i, sp] of t.stops.entries()) {
        await client.query(
          "INSERT INTO train_stops(id, train_id, station_id, arr, dep, path, ord) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [`${t.id}_s${i}`, t.id, sp.stationId, sp.arr ?? null, sp.dep ?? null, sp.path, i]
        );
      }
    }

    // Сохраняем пометки
    for (const m of payload.marks) {
      await client.query(
        "INSERT INTO marks(id, type, peregon, start, end_time, color, text, service) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [m.id, m.type, m.peregon, m.start, m.end, m.color, m.text ?? null, m.service ?? null]
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function upsertUserLogin(u: UserMeta) {
  await pool.query(
    `INSERT INTO users(session, name, role, area, on_duty, duty_time)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(session) DO UPDATE SET
       name = EXCLUDED.name,
       role = EXCLUDED.role,
       area = EXCLUDED.area`,
    [u.session, u.name, u.role, u.area, u.onDuty, u.dutyTime]
  );
}

const USER_COL_MAP: Record<string, string> = {
  name: "name", role: "role", area: "area", onDuty: "on_duty", dutyTime: "duty_time"
};

async function patchUser(session: string, patch: Partial<UserMeta>) {
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const key of Object.keys(patch) as (keyof UserMeta)[]) {
    const col = USER_COL_MAP[key];
    if (!col) continue;
    sets.push(`${col}=$${idx++}`);
    values.push(patch[key]);
  }

  if (!sets.length) return;
  values.push(session);

  await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE session=$${idx}`, values);
}

async function addAlert(a: Alert) {
  await pool.query(
    "INSERT INTO alerts(id, type, text, author, created_at, active) VALUES($1,$2,$3,$4,$5,$6)",
    [a.id, a.type, a.text, a.author, a.createdAt, a.active]
  );
}

async function toggleAlert(id: string) {
  await pool.query("UPDATE alerts SET active = NOT active WHERE id=$1", [id]);
}

async function removeAlert(id: string) {
  await pool.query("DELETE FROM alerts WHERE id=$1", [id]);
}

// ================= АУДИТ =================
type AuditEntry = {
  id: string;
  ts: number;
  actor: string;
  action: string;
  target?: string;
  detail?: string;
};

async function addAuditEntry(entry: Omit<AuditEntry, "id" | "ts">) {
  const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await pool.query(
    "INSERT INTO audit_log(id, ts, actor, action, target, detail) VALUES($1,$2,$3,$4,$5,$6)",
    [id, Date.now(), entry.actor, entry.action, entry.target ?? null, entry.detail ?? null]
  );
}

async function loadAuditLog(): Promise<AuditEntry[]> {
  const res = await pool.query(
    "SELECT id, ts, actor, action, target, detail FROM audit_log ORDER BY ts DESC LIMIT 200"
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    ts: Number(r.ts),
    actor: r.actor,
    action: r.action,
    target: r.target ?? undefined,
    detail: r.detail ?? undefined,
  }));
}

async function seedIfEmpty() {
  const res = await pool.query<{ c: number }>("SELECT COUNT(*)::int AS c FROM stations");
  if ((res.rows[0]?.c || 0) > 0) return;

  console.log("🌱 Seeding initial data...");

  const stations: Station[] = [
    { id: "s1", name: "Горький-Моск", km: 0, paths: 8, code: "26000" },
    { id: "s2", name: "Кр. Узел", km: 15, paths: 4, code: "26010" },
    { id: "s3", name: "Дзержинск", km: 24, paths: 6, code: "26020" },
    { id: "s4", name: "Игумново", km: 32, paths: 2, code: "26030" },
    { id: "s5", name: "Сейма", km: 45, paths: 3, code: "26040" },
    { id: "s6", name: "Вязьма", km: 58, paths: 4, code: "26050" },
    { id: "s7", name: "Петушки", km: 72, paths: 3, code: "26060" },
    { id: "s8", name: "Орехово", km: 85, paths: 2, code: "26070" },
    { id: "s9", name: "Москва-Кур", km: 105, paths: 10, code: "27000" },
  ];

  const trains: Train[] = [
    {
      id: "t1", number: "284А", category: "passenger",
      locoSeries: "ЧС7", locoNum: "210", driver: "Петров П.П.",
      weight: "950", length: "18", cargo: "пассаж", naturka: "1112221", index: "2600-1111-1", note: "",
      stops: [
        { stationId: "s1", arr: "08:00", dep: "08:05", path: 1 },
        { stationId: "s3", arr: "08:25", dep: "08:27", path: 2 },
        { stationId: "s5", arr: "08:45", dep: "08:47", path: 1 },
        { stationId: "s9", arr: "09:40", dep: null, path: 3 },
      ]
    },
    {
      id: "t2", number: "3401", category: "freight",
      locoSeries: "ВЛ10", locoNum: "1234", driver: "Иванов И.И.",
      weight: "4500", length: "71", cargo: "уголь", naturka: "3334441", index: "2600-2222-3", note: "Тяжеловес",
      stops: [
        { stationId: "s1", arr: null, dep: "09:00", path: 4 },
        { stationId: "s3", arr: "09:30", dep: "09:40", path: 3 },
        { stationId: "s6", arr: "10:15", dep: "10:25", path: 2 },
        { stationId: "s9", arr: "11:00", dep: null, path: 5 },
      ]
    },
  ];

  await saveState({ stations, trains, marks: [] });
  console.log("✅ Seed completed.");
}

// ================= WEBSOCKET SERVER =================
const wss = new WebSocketServer({ noServer: true });
const liveSockets = new Map<string, WebSocket>();
const userCache = new Map<string, UserMeta>();

function sendTo(sock: WebSocket | undefined, msg: object) {
  if (sock && sock.readyState === WebSocket.OPEN) {
    sock.send(JSON.stringify(msg));
  }
}

function broadcast(msg: object) {
  const data = JSON.stringify(msg);
  for (const sock of liveSockets.values()) {
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(data);
    }
  }
}

async function getPresenceList(): Promise<UserMeta[]> {
  const users: UserMeta[] = [];
  for (const session of liveSockets.keys()) {
    const u = userCache.get(session);
    if (u) users.push(u);
  }
  return users;
}

async function broadcastPresence() {
  broadcast({ kind: "presence", users: await getPresenceList() });
}

async function broadcastAudit() {
  broadcast({ kind: "audit", audit: await loadAuditLog() });
}

async function broadcastState() {
  broadcast({ kind: "state", state: await loadState() });
}

async function broadcastAlerts() {
  broadcast({ kind: "alerts", alerts: await loadAlerts() });
}

wss.on("connection", async (socket, req) => {
  const url = new URL(req.url || "/", "http://localhost");
  let currentSession = url.searchParams.get("session") || `anon-${Math.random().toString(36).slice(2)}`;

  sendTo(socket, { kind: "hello", clientId: currentSession });

  try {
    const initialState = await loadState();
    const initialAlerts = await loadAlerts();
    const initialPresence = await getPresenceList();
    const initialAudit = await loadAuditLog();

    sendTo(socket, { kind: "state", state: initialState });
    sendTo(socket, { kind: "alerts", alerts: initialAlerts });
    sendTo(socket, { kind: "presence", users: initialPresence });
    sendTo(socket, { kind: "audit", audit: initialAudit });
  } catch (e) {
    console.error("Error sending initial payload:", e);
  }

  socket.on("message", async (data) => {
    let msg: any;
    try {
      msg = JSON.parse(String(data));
    } catch { return; }

    try {
      switch (msg.kind) {
        case "login": {
          const u: UserMeta = {
            session: String(msg.user.session),
            name: String(msg.user.name),
            role: String(msg.user.role),
            area: String(msg.user.area || ""),
            onDuty: Boolean(msg.user.onDuty),
            dutyTime: String(msg.user.dutyTime || "")
          };

          if (!u.session) return;

          currentSession = u.session;
          liveSockets.set(u.session, socket);
          userCache.set(u.session, u);

          await upsertUserLogin(u);
          await addAuditEntry({ actor: u.name, action: "login", detail: `Роль: ${u.role}` });
          await broadcastAudit();

          const freshMap = await loadUsersMeta();
          const freshUser = freshMap.get(u.session);
          if (freshUser) userCache.set(u.session, freshUser);

          await broadcastPresence();
          break;
        }

        case "logout": {
          if (liveSockets.get(currentSession) === socket) {
            liveSockets.delete(currentSession);
          }
          const u = userCache.get(currentSession);
          if (u) await addAuditEntry({ actor: u.name, action: "logout" });
          await broadcastAudit();
          await broadcastPresence();
          break;
        }

        case "userPatch": {
          const targetSession = String(msg.session || "");
          if (!targetSession) return;

          const actor = userCache.get(currentSession)?.name ?? "system";
          const target = userCache.get(targetSession)?.name ?? targetSession;
          await patchUser(targetSession, msg.patch as Partial<UserMeta>);
          await addAuditEntry({ actor, action: "userPatch", target, detail: JSON.stringify(msg.patch) });
          await broadcastAudit();

          const freshMap = await loadUsersMeta();
          const freshUser = freshMap.get(targetSession);
          if (freshUser) userCache.set(targetSession, freshUser);

          await broadcastPresence();
          break;
        }

        case "kick": {
          const targetSession = String(msg.session || "");
          if (!targetSession) return;

          const actor = userCache.get(currentSession)?.name ?? "system";
          const target = userCache.get(targetSession)?.name ?? targetSession;

          // Закрываем соединение пользователя, если он онлайн
          const targetSocket = liveSockets.get(targetSession);
          if (targetSocket) {
            targetSocket.close();
          }

          // Удаляем из кэша и БД
          liveSockets.delete(targetSession);
          userCache.delete(targetSession);
          await pool.query("DELETE FROM users WHERE session = $1", [targetSession]);
          await addAuditEntry({ actor, action: "kick", target });
          await broadcastAudit();

          await broadcastPresence();
          break;
        }

        case "state": {
          const actor = userCache.get(currentSession)?.name ?? "system";
          await saveState(msg.state);
          await addAuditEntry({ actor, action: "state_save", detail: `Поездов: ${msg.state?.trains?.length ?? 0}, Станций: ${msg.state?.stations?.length ?? 0}` });
          await broadcastAudit();
          await broadcastState();
          break;
        }

        case "alertAdd": {
          const a: Alert = {
            id: String(msg.alert.id),
            type: String(msg.alert.type),
            text: String(msg.alert.text),
            author: String(msg.alert.author),
            createdAt: Number(msg.alert.createdAt),
            active: msg.alert.active !== false
          };
          await addAlert(a);
          await addAuditEntry({ actor: a.author, action: "alert_add", detail: a.text });
          await broadcastAudit();
          await broadcastAlerts();
          break;
        }

        case "alertToggle": {
          await toggleAlert(String(msg.id));
          const actor = userCache.get(currentSession)?.name ?? "system";
          await addAuditEntry({ actor, action: "alert_toggle", target: String(msg.id) });
          await broadcastAudit();
          await broadcastAlerts();
          break;
        }

        case "alertRemove": {
          await removeAlert(String(msg.id));
          const actor = userCache.get(currentSession)?.name ?? "system";
          await addAuditEntry({ actor, action: "alert_remove", target: String(msg.id) });
          await broadcastAudit();
          await broadcastAlerts();
          break;
        }
      }
    } catch (e) {
      console.error("WS Handler Error:", e);
    }
  });

  socket.on("close", async () => {
    if (liveSockets.get(currentSession) === socket) {
      liveSockets.delete(currentSession);
      userCache.delete(currentSession);

      // Освобождаем слот дежурства, если пользователь был на дежурстве
      try {
        await pool.query(
          "UPDATE users SET on_duty = false, duty_time = '' WHERE session = $1",
          [currentSession]
        );
      } catch (e) {
        console.error("Error releasing duty slot:", e);
      }

      await broadcastPresence();
    }
  });
});

// ================= HTTP SERVER & STARTUP =================
const app = next({ dev: DEV });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  try {
    await waitForDb();
    await pool.query(SCHEMA_SQL);
    await seedIfEmpty();

    const allUsers = await loadUsersMeta();
    for (const [sess, u] of allUsers) {
      userCache.set(sess, u);
    }

    const server = http.createServer((req, res) => {
      handle(req, res);
    });

    server.on("upgrade", (req, socket, head) => {
      const { pathname } = new URL(req.url || "/", "http://localhost");

      if (pathname.startsWith("/_next/")) {
        return;
      }

      if (pathname !== "/ws") {
        socket.destroy();
        return;
      }

      const origin = req.headers.origin;
      if (ALLOWED_ORIGINS.length && origin && !ALLOWED_ORIGINS.includes(origin)) {
        console.warn(`[SECURITY] Rejected WS connection from origin: ${origin}`);
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    });

    server.listen(PORT, HOSTNAME, () => {
      console.log(`\n🚂 ГИД Урал-ВНИИЖТ запущен!`);
      console.log(`   HTTP: http://${HOSTNAME}:${PORT}`);
      console.log(`   WS:   ws://${HOSTNAME}:${PORT}/ws\n`);
    });

  } catch (error) {
    console.error("\n💥 FATAL ERROR DURING STARTUP:", error);
    process.exit(1);
  }
}).catch((err) => {
  console.error("Next.js prepare failed:", err);
  process.exit(1);
});
