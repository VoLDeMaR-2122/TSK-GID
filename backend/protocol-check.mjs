// Проверка совместимости протокола: синхронизация данных графа,
// тревоги, аудит и разграничение прав.
//
// Вход выполняется по учётной записи, поэтому нужны действующие логин
// и пароль: GID_LOGIN / GID_PASSWORD (для проверки прав — учётка ДНЦ).
//
//   node backend/protocol-check.mjs ws://127.0.0.1:3001/ws

import WebSocket from "ws";

const URL = process.argv[2] || "ws://127.0.0.1:3001/ws";
const LOGIN = process.env.GID_LOGIN || "";
const PASSWORD = process.env.GID_PASSWORD || "";

if (!LOGIN || !PASSWORD) {
  console.error("Задайте GID_LOGIN и GID_PASSWORD — учётную запись ДНЦ из панели администратора.");
  process.exit(2);
}

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok });
  console.log(`${ok ? "  OK  " : " FAIL "} ${name}${detail ? " — " + detail : ""}`);
}

const ws = new WebSocket(URL);

const seen = [];
const waiters = [];

function note(kind, payload) {
  const entry = { kind, payload };
  seen.push(entry);
  for (let i = waiters.length - 1; i >= 0; i--) {
    if (waiters[i].kind === kind) {
      waiters.splice(i, 1)[0].resolve(entry);
    }
  }
}

function waitFor(kind, timeoutMs = 8000) {
  const already = seen.find((s) => s.kind === kind);
  if (already) return Promise.resolve(already);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`не дождались "${kind}"`)), timeoutMs);
    waiters.push({ kind, resolve: (v) => { clearTimeout(t); resolve(v); } });
  });
}

const send = (obj) => {
  seen.length = 0;
  ws.send(JSON.stringify(obj));
};

ws.on("message", (raw) => {
  try {
    const m = JSON.parse(raw.toString());
    if (m.kind) note(m.kind, m);
  } catch {
    /* не наше сообщение */
  }
});

ws.on("error", (e) => {
  console.error("Ошибка сокета:", e.message);
  process.exit(1);
});

ws.on("open", async () => {
  try {
    send({ kind: "login", login: LOGIN, password: PASSWORD });
    const hello = await waitFor("loginOk");

    check(
      "вход по учётной записи состоялся",
      !!hello.payload?.user?.session && !!hello.payload?.user?.personLogin,
      `роль=${hello.payload?.user?.role}, логин=${hello.payload?.user?.personLogin}`,
    );

    // ---- Стартовый снимок ----
    const state = await waitFor("state");
    check(
      "state: есть станции и поезда",
      Array.isArray(state.payload.state?.stations) &&
        Array.isArray(state.payload.state?.trains),
      `станций=${state.payload.state?.stations?.length}, поездов=${state.payload.state?.trains?.length}`,
    );

    const stops = state.payload.state?.trains?.[0]?.stops;
    check(
      "state: остановки в camelCase (stationId)",
      !stops || stops.length === 0 || typeof stops[0].stationId === "string",
      stops?.[0] ? `stationId=${stops[0].stationId}` : "",
    );

    const mark0 = state.payload.state?.marks?.[0];
    check("state: пометка использует поле end", !mark0 || typeof mark0.end === "string", "");

    await waitFor("alerts");
    await waitFor("presence");
    await waitFor("audit");
    check("alerts / presence / audit приходят", true);

    // ---- Права от сервера ----
    const caps = await waitFor("capabilities");
    const capsList = caps.payload.caps ?? [];
    check("capabilities: сервер прислал права", capsList.length > 0, `прав: ${capsList.length}`);

    // ---- ДНЦ не может отключать и назначать роли ----
    send({ kind: "kick", session: "someone" });
    const noKick = await waitFor("forbidden", 6000).catch(() => null);
    check("доступ: нет права на kick", !!noKick, noKick?.payload?.message ?? "отказ не получен");

    // ---- Тревоги: полный цикл редактора ----
    const alertId = "test_alert_" + Date.now();
    send({
      kind: "alertAdd",
      alert: {
        id: alertId,
        type: "info",
        title: "Проверка связи",
        text: "Краткое описание",
        full: "Полное описание для карточки",
        author: "Подделка имени", // сервер обязан заменить своим
        createdAt: Date.now(),
        active: true,
      },
    });
    const alerts1 = await waitFor("alerts");
    const a1 = (alerts1.payload.alerts ?? []).find((a) => a.id === alertId);
    check("alertAdd: тревога добавлена", !!a1, a1 ? `author=${a1.author}` : "");
    check(
      "alertAdd: автор подставляется сервером",
      !!a1 && a1.author !== "Подделка имени",
      a1 ? `author=${a1.author}` : "",
    );
    check(
      "alertAdd: createdAt — число",
      !!a1 && typeof a1.createdAt === "number",
      a1 ? `typeof=${typeof a1.createdAt}` : "",
    );
    check(
      "alertAdd: название и описания доходят целиком",
      !!a1 && a1.title === "Проверка связи" && a1.text === "Краткое описание" && a1.full === "Полное описание для карточки",
      a1 ? `title=${a1.title}` : "",
    );

    send({
      kind: "alertUpdate",
      alert: { id: alertId, type: "warning", title: "Обновлено", text: "Кратко-2", full: "Полно-2" },
    });
    const alertsU = await waitFor("alerts");
    const au = (alertsU.payload.alerts ?? []).find((a) => a.id === alertId);
    check(
      "alertUpdate: тип, название и описания меняются",
      !!au && au.type === "warning" && au.title === "Обновлено" && au.text === "Кратко-2" && au.full === "Полно-2",
      au ? `type=${au.type}, title=${au.title}` : "",
    );
    check(
      "alertUpdate: автор и время не меняются",
      !!au && au.author === a1.author && au.createdAt === a1.createdAt,
      "",
    );

    send({ kind: "alertToggle", id: alertId });
    const alerts2 = await waitFor("alerts");
    const a2 = (alerts2.payload.alerts ?? []).find((a) => a.id === alertId);
    check("alertToggle: active переключён", !!a2 && a2.active === false, "");

    send({ kind: "alertRemove", id: alertId });
    const alerts3 = await waitFor("alerts");
    check(
      "alertRemove: тревога удалена",
      !(alerts3.payload.alerts ?? []).some((a) => a.id === alertId),
      "",
    );

    // ---- Сохранение графа ----
    const current = state.payload.state;
    send({ kind: "state", state: current });
    const stateBack = await waitFor("state");
    check(
      "state: сохранение и рассылка работают",
      (stateBack.payload.state?.stations?.length ?? 0) === (current.stations?.length ?? 0),
      `станций=${stateBack.payload.state?.stations?.length}`,
    );

    // ---- Устойчивость ----
    send({ kind: "что-то-неизвестное" });
    send({ kind: "logout" });
    const presence3 = await waitFor("presence");
    check(
      "logout: пользователь ушёл из presence",
      !(presence3.payload.users ?? []).some((u) => u.session === hello.payload?.user?.session),
      "",
    );

    // ---- После выхода график не сохраняется ----
    send({ kind: "state", state: current });
    const afterLogout = await waitFor("forbidden", 6000).catch(() => null);
    check("доступ: после выхода график не сохраняется", !!afterLogout, afterLogout?.payload?.message ?? "");
  } catch (e) {
    check("проверка не упала с ошибкой", false, e.message);
  }

  ws.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\nИтог: ${checks.length - failed.length}/${checks.length} проверок пройдено`);
  process.exit(failed.length ? 1 : 0);
});

setTimeout(() => {
  console.error("Превышено общее время ожидания");
  process.exit(1);
}, 60000);
