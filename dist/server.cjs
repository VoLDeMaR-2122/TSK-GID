"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var import_dotenv = require("dotenv");
var import_http = __toESM(require("http"));
var import_next = __toESM(require("next"));
var import_ws = require("ws");
var import_pg = require("pg");
(0, import_dotenv.config)({ path: ".env.local" });
const DEV = process.env.NODE_ENV !== "production";
const PORT = Number(process.env.PORT || 3e3);
const HOSTNAME = "0.0.0.0";
const PG_USER = process.env.POSTGRES_USER || "gid";
const PG_PASS = process.env.POSTGRES_PASSWORD || "gidpass";
const PG_DB = process.env.POSTGRES_DB || "gid";
const PG_HOST = process.env.DB_HOST || "localhost";
const PG_PORT = process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432;
const DATABASE_URL = process.env.DATABASE_URL || `postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${PG_DB}`;
console.log(`[CONFIG] App will listen on ${HOSTNAME}:${PORT}`);
console.log(`[CONFIG] DB Target: ${PG_HOST}:${PG_PORT} (User: ${PG_USER}, DB: ${PG_DB})`);
const ALLOWED_ORIGINS = (process.env.GID_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const pool = new import_pg.Pool({ connectionString: DATABASE_URL });
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
async function waitForDb(retries = 20, delayMs = 2e3) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      console.log("[DB] Connection established successfully.");
      return;
    } catch (err) {
      console.warn(`[DB] Attempt ${i + 1}/${retries} failed: ${err.message}. Retrying in ${delayMs}ms...`);
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
async function loadState() {
  const [stationsRes, trainsRes, marksRes, stopsRes] = await Promise.all([
    pool.query("SELECT id, name, km, paths, code FROM stations ORDER BY ord, km"),
    pool.query("SELECT id, number, category, loco_series, loco_num, driver, weight, length, cargo, naturka, idx, note FROM trains"),
    pool.query("SELECT id, type, peregon, start, end_time, color, text, service FROM marks"),
    pool.query("SELECT train_id, station_id, arr, dep, path FROM train_stops ORDER BY ord")
  ]);
  const stopsByTrain = /* @__PURE__ */ new Map();
  for (const r of stopsRes.rows) {
    if (!stopsByTrain.has(r.train_id)) stopsByTrain.set(r.train_id, []);
    stopsByTrain.get(r.train_id).push({
      stationId: r.station_id,
      arr: r.arr,
      dep: r.dep,
      path: r.path
    });
  }
  const stations = stationsRes.rows.map((r) => ({
    id: r.id,
    name: r.name,
    km: r.km,
    paths: r.paths,
    code: r.code
  }));
  const trains = trainsRes.rows.map((r) => ({
    id: r.id,
    number: r.number,
    category: r.category,
    locoSeries: r.loco_series ?? void 0,
    locoNum: r.loco_num ?? void 0,
    driver: r.driver ?? void 0,
    weight: r.weight ?? void 0,
    length: r.length ?? void 0,
    cargo: r.cargo ?? void 0,
    naturka: r.naturka ?? void 0,
    index: r.idx ?? void 0,
    note: r.note ?? void 0,
    stops: stopsByTrain.get(r.id) || []
  }));
  const marks = marksRes.rows.map((r) => ({
    id: r.id,
    type: r.type,
    peregon: r.peregon,
    start: r.start,
    end: r.end_time,
    // <-- Правильное маппинг поля из БД в модель TS
    color: r.color,
    text: r.text ?? void 0,
    service: r.service ?? void 0
  }));
  return { stations, trains, marks };
}
async function loadAlerts() {
  const res = await pool.query("SELECT * FROM alerts ORDER BY created_at DESC");
  return res.rows.map((r) => ({
    id: r.id,
    type: r.type,
    text: r.text,
    author: r.author,
    createdAt: Number(r.created_at),
    active: r.active
  }));
}
async function loadUsersMeta() {
  const res = await pool.query("SELECT * FROM users");
  const map = /* @__PURE__ */ new Map();
  for (const r of res.rows) {
    map.set(r.session, {
      session: r.session,
      name: r.name,
      role: r.role,
      area: r.area,
      onDuty: r.on_duty,
      dutyTime: r.duty_time
    });
  }
  return map;
}
async function saveState(payload) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM train_stops");
    await client.query("DELETE FROM trains");
    await client.query("DELETE FROM stations");
    await client.query("DELETE FROM marks");
    for (const [i, s] of payload.stations.entries()) {
      await client.query(
        "INSERT INTO stations(id, name, km, paths, code, ord) VALUES($1,$2,$3,$4,$5,$6)",
        [s.id, s.name, s.km, s.paths, s.code, i]
      );
    }
    for (const t of payload.trains) {
      await client.query(
        `INSERT INTO trains(id, number, category, loco_series, loco_num, driver, weight, length, cargo, naturka, idx, note)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
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
          t.note ?? null
        ]
      );
      for (const [i, sp] of t.stops.entries()) {
        await client.query(
          "INSERT INTO train_stops(id, train_id, station_id, arr, dep, path, ord) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [`${t.id}_s${i}`, t.id, sp.stationId, sp.arr ?? null, sp.dep ?? null, sp.path, i]
        );
      }
    }
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
async function upsertUserLogin(u) {
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
const USER_COL_MAP = {
  name: "name",
  role: "role",
  area: "area",
  onDuty: "on_duty",
  dutyTime: "duty_time"
};
async function patchUser(session, patch) {
  const sets = [];
  const values = [];
  let idx = 1;
  for (const key of Object.keys(patch)) {
    const col = USER_COL_MAP[key];
    if (!col) continue;
    sets.push(`${col}=$${idx++}`);
    values.push(patch[key]);
  }
  if (!sets.length) return;
  values.push(session);
  await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE session=$${idx}`, values);
}
async function addAlert(a) {
  await pool.query(
    "INSERT INTO alerts(id, type, text, author, created_at, active) VALUES($1,$2,$3,$4,$5,$6)",
    [a.id, a.type, a.text, a.author, a.createdAt, a.active]
  );
}
async function toggleAlert(id) {
  await pool.query("UPDATE alerts SET active = NOT active WHERE id=$1", [id]);
}
async function removeAlert(id) {
  await pool.query("DELETE FROM alerts WHERE id=$1", [id]);
}
async function addAuditEntry(entry) {
  const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await pool.query(
    "INSERT INTO audit_log(id, ts, actor, action, target, detail) VALUES($1,$2,$3,$4,$5,$6)",
    [id, Date.now(), entry.actor, entry.action, entry.target ?? null, entry.detail ?? null]
  );
}
async function loadAuditLog() {
  const res = await pool.query(
    "SELECT id, ts, actor, action, target, detail FROM audit_log ORDER BY ts DESC LIMIT 200"
  );
  return res.rows.map((r) => ({
    id: r.id,
    ts: Number(r.ts),
    actor: r.actor,
    action: r.action,
    target: r.target ?? void 0,
    detail: r.detail ?? void 0
  }));
}
async function seedIfEmpty() {
  const res = await pool.query("SELECT COUNT(*)::int AS c FROM stations");
  if ((res.rows[0]?.c || 0) > 0) return;
  console.log("\u{1F331} Seeding initial data...");
  const stations = [
    { id: "s1", name: "\u0413\u043E\u0440\u044C\u043A\u0438\u0439-\u041C\u043E\u0441\u043A", km: 0, paths: 8, code: "26000" },
    { id: "s2", name: "\u041A\u0440. \u0423\u0437\u0435\u043B", km: 15, paths: 4, code: "26010" },
    { id: "s3", name: "\u0414\u0437\u0435\u0440\u0436\u0438\u043D\u0441\u043A", km: 24, paths: 6, code: "26020" },
    { id: "s4", name: "\u0418\u0433\u0443\u043C\u043D\u043E\u0432\u043E", km: 32, paths: 2, code: "26030" },
    { id: "s5", name: "\u0421\u0435\u0439\u043C\u0430", km: 45, paths: 3, code: "26040" },
    { id: "s6", name: "\u0412\u044F\u0437\u044C\u043C\u0430", km: 58, paths: 4, code: "26050" },
    { id: "s7", name: "\u041F\u0435\u0442\u0443\u0448\u043A\u0438", km: 72, paths: 3, code: "26060" },
    { id: "s8", name: "\u041E\u0440\u0435\u0445\u043E\u0432\u043E", km: 85, paths: 2, code: "26070" },
    { id: "s9", name: "\u041C\u043E\u0441\u043A\u0432\u0430-\u041A\u0443\u0440", km: 105, paths: 10, code: "27000" }
  ];
  const trains = [
    {
      id: "t1",
      number: "284\u0410",
      category: "passenger",
      locoSeries: "\u0427\u04217",
      locoNum: "210",
      driver: "\u041F\u0435\u0442\u0440\u043E\u0432 \u041F.\u041F.",
      weight: "950",
      length: "18",
      cargo: "\u043F\u0430\u0441\u0441\u0430\u0436",
      naturka: "1112221",
      index: "2600-1111-1",
      note: "",
      stops: [
        { stationId: "s1", arr: "08:00", dep: "08:05", path: 1 },
        { stationId: "s3", arr: "08:25", dep: "08:27", path: 2 },
        { stationId: "s5", arr: "08:45", dep: "08:47", path: 1 },
        { stationId: "s9", arr: "09:40", dep: null, path: 3 }
      ]
    },
    {
      id: "t2",
      number: "3401",
      category: "freight",
      locoSeries: "\u0412\u041B10",
      locoNum: "1234",
      driver: "\u0418\u0432\u0430\u043D\u043E\u0432 \u0418.\u0418.",
      weight: "4500",
      length: "71",
      cargo: "\u0443\u0433\u043E\u043B\u044C",
      naturka: "3334441",
      index: "2600-2222-3",
      note: "\u0422\u044F\u0436\u0435\u043B\u043E\u0432\u0435\u0441",
      stops: [
        { stationId: "s1", arr: null, dep: "09:00", path: 4 },
        { stationId: "s3", arr: "09:30", dep: "09:40", path: 3 },
        { stationId: "s6", arr: "10:15", dep: "10:25", path: 2 },
        { stationId: "s9", arr: "11:00", dep: null, path: 5 }
      ]
    }
  ];
  await saveState({ stations, trains, marks: [] });
  console.log("\u2705 Seed completed.");
}
const wss = new import_ws.WebSocketServer({ noServer: true });
const liveSockets = /* @__PURE__ */ new Map();
const userCache = /* @__PURE__ */ new Map();
function sendTo(sock, msg) {
  if (sock && sock.readyState === import_ws.WebSocket.OPEN) {
    sock.send(JSON.stringify(msg));
  }
}
function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const sock of liveSockets.values()) {
    if (sock.readyState === import_ws.WebSocket.OPEN) {
      sock.send(data);
    }
  }
}
async function getPresenceList() {
  const users = [];
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
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    try {
      switch (msg.kind) {
        case "login": {
          const u = {
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
          await addAuditEntry({ actor: u.name, action: "login", detail: `\u0420\u043E\u043B\u044C: ${u.role}` });
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
          await patchUser(targetSession, msg.patch);
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
          const targetSocket = liveSockets.get(targetSession);
          if (targetSocket) {
            targetSocket.close();
          }
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
          await addAuditEntry({ actor, action: "state_save", detail: `\u041F\u043E\u0435\u0437\u0434\u043E\u0432: ${msg.state?.trains?.length ?? 0}, \u0421\u0442\u0430\u043D\u0446\u0438\u0439: ${msg.state?.stations?.length ?? 0}` });
          await broadcastAudit();
          await broadcastState();
          break;
        }
        case "alertAdd": {
          const a = {
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
const app = (0, import_next.default)({ dev: DEV });
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
    const server = import_http.default.createServer((req, res) => {
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
      console.log(`
\u{1F682} \u0413\u0418\u0414 \u0423\u0440\u0430\u043B-\u0412\u041D\u0418\u0418\u0416\u0422 \u0437\u0430\u043F\u0443\u0449\u0435\u043D!`);
      console.log(`   HTTP: http://${HOSTNAME}:${PORT}`);
      console.log(`   WS:   ws://${HOSTNAME}:${PORT}/ws
`);
    });
  } catch (error) {
    console.error("\n\u{1F4A5} FATAL ERROR DURING STARTUP:", error);
    process.exit(1);
  }
}).catch((err) => {
  console.error("Next.js prepare failed:", err);
  process.exit(1);
});
