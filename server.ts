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
// Пароль берётся только из окружения. Значение по умолчанию было бы
// утечкой: реквизиты доступа лежали бы прямо в репозитории.
const PG_PASS = process.env.POSTGRES_PASSWORD;
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

// Интерфейсы для строк из Postgres (snake_case)
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[DB] Attempt ${i + 1}/${retries} failed: ${msg}. Retrying in ${delayMs}ms...`);
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
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

// ================= WEBSOCKET: ПРОКСИ НА RUST-БЭКЕНД =================
const wss = new WebSocketServer({ noServer: true });
const userCache = new Map<string, UserMeta>();

// ---------- Прокси WebSocket → Rust-бэкенд ----------
// Вся логика и БД — на Rust. Node только отдаёт страницы Next.js
// и проксирует кадры /ws один в один. Своего протокола здесь нет:
// прежний принимал роль от клиента без проверки пароля, поэтому удалён.
function proxyWsToRust(client: WebSocket, url: string) {
  const port = Number(process.env.BACKEND_PORT || 3001);
  const upstream = new WebSocket(`ws://127.0.0.1:${port}${url}`);

  let clientAlive = true;
  let upstreamOpen = false;
  const pending: Array<{ data: WebSocket.RawData; binary: boolean }> = [];

  upstream.on("open", () => {
    upstreamOpen = true;
    for (const f of pending.splice(0)) {
      if (clientAlive && upstream.readyState === WebSocket.OPEN) {
        upstream.send(f.data, { binary: f.binary });
      }
    }
  });

  upstream.on("message", (data, isBinary) => {
    if (clientAlive && client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: !!isBinary });
    }
  });

  const closeBoth = () => {
    if (!clientAlive) return;
    clientAlive = false;
    try { upstream.close(); } catch { /* уже закрыт */ }
    try {
      if (client.readyState === WebSocket.OPEN) client.close();
    } catch { /* уже закрыт */ }
  };

  upstream.on("close", closeBoth);
  upstream.on("error", (err) => {
    console.error("[WS-PROXY] Rust-бэкенд недоступен:", (err as Error).message);
    closeBoth();
  });

  client.on("message", (data, isBinary) => {
    if (upstreamOpen && upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: !!isBinary });
    } else {
      pending.push({ data, binary: !!isBinary });
    }
  });
  client.on("close", closeBoth);
  client.on("error", closeBoth);
}


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

      wss.handleUpgrade(req, socket, head, (wsClient) => {
        // Старого протокола здесь больше нет — только прокси кадров на Rust.
        proxyWsToRust(wsClient, req.url || "/ws");
      });
    });

    server.listen(PORT, HOSTNAME, () => {
      console.log(`\n🚂 ГИД Урал-ВНИИЖТ запущен!`);
      console.log(`   HTTP: http://${HOSTNAME}:${PORT}`);
      console.log(`   WS:   ws://${HOSTNAME}:${PORT}/ws (прокси → Rust :${process.env.BACKEND_PORT || 3001})\n`);
    });

  } catch (error) {
    console.error("\n💥 FATAL ERROR DURING STARTUP:", error);
    process.exit(1);
  }
}).catch((err) => {
  console.error("Next.js prepare failed:", err);
  process.exit(1);
});
