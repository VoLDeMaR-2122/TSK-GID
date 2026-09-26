import http from "http";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { Pool } from "pg";

const DEV = process.env.NODE_ENV !== "production";
const PORT = Number(process.env.PORT || 3000);
const HOSTNAME = process.env.HOSTNAME || "0.0.0.0";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://gid:gidpass@localhost:5432/gid";

const ALLOWED = (process.env.GID_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const pool = new Pool({ connectionString: DATABASE_URL });

type UserMeta = {
  session: string;
  name: string;
  role: string;
  area: string;
  onDuty: boolean;
  dutyTime: string;
};

type Station = {
  id: string;
  name: string;
  km: number;
  paths: number;
  code: string;
};

type Stop = {
  stationId: string;
  arr: string | null;
  dep: string | null;
  path: number;
};

type Train = {
  id: string;
  number: string;
  category: string;
  locoSeries?: string;
  locoNum?: string;
  driver?: string;
  weight?: string;
  length?: string;
  cargo?: string;
  naturka?: string;
  index?: string;
  note?: string;
  stops: Stop[];
};

type Mark = {
  id: string;
  type: string;
  peregon: number;
  start: string;
  end: string;
  color: string;
  text?: string;
  service?: string;
};

type Alert = {
  id: string;
  type: string;
  text: string;
  author: string;
  createdAt: number;
  active: boolean;
};

interface StationRow {
  id: string;
  name: string;
  km: number;
  paths: number;
  code: string;
}

interface TrainRow {
  id: string;
  number: string;
  category: string;
  loco_series: string | null;
  loco_num: string | null;
  driver: string | null;
  weight: string | null;
  length: string | null;
  cargo: string | null;
  naturka: string | null;
  idx: string | null;
  note: string | null;
}

interface StopRow {
  train_id: string;
  station_id: string;
  arr: string | null;
  dep: string | null;
  path: number;
}

interface MarkRow {
  id: string;
  type: string;
  peregon: number;
  start: string;
  end: string;
  color: string;
  text: string | null;
  service: string | null;
}

interface UserRow {
  session: string;
  name: string;
  role: string;
  area: string;
  on_duty: boolean;
  duty_time: string;
}

interface AlertRow {
  id: string;
  type: string;
  text: string;
  author: string;
  created_at: string | number;
  active: boolean;
}

const SCHEMA = `
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
  end TEXT NOT NULL,
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
`;

function normalizeUser(input: any): UserMeta {
  return {
    session: String(input.session || ""),
    name: String(input.name || ""),
    role: String(input.role || "dsp"),
    area: String(input.area || ""),
    onDuty: Boolean(input.onDuty),
    dutyTime: String(input.dutyTime || ""),
  };
}

function normalizeAlert(input: any): Alert {
  return {
    id: String(input.id || ""),
    type: String(input.type || "info"),
    text: String(input.text || ""),
    author: String(input.author || ""),
    createdAt: Number(input.createdAt || Date.now()),
    active: input.active !== false,
  };
}

async function loadState() {
  const stationsRes = await pool.query(
    "SELECT id, name, km, paths, code FROM stations ORDER BY ord, km"
  );

  const trainsRes = await pool.query(
    `SELECT id, number, category, loco_series, loco_num, driver,
            weight, length, cargo, naturka, idx, note
     FROM trains`
  );

  const marksRes = await pool.query(
    `SELECT id, type, peregon, start, end, color, text, service
     FROM marks`
  );

  const stopsRes = await pool.query(
    `SELECT train_id, station_id, arr, dep, path
     FROM train_stops
     ORDER BY ord`
  );

  const stopsByTrain = new Map<string, Stop[]>();

  for (const r of stopsRes.rows as StopRow[]) {
    const list = stopsByTrain.get(r.train_id) || [];
    list.push({
      stationId: r.station_id,
      arr: r.arr,
      dep: r.dep,
      path: r.path,
    });
    stopsByTrain.set(r.train_id, list);
  }

  const stations: Station[] = (stationsRes.rows as StationRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    km: r.km,
    paths: r.paths,
    code: r.code,
  }));

  const trains: Train[] = (trainsRes.rows as TrainRow[]).map((r) => ({
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

  const marks: Mark[] = (marksRes.rows as MarkRow[]).map((r) => ({
    id: r.id,
    type: r.type,
    peregon: r.peregon,
    start: r.start,
    end: r.end,
    color: r.color,
    text: r.text ?? undefined,
    service: r.service ?? undefined,
  }));

  return { stations, trains, marks };
}

async function loadAlerts(): Promise<Alert[]> {
  const res = await pool.query(
    `SELECT id, type, text, author, created_at, active
     FROM alerts
     ORDER BY created_at DESC`
  );

  return (res.rows as AlertRow[]).map((r) => ({
    id: r.id,
    type: r.type,
    text: r.text,
    author: r.author,
    createdAt: Number(r.created_at),
    active: r.active,
  }));
}

async function loadUsersMeta(): Promise<Map<string, UserMeta>> {
  const res = await pool.query(
    `SELECT session, name, role, area, on_duty, duty_time
     FROM users`
  );

  const map = new Map<string, UserMeta>();

  for (const r of res.rows as UserRow[]) {
    map.set(r.session, {
      session: r.session,
      name: r.name,
      role: r.role,
      area: r.area,
      onDuty: r.on_duty,
      dutyTime: r.duty_time,
    });
  }

  return map;
}

async function saveState(payload: {
  stations: Station[];
  trains: Train[];
  marks: Mark[];
}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query("DELETE FROM train_stops");
    await client.query("DELETE FROM trains");
    await client.query("DELETE FROM stations");
    await client.query("DELETE FROM marks");

    for (const [i, s] of payload.stations.entries()) {
      await client.query(
        `INSERT INTO stations(id, name, km, paths, code, ord)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [s.id, s.name, s.km, s.paths, s.code, i]
      );
    }

    for (const t of payload.trains) {
      await client.query(
        `INSERT INTO trains(
          id, number, category, loco_series, loco_num, driver,
          weight, length, cargo, naturka, idx, note
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          t.id,
          t.number,
          t.category,
          t.locoSeries ?? null,
          t.locoNum ?? null,
          t.driver ?? null,
          t.weight ?? null,
          t.length ?? null,
          t.cargo ?? null,
          t.naturka ?? null,
          t.index ?? null,
          t.note ?? null,
        ]
      );

      for (const [i, sp] of t.stops.entries()) {
        await client.query(
          `INSERT INTO train_stops(id, train_id, station_id, arr, dep, path, ord)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            `${t.id}_s${i}`,
            t.id,
            sp.stationId,
            sp.arr ?? null,
            sp.dep ?? null,
            sp.path,
            i,
          ]
        );
      }
    }

    for (const m of payload.marks) {
      await client.query(
        `INSERT INTO marks(id, type, peregon, start, end, color, text, service)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          m.id,
          m.type,
          m.peregon,
          m.start,
          m.end,
          m.color,
          m.text ?? null,
          m.service ?? null,
        ]
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
  // При логине НЕ перезаписываем on_duty/duty_time, если пользователь уже есть в БД.
  // Это позволяет сохранять статус дежурства при перезагрузке страницы.
  await pool.query(
    `INSERT INTO users(session, name, role, area, on_duty, duty_time)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(session)
     DO UPDATE SET
       name = EXCLUDED.name,
       role = EXCLUDED.role,
       area = EXCLUDED.area`,
    [u.session, u.name, u.role, u.area, u.onDuty, u.dutyTime]
  );
}

const USER_COLUMN: Record<string, string> = {
  name: "name",
  role: "role",
  area: "area",
  onDuty: "on_duty",
  dutyTime: "duty_time",
};

async function patchUser(session: string, patch: Partial<UserMeta>) {
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const key of Object.keys(patch) as (keyof UserMeta)[]) {
    const col = USER_COLUMN[key];
    if (!col) continue;

    sets.push(`${col}=$${idx++}`);
    values.push(patch[key]);
  }

  if (!sets.length) return;

  values.push(session);

  await pool.query(
    `UPDATE users SET ${sets.join(", ")} WHERE session=$${idx}`,
    values
  );
}

async function addAlert(a: Alert) {
  await pool.query(
    `INSERT INTO alerts(id, type, text, author, created_at, active)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [a.id, a.type, a.text, a.author, a.createdAt, a.active]
  );
}

async function toggleAlert(id: string) {
  await pool.query("UPDATE alerts SET active = NOT active WHERE id=$1", [id]);
}

async function removeAlert(id: string) {
  await pool.query("DELETE FROM alerts WHERE id=$1", [id]);
}

async function seedIfEmpty() {
  const res = await pool.query("SELECT COUNT(*)::int AS c FROM stations");
  const count = Number(res.rows[0]?.c || 0);

  if (count > 0) return;

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
      id: "t1",
      number: "284А",
      category: "passenger",
      locoSeries: "ЧС7",
      locoNum: "210",
      driver: "Петров П.П.",
      weight: "950",
      length: "18",
      cargo: "пассаж",
      naturka: "1112221",
      index: "2600-1111-1",
      note: "",
      stops: [
        { stationId: "s1", arr: "08:00", dep: "08:05", path: 1 },
        { stationId: "s3", arr: "08:25", dep: "08:27", path: 2 },
        { stationId: "s5", arr: "08:45", dep: "08:47", path: 1 },
        { stationId: "s9", arr: "09:40", dep: null, path: 3 },
      ],
    },
    {
      id: "t2",
      number: "3401",
      category: "freight",
      locoSeries: "ВЛ10",
      locoNum: "1234",
      driver: "Иванов И.И.",
      weight: "4500",
      length: "71",
      cargo: "уголь",
      naturka: "3334441",
      index: "2600-2222-3",
      note: "Тяжеловес",
      stops: [
        { stationId: "s1", arr: null, dep: "09:00", path: 4 },
        { stationId: "s3", arr: "09:30", dep: "09:40", path: 3 },
        { stationId: "s6", arr: "10:15", dep: "10:25", path: 2 },
        { stationId: "s9", arr: "11:00", dep: null, path: 5 },
      ],
    },
  ];

  await saveState({ stations, trains, marks: [] });
  console.log("🌱 Посеяны стартовые станции и поезда");
}

const wss = new WebSocketServer({ noServer: true });

// session -> живой websocket
const live = new Map<string, WebSocket>();

// session -> мета пользователя
const meta = new Map<string, UserMeta>();

function sendTo(sock: WebSocket | undefined, m: unknown) {
  if (sock && sock.readyState === WebSocket.OPEN) {
    sock.send(JSON.stringify(m));
  }
}

function broadcast(m: unknown) {
  const data = JSON.stringify(m);

  for (const sock of live.values()) {
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(data);
    }
  }
}

async function presencePayload(): Promise<UserMeta[]> {
  const users: UserMeta[] = [];

  for (const session of live.keys()) {
    const u = meta.get(session);
    if (u) users.push(u);
  }

  return users;
}

async function broadcastPresence() {
  broadcast({
    kind: "presence",
    users: await presencePayload(),
  });
}

async function broadcastState() {
  broadcast({
    kind: "state",
    state: await loadState(),
  });
}

async function broadcastAlerts() {
  broadcast({
    kind: "alerts",
    alerts: await loadAlerts(),
  });
}

wss.on("connection", async (sock, req) => {
  const url = new URL(req.url || "/", "http://localhost");
  let mySession =
    url.searchParams.get("session") ||
    `anon-${Math.random().toString(36).slice(2)}`;

  sendTo(sock, { kind: "hello", clientId: mySession });

  try {
    sendTo(sock, { kind: "state", state: await loadState() });
    sendTo(sock, { kind: "alerts", alerts: await loadAlerts() });
    sendTo(sock, { kind: "presence", users: await presencePayload() });
  } catch (e) {
    console.error("Initial payload error", e);
  }

  sock.on("message", async (data) => {
    let m: any;

    try {
      m = JSON.parse(String(data));
    } catch {
      return;
    }

    try {
      switch (m.kind) {
        case "login": {
          const u = normalizeUser(m.user);
          if (!u.session) return;

          mySession = u.session;
          live.set(u.session, sock);
          meta.set(u.session, u);

          await upsertUserLogin(u);

          const fresh = (await loadUsersMeta()).get(u.session);
          if (fresh) meta.set(u.session, fresh);

          await broadcastPresence();
          break;
        }

        case "logout": {
          if (live.get(mySession) === sock) {
            live.delete(mySession);
          }

          await broadcastPresence();
          break;
        }

        case "userPatch": {
          const session = String(m.session || "");
          if (!session) return;

          await patchUser(session, m.patch as Partial<UserMeta>);

          const fresh = (await loadUsersMeta()).get(session);
          if (fresh) meta.set(session, fresh);

          await broadcastPresence();
          break;
        }

        case "state": {
          await saveState(m.state);
          await broadcastState();
          break;
        }

        case "alertAdd": {
          await addAlert(normalizeAlert(m.alert));
          await broadcastAlerts();
          break;
        }

        case "alertToggle": {
          await toggleAlert(String(m.id));
          await broadcastAlerts();
          break;
        }

        case "alertRemove": {
          await removeAlert(String(m.id));
          await broadcastAlerts();
          break;
        }
      }
    } catch (e) {
      console.error("WS handler error", e);
    }
  });

  sock.on("close", async () => {
    if (live.get(mySession) === sock) {
      live.delete(mySession);
    }

    await broadcastPresence();
  });
});

const app = next({ dev: DEV });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(async () => {
    await pool.query(SCHEMA);
    await seedIfEmpty();

    // Прогреваем мету из БД
    for (const [session, u] of await loadUsersMeta()) {
      meta.set(session, u);
    }

    const server = http.createServer((req, res) => {
      handle(req, res);
    });

    server.on("upgrade", (req, socket, head) => {
      const { pathname } = new URL(req.url || "/", "http://localhost");

      if (pathname !== "/ws") return;

      const origin = req.headers.origin;

      if (ALLOWED.length && origin && !ALLOWED.includes(origin)) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    });

    server.listen(PORT, HOSTNAME, () => {
      console.log(
        `🚂 ГИД Урал-ВНИИЖТ готов: http://${HOSTNAME}:${PORT}  (WS: /ws)`
      );
    });
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
