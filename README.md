# ГИД Урал-ВНИИЖТ

График исполненного движения поездов участка. Фронтенд — Next.js (React),
логика, PostgreSQL и WebSocket — Rust-бэкенд (`backend/`).

## Требования

- Node.js 20.9+
- PostgreSQL (параметры подключения — в `.env.local`)
- Rust / Cargo — для бэкенда

## Запуск в разработке

Нужны и фронтенд, и бэкенд. Одной командой:

```bash
npm install
npm run dev:rust
```

Откройте http://localhost:3000 и войдите логином и паролем администратора
(по умолчанию — из `.env.local`: `admin_login` / `admin_password`).

Или по отдельности, в двух терминалах:

```bash
npm run dev          # Next.js + прокси /ws → Rust, порт 3000
npm run backend:dev  # Rust-бэкенд, порт 3001
```

## Переменные окружения

Пример — `.env.example`. Локальный файл `.env.local` не коммитится.

## Тесты

```bash
npm run backend:test       # протокол: нужны GID_LOGIN/GID_PASSWORD (учётка ДНЦ)
npm run backend:test:auth  # вход и права: нужны admin_login/admin_password
```

## Сборка и запуск в продакшне

```bash
npm run build   # next build + сборка server.ts в dist/server.cjs
npm start       # node dist/server.cjs
```

Развёртывание через Dokploy — в `DEPLOY.md`.
