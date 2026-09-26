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
var import_http = __toESM(require("http"));
var import_next = __toESM(require("next"));
var import_ws = require("ws");
var import_pg = require("pg");
const DEV = process.env.NODE_ENV !== "production";
const PORT = Number(process.env.PORT || 3e3);
const HOSTNAME = process.env.HOSTNAME || "0.0.0.0";
const DATABASE_URL = process.env.DATABASE_URL || "postgres://gid:gidpass@localhost:5432/gid";
const ALLOWED = (process.env.GID_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const pool = new import_pg.Pool({ connectionString: DATABASE_URL });
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
function normalizeUser(input) {
  return {
    session: String(input.session || ""),
    name: String(input.name || ""),
    role: String(input.role || "dsp"),
    area: String(input.area || ""),
    onDuty: Boolean(input.onDuty),
    dutyTime: String(input.dutyTime || "")
  };
}
function normalizeAlert(input) {
  return {
    id: String(input.id || ""),
    type: String(input.type || "info"),
    text: String(input.text || ""),
    author: String(input.author || ""),
    createdAt: Number(input.createdAt || Date.now()),
    active: input.active !== false
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
  const stopsByTrain = /* @__PURE__ */ new Map();
  for (const r of stopsRes.rows) {
    const list = stopsByTrain.get(r.train_id) || [];
    list.push({
      stationId: r.station_id,
      arr: r.arr,
      dep: r.dep,
      path: r.path
    });
    stopsByTrain.set(r.train_id, list);
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
    end: r.end,
    color: r.color,
    text: r.text ?? void 0,
    service: r.service ?? void 0
  }));
  return { stations, trains, marks };
}
async function loadAlerts() {
  const res = await pool.query(
    `SELECT id, type, text, author, created_at, active
     FROM alerts
     ORDER BY created_at DESC`
  );
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
  const res = await pool.query(
    `SELECT session, name, role, area, on_duty, duty_time
     FROM users`
  );
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
          t.note ?? null
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
            i
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
          m.service ?? null
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
async function upsertUserLogin(u) {
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
const USER_COLUMN = {
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
async function addAlert(a) {
  await pool.query(
    `INSERT INTO alerts(id, type, text, author, created_at, active)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [a.id, a.type, a.text, a.author, a.createdAt, a.active]
  );
}
async function toggleAlert(id) {
  await pool.query("UPDATE alerts SET active = NOT active WHERE id=$1", [id]);
}
async function removeAlert(id) {
  await pool.query("DELETE FROM alerts WHERE id=$1", [id]);
}
async function seedIfEmpty() {
  const res = await pool.query("SELECT COUNT(*)::int AS c FROM stations");
  const count = Number(res.rows[0]?.c || 0);
  if (count > 0) return;
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
  console.log("\u{1F331} \u041F\u043E\u0441\u0435\u044F\u043D\u044B \u0441\u0442\u0430\u0440\u0442\u043E\u0432\u044B\u0435 \u0441\u0442\u0430\u043D\u0446\u0438\u0438 \u0438 \u043F\u043E\u0435\u0437\u0434\u0430");
}
const wss = new import_ws.WebSocketServer({ noServer: true });
const live = /* @__PURE__ */ new Map();
const meta = /* @__PURE__ */ new Map();
function sendTo(sock, m) {
  if (sock && sock.readyState === import_ws.WebSocket.OPEN) {
    sock.send(JSON.stringify(m));
  }
}
function broadcast(m) {
  const data = JSON.stringify(m);
  for (const sock of live.values()) {
    if (sock.readyState === import_ws.WebSocket.OPEN) {
      sock.send(data);
    }
  }
}
async function presencePayload() {
  const users = [];
  for (const session of live.keys()) {
    const u = meta.get(session);
    if (u) users.push(u);
  }
  return users;
}
async function broadcastPresence() {
  broadcast({
    kind: "presence",
    users: await presencePayload()
  });
}
async function broadcastState() {
  broadcast({
    kind: "state",
    state: await loadState()
  });
}
async function broadcastAlerts() {
  broadcast({
    kind: "alerts",
    alerts: await loadAlerts()
  });
}
wss.on("connection", async (sock, req) => {
  const url = new URL(req.url || "/", "http://localhost");
  let mySession = url.searchParams.get("session") || `anon-${Math.random().toString(36).slice(2)}`;
  sendTo(sock, { kind: "hello", clientId: mySession });
  try {
    sendTo(sock, { kind: "state", state: await loadState() });
    sendTo(sock, { kind: "alerts", alerts: await loadAlerts() });
    sendTo(sock, { kind: "presence", users: await presencePayload() });
  } catch (e) {
    console.error("Initial payload error", e);
  }
  sock.on("message", async (data) => {
    let m;
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
          await patchUser(session, m.patch);
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
const app = (0, import_next.default)({ dev: DEV });
const handle = app.getRequestHandler();
app.prepare().then(async () => {
  await pool.query(SCHEMA);
  await seedIfEmpty();
  for (const [session, u] of await loadUsersMeta()) {
    meta.set(session, u);
  }
  const server = import_http.default.createServer((req, res) => {
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
      `\u{1F682} \u0413\u0418\u0414 \u0423\u0440\u0430\u043B-\u0412\u041D\u0418\u0418\u0416\u0422 \u0433\u043E\u0442\u043E\u0432: http://${HOSTNAME}:${PORT}  (WS: /ws)`
    );
  });
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
