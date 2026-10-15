# ---------- 1. Сборка Next.js ----------
FROM node:20-alpine AS web
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# ВАЖНО: NEXT_PUBLIC_* подставляется в бандл на этапе сборки, поэтому
# адрес WebSocket-бэкенда передаётся именно сюда, а не в environment.
ARG NEXT_PUBLIC_WS_URL=ws://127.0.0.1:3001/ws
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}

RUN npm run build
RUN npx esbuild server.ts --outfile=dist/server.cjs --platform=node --format=cjs --target=node20
RUN npm prune --production

# ---------- 2. Сборка Rust-бэкенда ----------
FROM rust:1-alpine AS api
RUN apk add --no-cache musl-dev pkgconfig openssl-dev
WORKDIR /build

# Сначала только манифест — зависимости кешируются отдельно от кода.
COPY backend/Cargo.toml backend/Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && \
    cargo build --release && rm -rf src

COPY backend/src ./src
# Подставляем настоящий main.rs — touch обходит кеш зависимостей.
RUN touch src/main.rs && cargo build --release

# ---------- 3. Рантайм ----------
FROM alpine:3.20 AS runner
RUN apk add --no-cache nodejs npm libstdc++ && \
    addgroup -S nodejs && adduser -S nextjs -G nodejs

WORKDIR /app

# data_host задан здесь, а не только в docker-compose, намеренно: переменная
# из ENV образа переживает потерю блока environment:, который Dokploy
# подменяет своими значениями. Без неё оба процесса идут в localhost:5432
# внутри контейнера, где базы нет, и контейнер падает с 502.
ENV NODE_ENV=production \
    PORT=3000 \
    BACKEND_PORT=3001 \
    HOSTNAME=0.0.0.0 \
    BACKEND_HOST=0.0.0.0 \
    data_host=db

# Фронтенд от Next.js
COPY --from=web /app/public ./public
COPY --from=web /app/.next ./.next
COPY --from=web /app/dist ./dist
COPY --from=web /app/node_modules ./node_modules
COPY --from=web /app/package.json ./package.json

# Логика, БД и WebSocket — из Rust
COPY --from=api /build/target/release/gid-backend ./gid-backend

USER nextjs
EXPOSE 3000 3001

# Оба процесса: фронтенд на 3000, бэкенд на 3001.
# Фронтенд ходит в бэкенд по адресу из NEXT_PUBLIC_WS_URL.
CMD ["sh", "-c", "./gid-backend & node dist/server.cjs"]
