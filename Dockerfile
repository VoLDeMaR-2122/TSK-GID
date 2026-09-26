# ---------- 1. Зависимости (полные, для сборки) ----------
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- 2. Сборка ----------
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
# транспилируем кастомный сервер в CJS (без бандлинга next/pg/ws — они в прод-deps)
RUN npx esbuild server.ts --outfile=dist/server.cjs --platform=node --format=cjs --target=node20

# ---------- 3. Рантайм (только прод-зависимости) ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# прод-зависимости: next, react, react-dom, ws, pg
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/ ./.next/
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist

USER nextjs
EXPOSE 3000
CMD ["node", "dist/server.cjs"]
