// Проверка входа по учётной записи и управления сотрудниками.
//   node backend/auth-check.mjs ws://127.0.0.1:3001/ws
//
// Пароль первого администратора берётся из GID_ADMIN_PASSWORD /
// GID_ADMIN_LOGIN — тех же переменных, что и у сервера.

import WebSocket from "ws";

const URL = process.argv[2] || "ws://127.0.0.1:3001/ws";
const ADMIN_LOGIN = process.env.GID_ADMIN_LOGIN || "";
const ADMIN_PASSWORD = process.env.GID_ADMIN_PASSWORD || "";

if (!ADMIN_LOGIN || !ADMIN_PASSWORD) {
  console.error("Задайте GID_ADMIN_LOGIN и GID_ADMIN_PASSWORD — те же, что у сервера.");
  process.exit(2);
}

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok });
  console.log(`${ok ? "  OK  " : " FAIL "} ${name}${detail ? " — " + detail : ""}`);
}

/** Простой клиент с очередью входящих сообщений. */
function connect(url) {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];

  ws.on("message", (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      inbox.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].kind === m.kind) {
          waiters.splice(i, 1)[0].resolve(m);
        }
      }
    } catch {
      /* не наше */
    }
  });

  const wait = (kind, ms = 8000) => {
    const found = inbox.find((m) => m.kind === kind);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`не дождались ${kind}`)), ms);
      waiters.push({ kind, resolve: (v) => { clearTimeout(t); resolve(v); } });
    });
  };

  // Перед каждым действием очередь очищаем, иначе wait вернёт
  // старое сообщение того же вида и проверка будет ложной.
  const send = (obj) => {
    inbox.length = 0;
    ws.send(JSON.stringify(obj));
  };

  const open = new Promise((r) => ws.on("open", r));

  return { ws, wait, send, open, clear: () => { inbox.length = 0; } };
}

async function main() {
  console.log(`Подключение: ${URL}\nПервый админ: ${ADMIN_LOGIN}\n`);

  // ---- 1. Неверный пароль отклоняется ----
  const bad = connect(URL);
  await bad.open;
  bad.send({ kind: "login", login: ADMIN_LOGIN, password: "точно-неверный" });
  const badErr = await bad.wait("authError").catch(() => null);
  check(
    "неверный пароль отклонён",
    !!badErr,
    badErr ? badErr.message : "ответа нет"
  );
  bad.ws.close();

  // ---- 2. Неизвестный логин даёт тот же ответ, что и неверный пароль ----
  const unknown = connect(URL);
  await unknown.open;
  unknown.send({ kind: "login", login: "нетакого-сотрудника", password: "любой" });
  const unknownErr = await unknown.wait("authError").catch(() => null);
  check(
    "неизвестный логин неотличим от неверного пароля",
    !!unknownErr && !!badErr && unknownErr.message === badErr.message,
    unknownErr ? unknownErr.message : "ответа нет"
  );
  unknown.ws.close();

  // ---- 3. Верный логин и пароль пускают ----
  const admin = connect(URL);
  await admin.open;
  admin.send({ kind: "login", login: ADMIN_LOGIN, password: ADMIN_PASSWORD });
  const ok = await admin.wait("loginOk").catch(() => null);
  check(
    "вход по логину и паролю состоялся",
    !!ok && !!ok.user?.session,
    ok ? `сессия ${String(ok.user.session).slice(0, 12)}…` : "входа нет"
  );

  const caps = await admin.wait("capabilities").catch(() => null);
  const capList = caps?.caps ?? [];
  check(
    "администратору выданы все права",
    !!caps?.isAdmin && capList.includes("users.manage_roles"),
    `прав: ${capList.length}`
  );

  // ---- 4. Роль приходит с сервера, а не выбирается клиентом ----
  check(
    "роль взята с сервера",
    ok?.user?.role === "admin",
    `роль=${ok?.user?.role}`
  );

  // ---- 5. Попытка входа с чужой ролью игнорируется ----
  const sneaky = connect(URL);
  await sneaky.open;
  sneaky.send({
    kind: "login",
    login: ADMIN_LOGIN,
    password: ADMIN_PASSWORD,
    role: "dnc",       // клиент пытается «назначить» себе роль
    isAdmin: false,
  });
  const sneakyOk = await sneaky.wait("loginOk").catch(() => null);
  check(
    "клиент не может назначить себе роль",
    !!sneakyOk && sneakyOk.user.role === "admin",
    `сервер вернул роль=${sneakyOk?.user?.role}`
  );
  sneaky.ws.close();

  // ---- 6. Админ заводит сотрудника-ДСП ----
  const login = `дежурный_${Date.now().toString(36)}`;
  admin.send({
    kind: "accountCreate",
    login,
    name: "Дежурный Тестовый",
    password: "parol123",
    role: "dsp",
  });
  const created = await admin.wait("accounts").catch(() => null);
  const found = (created?.accounts ?? []).find((a) => a.login === login);
  check("сотрудник заведён", !!found, found ? `роль=${found.role}` : "нет в списке");
  check(
    "хеш пароля наружу не отдаётся",
    !!found && !("passwordHash" in found) && !JSON.stringify(found).includes("$argon2"),
    ""
  );

  // ---- 7. Новый сотрудник входит и получает минимум прав ----
  const dsp = connect(URL);
  await dsp.open;
  dsp.send({ kind: "login", login, password: "parol123" });
  const dspOk = await dsp.wait("loginOk").catch(() => null);
  check("новый сотрудник вошёл", !!dspOk, dspOk ? `роль=${dspOk.user.role}` : "нет входа");

  const dspCaps = await dsp.wait("capabilities").catch(() => null);
  const dspList = dspCaps?.caps ?? [];
  check(
    "у ДСП только отметки и статистика",
    dspList.includes("trains.mark") &&
      dspList.includes("stats.view") &&
      !dspList.includes("users.manage_roles") &&
      !dspList.includes("alerts.manage"),
    `прав: ${dspList.length}`
  );

  // ---- 8. ДСП не может завести учётную запись ----
  dsp.send({ kind: "accountCreate", login: "сам_себе", name: "X", password: "parol123", role: "admin" });
  const denied = await dsp.wait("forbidden").catch(() => null);
  check("ДСП не может заводить учётные записи", !!denied, denied?.message ?? "нет отказа");

  // ---- 9. Неверный пароль при смене своего пароля ----
  dsp.send({ kind: "passwordChange", current: "неверный", next: "novyyparol" });
  const deniedPw = await dsp.wait("authError").catch(() => null);
  check("смена пароля требует верный текущий", !!deniedPw, deniedPw?.message ?? "нет отказа");

  // ---- 10. Смена своего пароля и вход по новому ----
  dsp.send({ kind: "passwordChange", current: "parol123", next: "novyyparol" });
  await dsp.wait("notice").catch(() => null);
  dsp.ws.close();

  const again = connect(URL);
  await again.open;
  again.send({ kind: "login", login, password: "novyyparol" });
  const reOk = await again.wait("loginOk").catch(() => null);
  check("вход по изменённому паролю", !!reOk, "");

  // ---- 11. Старый пароль больше не работает ----
  const oldPw = connect(URL);
  await oldPw.open;
  oldPw.send({ kind: "login", login, password: "parol123" });
  const oldErr = await oldPw.wait("authError").catch(() => null);
  check("старый пароль отклонён", !!oldErr, oldErr?.message ?? "");
  oldPw.ws.close();

  // ---- 12. Админ повышает сотрудника до ДНЦ ----
  admin.send({ kind: "accountPatch", login, role: "dnc" });
  const patched = await admin.wait("accounts").catch(() => null);
  const nowDnc = (patched?.accounts ?? []).find((a) => a.login === login);
  check("роль повышена до ДНЦ", nowDnc?.role === "dnc", `роль=${nowDnc?.role}`);

  // ---- 13. Владелец неприкосновенен: отключить нельзя ----
  admin.send({ kind: "accountPatch", login: ADMIN_LOGIN.toLowerCase(), active: false });
  const keepAdmin = await admin.wait("authError").catch(() => null);
  check(
    "владельца отключить нельзя",
    !!keepAdmin && /защищ/.test(keepAdmin.message ?? ""),
    keepAdmin?.message ?? "отсутствует защита"
  );

  // ---- 14. Отключение сотрудника выкидывает его из сеанса ----
  const kicked = Promise.race([
    new Promise((r) => again.ws.on("close", () => r(true))),
    new Promise((r) => setTimeout(() => r(false), 8000)),
  ]);
  admin.send({ kind: "accountPatch", login, active: false });
  const deactivated = await admin.wait("accounts").catch(() => null);
  const off = (deactivated?.accounts ?? []).find((a) => a.login === login);
  check("сотрудник помечен неактивным", off && off.active === false, `active=${off?.active}`);
  check("отключённый сотрудник отключается от сервера", (await kicked) === true, "");

  // ---- 15. Отключённого больше не пускает ----
  const blocked = connect(URL);
  await blocked.open;
  blocked.send({ kind: "login", login, password: "novyyparol" });
  const blockedErr = await blocked.wait("authError").catch(() => null);
  check("отключённый не входит", !!blockedErr, blockedErr?.message ?? "");
  blocked.ws.close();

  // ---- 16. Назначение администратора через панель ----
  const alogin = `admin_${Date.now().toString(36)}`;
  admin.send({
    kind: "accountCreate",
    login: alogin,
    name: "Админ Тестовый",
    password: "adminparol123",
    role: "admin",
  });
  const acreated = await admin.wait("accounts").catch(() => null);
  const afound = (acreated?.accounts ?? []).find((a) => a.login === alogin);
  check(
    "администратор заведён через панель",
    !!afound && afound.role === "admin" && afound.protected === false,
    afound ? `роль=${afound.role}, protected=${afound.protected}` : "нет в списке"
  );

  // ---- 17. Вход назначенного администратора ----
  const adm2 = connect(URL);
  await adm2.open;
  adm2.send({ kind: "login", login: alogin, password: "adminparol123" });
  const adm2Ok = await adm2.wait("loginOk").catch(() => null);
  check("назначенный админ вошёл", !!adm2Ok, "");
  const adm2Caps = await adm2.wait("capabilities").catch(() => null);
  check(
    "у назначенного админа есть управление ролями",
    (adm2Caps?.caps ?? []).includes("users.manage_roles"),
    `прав: ${(adm2Caps?.caps ?? []).length}`
  );

  // ---- 18. Назначенный админ не может тронуть владельца ----
  adm2.send({ kind: "accountPatch", login: ADMIN_LOGIN.toLowerCase(), role: "dsp" });
  const protRole = await adm2.wait("authError").catch(() => null);
  check(
    "владельца нельзя понизить",
    !!protRole && /защищ/.test(protRole.message ?? ""),
    protRole?.message ?? "нет отказа"
  );
  adm2.send({ kind: "accountSetPassword", login: ADMIN_LOGIN.toLowerCase(), password: "vzlom123456" });
  const protPw = await adm2.wait("authError").catch(() => null);
  check(
    "владельцу нельзя сбросить пароль",
    !!protPw && /защищ/.test(protPw.message ?? ""),
    protPw?.message ?? "нет отказа"
  );
  adm2.ws.close();

  // ---- 19. Матрица прав: чтение, запись, защита ----
  admin.send({ kind: "rolesList" });
  const roles0 = await admin.wait("roles").catch(() => null);
  const acts = roles0?.actions ?? [];
  const rmap = roles0?.roles ?? {};
  check(
    "матрица отдаётся: 9 действий, 3 роли",
    acts.length === 9 && !!rmap.admin && !!rmap.dnc && !!rmap.dsp,
    `действий=${acts.length}`
  );
  const dspOrig = [...(rmap.dsp ?? [])];
  admin.send({ kind: "rolesSet", role: "dsp", caps: (rmap.dsp ?? []).filter((a) => a !== "stats.view") });
  await admin.wait("notice").catch(() => null);
  admin.send({ kind: "rolesList" });
  const roles1 = await admin.wait("roles").catch(() => null);
  check(
    "право у ДСП забрано и сохранено",
    !(roles1?.roles?.dsp ?? []).includes("stats.view"),
    ""
  );
  // Возвращаем как было, чтобы не ломать остальное.
  admin.send({ kind: "rolesSet", role: "dsp", caps: dspOrig });
  await admin.wait("notice").catch(() => null);
  admin.send({ kind: "rolesList" });
  const roles2 = await admin.wait("roles").catch(() => null);
  check(
    "матрица восстановлена",
    (roles2?.roles?.dsp ?? []).includes("stats.view"),
    ""
  );
  // У админа управление ролями снять нельзя.
  admin.send({ kind: "rolesSet", role: "admin", caps: (rmap.admin ?? []).filter((a) => a !== "users.manage_roles") });
  const lockErr = await admin.wait("authError").catch(() => null);
  check(
    "у админа нельзя забрать управление ролями",
    !!lockErr,
    lockErr?.message ?? "нет отказа"
  );

  // ---- 20. Назначенного админа можно понизить и отключить ----
  admin.send({ kind: "accountPatch", login: alogin, role: "dsp" });
  const demoted = await admin.wait("accounts").catch(() => null);
  const dem = (demoted?.accounts ?? []).find((a) => a.login === alogin);
  check("назначенный админ понижен до ДСП", dem?.role === "dsp", `роль=${dem?.role}`);
  admin.send({ kind: "accountPatch", login: alogin, active: false });
  await admin.wait("accounts").catch(() => null);

  // ---- 21. Удаление учётки: создал, удалил, её больше нет ----
  const dlogin = `del_${Date.now().toString(36)}`;
  admin.send({ kind: "accountCreate", login: dlogin, name: "Удаляемый", password: "udalit123", role: "dsp" });
  await admin.wait("accounts").catch(() => null);
  admin.send({ kind: "accountDelete", login: dlogin });
  const afterDel = await admin.wait("accounts").catch(() => null);
  check(
    "учётка удалена из списка",
    !(afterDel?.accounts ?? []).some((a) => a.login === dlogin),
    ""
  );
  const goneLogin = connect(URL);
  await goneLogin.open;
  goneLogin.send({ kind: "login", login: dlogin, password: "udalit123" });
  const goneErr = await goneLogin.wait("authError").catch(() => null);
  check("удалённой учётки больше нет", !!goneErr, goneErr?.message ?? "");
  goneLogin.ws.close();

  // ---- 22. Владельца удалить нельзя ----
  admin.send({ kind: "accountDelete", login: ADMIN_LOGIN.toLowerCase() });
  const protDel = await admin.wait("authError").catch(() => null);
  check(
    "владельца удалить нельзя",
    !!protDel && /защищ/.test(protDel.message ?? ""),
    protDel?.message ?? "нет отказа"
  );

  // ---- 23. Себя удалить нельзя ----
  // alogin понижен и отключён в секции 20 — возвращаем права для проверки.
  admin.send({ kind: "accountPatch", login: alogin, role: "admin", active: true });
  await admin.wait("accounts").catch(() => null);
  const adm3 = connect(URL);
  await adm3.open;
  adm3.send({ kind: "login", login: alogin, password: "adminparol123" });
  await adm3.wait("loginOk").catch(() => null);
  adm3.send({ kind: "accountDelete", login: alogin });
  const selfDel = await adm3.wait("authError").catch(() => null);
  check(
    "себя удалить нельзя",
    !!selfDel,
    selfDel?.message ?? "нет отказа"
  );
  adm3.ws.close();
  // Чистим за собой временную учётку.
  admin.send({ kind: "accountDelete", login: alogin });
  await admin.wait("accounts").catch(() => null);

  admin.ws.close();

  const failed = checks.filter((c) => !c.ok);
  console.log(`\nИтог: ${checks.length - failed.length}/${checks.length} проверок пройдено`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("Сбой проверки:", e.message);
  process.exit(1);
});

setTimeout(() => {
  console.error("Превышено общее время ожидания");
  process.exit(1);
}, 60000);
