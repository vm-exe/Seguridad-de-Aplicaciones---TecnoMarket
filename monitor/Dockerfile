# syntax=docker/dockerfile:1.7
# =============================================================================
# Centro de pruebas de seguridad (servicio "monitor" de docker-compose).
#
# - Node 22 + dependencias del proyecto (vitest, playwright). Versiones de base más nuevas que la
#   app porque esta imagen conserva npm y apt (Trivy: 0 CRITICAL/HIGH con parche disponible).
# - Chromium para las pruebas E2E.
# - Solo el CLI de Docker (sin daemon): habla con la API a través de ventas-docker-proxy,
#   nunca con el socket real.
# - Usuario sin privilegios (node, uid 1000).
# =============================================================================
FROM docker:29.9.2-cli@sha256:5e6baf67325a79f64ed3bed6863954d5e05d0f3d4e57cbdb14809346814bbfdb AS dockercli

FROM node:22.23.3-bookworm-slim@sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9
ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    MONITOR_EN_CONTENEDOR=1 \
    MONITOR_SIN_NAVEGADOR=1 \
    npm_config_update_notifier=false
WORKDIR /proyecto

COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker

# Los archivos se crean ya con el dueño "node": un chown -R posterior duplicaría en otra capa
# todo node_modules y el navegador (la imagen pasaba de ~2 GB a 5 GB).
RUN mkdir -p /ms-playwright /proyecto/reportes && chown node:node /ms-playwright /proyecto /proyecto/reportes

# Dependencias exactas del lockfile, sin scripts de instalación (.npmrc: ignore-scripts), como "node".
COPY --chown=node:node package.json package-lock.json .npmrc ./
USER node
RUN npm ci --no-audit --no-fund \
 && npx playwright install chromium \
 && npm cache clean --force

# Parches de seguridad del sistema y librerías que necesita Chromium (root solo para apt).
USER root
# Después se quita lo que el panel no usa (menos superficie y 0 CRITICAL/HIGH en Trivy):
#  - npm, npx y yarn: sus dependencias internas traen CVE; «npm audit» corre en su propio contenedor.
#  - drizzle-kit y @esbuild-kit (migraciones): binarios de esbuild compilados con un Go antiguo.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && npx playwright install-deps chromium \
 && rm -rf /var/lib/apt/lists/* \
           /proyecto/node_modules/drizzle-kit /proyecto/node_modules/@esbuild-kit \
           /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn*

COPY --chown=node:node . .
USER node
EXPOSE 4000
# Sano si el panel responde (401 sin sesión es la respuesta esperada).
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/').then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/laboratorio.mjs", "panel"]
