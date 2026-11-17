# syntax=docker/dockerfile:1.7
# =============================================================================
# Imagen de producción - Ventas Online Segura (Next.js 16, output standalone)
# Controles: multi-stage, imagen base mínima fijada, usuario no-root,
# sin secretos en capas, compatible con read-only rootfs, HEALTHCHECK.
# Recomendación: fijar también por digest (node:22.20-alpine3.22@sha256:...)
# =============================================================================
# Imagen base: node:22.20-alpine3.22 (fijada; actualizar con Dependabot/Renovate)

# ---------- 1) Dependencias (incluye devDependencies para compilar) ----------
FROM node:22.20-alpine3.22 AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
# --ignore-scripts mitiga ataques de cadena de suministro vía postinstall
RUN npm ci --ignore-scripts --no-audit --no-fund

# ---------- 2) Build ----------
FROM node:22.20-alpine3.22 AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build \
 && npm prune --omit=dev --ignore-scripts

# ---------- 3) Job de migraciones (drizzle-kit) ----------
# Se usa sólo por el servicio "migrate"; contiene drizzle-kit (devDependency).
FROM node:22.20-alpine3.22 AS migrator
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src/db ./src/db
USER node
CMD ["npm", "run", "db:migrate"]

# ---------- 4) Runtime ----------
FROM node:22.20-alpine3.22 AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=/data/uploads

# Parches del SO base y usuario sin privilegios
RUN apk upgrade --no-cache \
 && addgroup -S -g 1001 nodejs \
 && adduser -S -u 1001 -G nodejs nextjs \
 && mkdir -p /data/uploads \
 && chown -R nextjs:nodejs /data

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Eliminar npm/yarn del runtime: reduce superficie de ataque (no se usan)
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn*

USER nextjs
EXPOSE 3000
VOLUME ["/data/uploads"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
