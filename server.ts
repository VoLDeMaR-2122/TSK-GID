import http from "http";
import next from "next";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { Pool } from "pg";

const DEV = process.env.NODE_ENV !== "production";
const PORT = Number(process.env.PORT || 3000);
const HOSTNAME = process.env.HOSTNAME || "0.0.0.0";
const DATABASE_URL = process.env.DATABASE_URL || "postgres://gid:gidpass@localhost:5432/gid";
// Список разрешённых Origin для WS-апгрейда (через запятую). Пусто = принимать все (демо).
const ALLOWED = (process.env.GID_ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);

const pool = new Pool({ connectionString: DATABASE_URL });

// ============================ СХЕМА (без Prisma) ============================
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
  id TEXT PRIMARY KEY, name TEXT NOT NULL, km DOUBLE PRECISION NOT NULL DEFAULT 0,
  paths INT NOT NULL DEFAULT 3, code TEXT NOT NULL DEFAULT '', ord INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS trains (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
  loco_series TEXT, loco_num TEXT, driver TEXT, weight TEXT, length TEXT,
  cargo TEXT, naturka TEXT, idx TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS train_stops (
  id TEXT PRIMARY KEY, train_id TEXT NOT NULL REFERENCES trains(id) ON DELETE CASCADE,
  station_id TEXT NOT NULL REFERENCES stations(id), arr TEXT, dep TEXT, path INT NOT NULL DEFAULT 1,
  ord INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS marks (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, peregon INT NOT NULL DEFAULT 0,
  start TEXT NOT NULL, end TEXT NOT NULL, color TEXT NOT NULL, text TEXT, service TEXT
);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, text TEXT NOT NULL, author TEXT NOT NULL,
  created_at BIGINT NOT NULL, active BOOLEAN NOT NULL DEFAULT true
);
`;

type Station = { id: string; name: string; km: number; paths: number; code: string };
type Stop = { stationId: string; arr: string | null; dep: string | null; path: number };
type Train = {
  id: string; number: string; category: string; locoSeries?: string; locoNum?: string;
  driver?: string; weight?: string; length?: string; cargo?: string; naturka?: string;
  index?: string; note?: string; stops: Stop[];
};
type Mark = { id: string; type: string; peregon: number; start: string; end: string; color: string; text?: string; service?: string };
type Alert = { id: string; type: string; text: string; author: string; createdAt: number; active: boolean };
type UserMeta = { session: string; name: string; role: string; area: string; onDuty: boolean; dutyTime: string };

// ============================ ЧТЕНИЕ СОСТОЯНИЯ ============================
async function loadState() {
  const [st, tr, mk] = await Promise.all([
    pool.query("SELECT * FROM stations ORDER BY ord, km"),
    pool.query("SELECT * FROM trains"),
    pool.query("SELECT * FROM marks ORDER BY created_at_placeholder".replace(" ORDER BY created_at_placeholder", "")),
    pool.query("SELECT ts.* FROM train_stops ts"),
  ]);
  const stopsRows = tr.length ? await pool.query(
    `SELECT ts.*, t.id AS tid FROM train_stops ts JOIN trains t ON t.id = ts.train_id ORDER BY ts.ord`
  ) : { rows: [] as any[] };
  const stopsByTrain = new Map<string, Stop[]>();
  for (const r of stopsRows.rows) {
    if (!stopsByTrain.has(r.tid)) stopsByTrain.set(r.tid, []);
    stopsByTrain.get(r.tid)!.push({ stationId: r.station_id, arr: r.arr, dep: r.dep, path: r.path });
  }
  const stations: Station[] = st.rows.map((r: any) => ({ id: r.id, name: r.name, km: r.km, paths: r.paths, code: r.code }));
  const trains: Train[] = tr.rows.map((r: any) => ({
    id: r.id, number: r.number, category: r.category, locoSeries: r.loco_series, locoNum: r.loco_num,
    driver: r.driver, weight: r.weight, length: r.length, cargo: r.cargo, naturka: r.naturka,
    index: r.idx, note: r.note, stops: stopsByTrain.get(r.id) || [],
  }));
  const marks: Mark[] = mk.rows.map((r: any) => ({
    id: r.id, type: r.type, peregon: r.peregon, start: r.start, end: r.end,
    color: r.color, text: r.text, service: r.service,
  }));
  return { stations, trains, marks };
}

async function loadAlerts(): Promise<Alert[]> {
  const { rows } = await pool.query("SELECT * FROM alerts ORDER BY created_at DESC");
  return rows.map((r: any) => ({ id: r.id, type: r.type, text: r.text, author: r.author, createdAt: Number(r.created_at), active: r.active }));
}

async function loadUsersMeta(): Promise<Map<string, UserMeta>> {
  const { rows } = await pool.query("SELECT * FROM users");
  const m = new Map<string, UserMeta>();
  for (const r of rows) m.set(r.session, { session: r.session, name: r.name, role: r.role, area: r.area, onDuty: r.on_duty, dutyTime: r.duty_time });
  return m;
}

// ============================ ЗАПИСЬ СОСТОЯНИЯ ============================
async function saveState(payload: { stations: Station[]; trains: Train[]; marks: Mark[] }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM train_stops");
    await client.query("DELETE FROM trains");
    await client.query("DELETE FROM stations");
    await client.query("DELETE FROM marks");
    for (const [i, s] of payload.stations.entries())
      await client.query("INSERT INTO stations(id,name,km,paths,code,ord) VALUES($1,$2,$3,$4,$5,$6)", [s.id, s.name, s.km, s.paths, s.code, i]);
    for (const t of payload.trains) {
      await client.query(
        "INSERT INTO trains(id,number,category,loco_series,loco_num,driver,weight,length,cargo,naturka,idx,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [t.id, t.number, t.category, t.locoSeries ?? null, t.locoNum ?? null, t.driver ?? null, t.weight ?? null, t.length ?? null, t.cargo ?? null, t.naturka ?? null, t.index ?? null, t.note ?? null]
      );
      for (const [i, sp] of t.stops.entries())
        await client.query("INSERT INTO train_stops(id,train_id,station_id,arr,dep,path,ord) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [t.id + "_s" + i, t.id, sp.stationId, sp.arr ?? null, sp.dep ?? null, sp.path, i]);
    }
    for (const m of payload.marks)
      await client.query("INSERT INTO marks(id,type,peregon,start,end,color,text,service) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [m.id, m.type, m.peregon, m.start, m.end, m.color, m.text ?? null, m.service ?? null]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function upsertUser(u: UserMeta) {
  await pool.query(
    `INSERT INTO users(session,name,role,area,on_duty,duty_time) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(session) DO UPDATE SET name=$2, role=$3, area=$4, on_duty=$5, duty_time=$6`,
    [u.session, u.name, u.role, u.area, u.onDuty, u.dutyTime]
  );
}
async function patchUser(session: string, patch: Partial<UserMeta>) {
  const cur = (await loadUsersMeta()).get(session);
  if (!cur) return;
  const next = { ...cur, ...patch, session };
  await upsertUser(next);
}
async function addAlert(a: Alert) {
  await pool.query("INSERT INTO alerts(id,type,text,author,created_at,active) VALUES($1,$2,$3,$4,$5,$6)",
    [a.id, a.type, a.text, a.author, a.createdAt, a.active]);
}
async function toggleAlert(id: string) { await pool.query("UPDATE alerts SET active = NOT active WHERE id=$1", [id]); }
async function removeAlert(id: string) { await pool.query("DELETE FROM alerts WHERE id=$1", [id]); }

// ============================ МЯГКИЙ СИД ============================
async function seedIfEmpty() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS c FROM stations");
  if (rows[0].c > 0) return;
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
    { id: "t1", number: "284А", category: "passenger", locoSeries: "ЧС7", locoNum: "210", driver: "Петров П.П.", weight: "950", length: "18", cargo: "пассаж", naturka: "1112221", index: "2600-1111-1", note: "",
      stops: [ { stationId: "s1", arr: "08:00", dep: "08:05", path: 1 }, { stationId: "s3", arr: "08:25", dep: "08:27", path: 2 }, { stationId: "s5", arr: "08:45", dep: "08:47", path: 1 }, { stationId: "s9", arr: "09:40", dep: null, path: 3 } ] },
    { id: "t2", number: "3401", category: "freight", locoSeries: "ВЛ10", locoNum: "1234", driver: "Иванов И.И.", weight: "4500", length: "71", cargo: "уголь", naturka: "3334441", index: "2600-2222-3", note: "Тяжеловес",
      stops: [ { stationId: "s1", arr: null, dep: "09:00", path: 4 }, { stationId: "s3", arr: "09:30", dep: "09:40", path: 3 }, { stationId: "s6", arr: "10:15", dep: "10:25", path: 2 }, { stationId: "s9", arr: "11:00", dep: null, path: 5 } ] },
  ];
  await saveState({ stations, trains, marks: [] });
  console.log("🌱 Посеяны стартовые станции и поезда");
}

// ============================ WEBSOCKET ============================
const wss = new WebSocketServer({ noServer: true });
const live = new Map<string, WebSocket>();      // session -> socket
const meta = new Map<string, UserMeta>();       // session -> мета (кэш из БД)

function sendTo(sock: WebSocket | undefined, m: unknown) {
  if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(m));
}
function broadcast(m: unknown, except?: string) {
  const data = JSON.stringify(m);
  for (const [session, sock] of live) {
    if (session === except) continue;
    if (sock.readyState === WebSocket.OPEN) sock.send(data);
  }
}
async function presencePayload() {
  const users: UserMeta[] = [];
  for (const session of live.keys()) {
    const u = meta.get(session);
    if (u) users.push(u);
  }
  return users;
}
async function broadcastPresence() { broadcast({ kind: "presence", users: await presencePayload() }); }
async function broadcastState() { broadcast({ kind: "state", state: await loadState() }); }
async function broadcastAlerts() { broadcast({ kind: "alerts", alerts: await loadAlerts() }); }

wss.on("connection", async (sock, req) => {
  const session = (req.url || "").split("?session=")[1] || ("anon" + Math.random().toString(36).slice(2));
  // привяжем временный ключ; реальный session придёт в login
  let mySession = session;
  sendTo(sock, { kind: "hello", clientId: mySession });

  // при подключении сразу шлём этому клиенту текущее состояние/присутствие/алерты
  sendTo(sock, { kind: "state", state: await loadState() });
  sendTo(sock, { kind: "alerts", alerts: await loadAlerts() });
  sendTo(sock, { kind: "presence", users: await presencePayload() });

  sock.on("message", async (data: RawData) => {
    let m: any;
    try { m = JSON.parse(String(data)); } catch { return; }
    try {
      switch (m.kind) {
        case "login": {
          const u: UserMeta = { session: m.user.session, name: m.user.name, role: m.user.role, area: m.user.area || "", onDuty: !!m.user.onDuty, dutyTime: m.user.dutyTime || "" };
          mySession = u.session;
          live.set(u.session, sock);
          meta.set(u.session, u);
          await upsertUser(u);
          await broadcastPresence();
          break;
        }
        case "logout": {
          live.delete(mySession);
          await broadcastPresence();
          break;
        }
        case "userPatch": {
          await patchUser(m.session, m.patch);
          const fresh = (await loadUsersMeta()).get(m.session);
          if (fresh) meta.set(m.session, fresh);
          await broadcastPresence();
          break;
        }
        case "state": {
          await saveState(m.state);
          await broadcastState();
          break;
        }
        case "alertAdd": { await addAlert(m.alert); await broadcastAlerts(); break; }
        case "alertToggle": { await toggleAlert(m.id); await broadcastAlerts(); break; }
        case "alertRemove": { await removeAlert(m.id); await broadcastAlerts(); break; }
      }
    } catch (e) {
      console.error("WS handler error", e);
    }
  });

  sock.on("close", async () => {
    if (live.get(mySession) === sock) {
      live.delete(mySession);
      await broadcastPresence();
    }
  });
});

// ============================ HTTP + UPGRADE ============================
const app = next({ dev: DEV });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  await pool.query(SCHEMA);
  await seedIfEmpty();
  // прогреваем кэш мет из БД
  for (const [s, u] of await loadUsersMeta()) meta.set(s, u);

  const server = http.createServer((req, res) => handle(req, res));

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url || "/", "http://localhost");
    if (pathname !== "/ws") return;
    const origin = req.headers.origin;
    if (ALLOWED.length && origin && !ALLOWED.includes(origin)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket as any, head, (ws) => wss.emit("connection", ws, req));
  });

  server.listen(PORT, HOSTNAME, () => {
    console.log(`🚂 ГИД Урал-ВНИИЖТ готов: http://${HOSTNAME}:${PORT}  (WS: /ws)`);
  });
}).catch((e) => { console.error(e); process.exit(1); });
