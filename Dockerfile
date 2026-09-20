# ============================================================================
#  Fina Local · imagen unica que sirve la API y el frontend compilado.
#  Construir:  docker build -t fina-local .
# ============================================================================

# ── 1. Dependencias ─────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci && mkdir -p apps/api/node_modules apps/web/node_modules

# ── 2. Compilacion ──────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
RUN npm run build --workspace=apps/api \
 && npm run build --workspace=apps/web \
 && mkdir -p apps/api/publico \
 && cp -r apps/web/dist/. apps/api/publico/

# ── 3. Dependencias de produccion ───────────────────────────────────────────
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Los workspaces elevan casi todo a /app/node_modules; los directorios por
# paquete se crean vacios para que el COPY de la etapa final nunca falle.
RUN npm ci --omit=dev && mkdir -p apps/api/node_modules

# ── 4. Imagen final ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app/apps/api

RUN apk add --no-cache tini curl \
 && addgroup -S fina && adduser -S fina -G fina

ENV NODE_ENV=production
ENV PORT=4000

COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build /app/apps/api/dist       ./dist
COPY --from=build /app/apps/api/migrations ./migrations
COPY --from=build /app/apps/api/publico    ./publico
COPY apps/api/package.json ./package.json

USER fina
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS http://127.0.0.1:${PORT}/api/salud || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
