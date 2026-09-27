# ---------- 1. Зависимости и Сборка ----------
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat python3 make g++ # Для нативных модулей pg если нужно
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Копируем исходники
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# Собираем Next.js
RUN npm run build

# Транспилируем наш server.ts в dist/server.cjs
# Важно: esbuild должен быть установлен как devDependency
RUN npx esbuild server.ts --outfile=dist/server.cjs --platform=node --format=cjs --target=node20

# Удаляем devDependencies чтобы уменьшить финальный слой (опционально, но рекомендуется)
RUN npm prune --production

# ---------- 2. Рантайм ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Создаем пользователя
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# Копируем ВСЕ необходимое из стадии сборки
# public assets
COPY --from=builder /app/public ./public
# Next.js build artifacts (.next/static, .next/server, etc.)
COPY --from=builder /app/.next ./.next
# Наш собранный сервер
COPY --from=builder /app/dist ./dist
# node_modules (уже очищены от dev-deps)
COPY --from=builder /app/node_modules ./node_modules
# package.json (для проверки версий)
COPY --from=builder /app/package.json ./package.json

USER nextjs
EXPOSE 3000

# Запускаем именно наш компилированный файл
CMD ["node", "dist/server.cjs"]
