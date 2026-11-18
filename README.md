# Ventas Online Segura

Migración del sistema PHP «Sistemas de ventas en línea» (Furniture Investment) a una arquitectura cloud-native con controles de seguridad.
El análisis de los hallazgos del sistema anterior y su correspondencia con cada control está en `ANALISIS_MIGRACION.md`. El pipeline, el WAF y el SIEM se describen en `docs/DEVSECOPS.md`.

## Stack

| Capa | Tecnología |
|---|---|
| Aplicación | Next.js 16 (App Router, Server Components, Server Actions), React 19, TypeScript estricto |
| Identidad | Better Auth 1.7: verificación de correo, roles, 2FA TOTP obligatorio para administradores, rate limiting |
| Datos | Drizzle ORM + MySQL 8.4 (local: MariaDB 10.4 de XAMPP), consultas parametrizadas |
| Validación | Zod 4 |
| Estilos | Tailwind CSS 4 |
| Pagos | PayPal Orders v2 por flujo de redirección, servidor a servidor (o modo `simulado` para laboratorio) |
| Infraestructura | Docker, Nginx + ModSecurity OWASP CRS, Terraform AWS (ALB + WAFv2, ECS Fargate, RDS con KMS, Secrets Manager, S3, CloudWatch) |
| CI/CD | GitHub Actions: Semgrep, Gitleaks, npm audit/OSV, SBOM, Checkov, Trivy y OWASP ZAP |
| Observabilidad | OpenTelemetry (WAF con `ngx_otel_module` y app con `@vercel/otel` + mysql2) → OTel Collector (saneo) → Jaeger |

## Controles principales

| Control | Archivo |
|---|---|
| CSP estricta con nonce por solicitud y cabeceras de seguridad | `src/proxy.ts`, `next.config.ts` |
| Autorización en el servidor; admin requiere rol y 2FA | `src/lib/session.ts`, `src/app/admin/layout.tsx` |
| Rate limiting persistente por IP y por cuenta | `src/lib/rate-limit.ts` |
| DPI cifrado con AES-256-GCM e índice HMAC | `src/lib/crypto.ts` |
| Precios calculados en el servidor y verificación del pago contra PayPal | `src/lib/ordenes.ts`, `src/lib/paypal.ts` |
| Carrito en cookie HttpOnly firmada con HMAC | `src/lib/carrito.ts` |
| Bitácora de auditoría encadenada con HMAC y eventos JSON para el SIEM | `src/lib/audit.ts`, `src/lib/logger.ts` |
| Carga de imágenes validada por magic bytes, con nombre UUID y fuera de `/public` | `src/lib/uploads.ts` |
| Configuración validada al arrancar; ningún secreto en el código | `src/lib/env.ts` |

## Ejecución local en Windows con XAMPP (sin Docker)

1. Inicie MySQL desde el panel de XAMPP.
2. Como `root`, cree la base de datos y los usuarios de mínimo privilegio. Use sus propias contraseñas:
   ```sql
   CREATE DATABASE ventas_segura CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'ventas_app'@'localhost' IDENTIFIED BY '...';
   GRANT SELECT, INSERT, UPDATE, DELETE ON ventas_segura.* TO 'ventas_app'@'localhost';
   CREATE USER 'ventas_migrator'@'localhost' IDENTIFIED BY '...';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES ON ventas_segura.* TO 'ventas_migrator'@'localhost';
   CREATE USER 'legado_lectura'@'localhost' IDENTIFIED BY '...';
   GRANT SELECT ON fornitureinvestment.* TO 'legado_lectura'@'localhost';
   ```
3. Copie `.env.example` a `.env.local` y complete los valores. Para generar las claves:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
4. Instale y prepare la base de datos:
   ```bash
   npm install
   npm run db:migrate:local                         # aplica migraciones con el usuario DDL de .env.local
   npm run db:migrar-legado                         # importa catálogo, clientes y compras del sistema PHP
   npm run admin:crear -- admin@sudominio.com "Nombre Apellido"
   npm run dev
   ```
5. Abra http://localhost:3000. Con el primer ingreso, el administrador debe activar 2FA antes de poder entrar a `/admin`.

Sin SMTP configurado, los enlaces de activación y de recuperación se imprimen en la consola de `npm run dev`.

### Notas de la migración de datos

- Las contraseñas bcrypt del sistema anterior no se migran. Cada cliente define una nueva desde «¿Olvidó su contraseña?».
- El inicio de sesión ahora es con correo electrónico, no con nombre de usuario.
- La tabla `admin` no se migra. El administrador se crea de nuevo con `admin:crear`.
- Las credenciales de SMTP y PayPal que estaban en la tabla `configuracion` ya no viven en la base de datos. Ahora son variables de entorno.
- Las compras cuyo cliente ya no existe en el sistema anterior se omiten y aparecen contadas en el resumen del script.

## Inicio rápido: laboratorio y Centro de pruebas

Requisitos: Docker Desktop, Node 22 y Git.

```bash
git clone -b proyecto https://github.com/vm-exe/Seguridad-de-Aplicaciones---TecnoMarket.git
cd Seguridad-de-Aplicaciones---TecnoMarket
npm run laboratorio
```

Ese comando genera secretos propios, construye las imágenes, migra la base de datos, carga el catálogo y crea un administrador. Luego levanta la tienda (http://localhost:8080) y Jaeger (http://localhost:16686), y abre el **Centro de pruebas** (http://127.0.0.1:4000): los 17 laboratorios de seguridad con un botón «Ejecutar», salida en vivo, veredicto contra el resultado esperado e historial de auditoría.

Otros comandos: `npm run monitor` (solo el panel), `npm run laboratorio:estado`, `npm run laboratorio:apagar` y `npm run laboratorio:borrar`. Detalle en `docs/LABORATORIOS.md` §0.

## Laboratorio con Docker (cloud-native)

Arquitectura: WAF (Nginx + ModSecurity + OWASP CRS) → app sin privilegios → MySQL 8.4 en red interna. Solo el WAF publica un puerto. La evidencia de las pruebas y del afinamiento del WAF está en `docs/EVIDENCIA_LABORATORIO.md`. **El paso a paso de todos los laboratorios** (WAF, SAST, SCA, secretos, Trivy, IaC, ZAP, nmap y Burp), con resultados esperados, está en `docs/LABORATORIOS.md`.

```bash
cp .env.docker.example .env.docker      # completar los secretos
docker compose --profile migrate --profile tareas build
docker compose up -d db
docker compose --profile migrate run --rm migrate
docker compose --profile tareas run --rm tareas npx tsx --conditions=react-server scripts/seed.ts
docker compose --profile tareas run --rm -e ADMIN_PASSWORD="<frase-larga>" tareas   npx tsx --conditions=react-server scripts/crear-admin.ts admin@ejemplo.com "Nombre"
docker compose up -d app waf            # http://localhost:8080
```

El mismo `up` inicia el monitoreo. En **http://localhost:16686** (Jaeger, solo accesible desde el propio equipo) se ve el diagrama `ventas-waf → ventas-app → ventas-db (MySQL)` y el recorrido de cada solicitud: un ataque bloqueado termina en el WAF. Ver `docs/LABORATORIOS.md`, laboratorio 12.

En el laboratorio, los correos (activación y recuperación) se guardan en `reportes/correos/`. Para apagarlo todo: `docker compose down`; para borrar también los datos: `docker compose down -v`.

## Pruebas y calidad

La guía para el equipo (qué hace cada función y cómo probarla) está en `docs/GUIA_EQUIPO.md`.

```bash
npm test            # Vitest: dinero en centavos, validación, cifrado, rutas seguras
npm run test:cobertura   # con umbrales mínimos de cobertura
npm run typecheck
npm run lint
npm run auditoria:verificar   # termina con código 1 si la bitácora fue alterada
```

### Pruebas E2E (Playwright)

Se corren contra el build de producción, no contra `npm run dev`, porque la compilación bajo demanda y la recarga en caliente las vuelven inestables:

```bash
# 1) en .env.local:  MAIL_CAPTURE_DIR=./reportes/correos
npm run build
TRUST_PROXY=true ALLOW_SIMULATED_PAYMENTS=true npx next start -p 3000   # dejar abierto
# 2) en otra terminal (E2E_CHANNEL=chrome usa el Chrome instalado):
E2E_CHANNEL=chrome E2E_MAILBOX_DIR=./reportes/correos E2E_CREAR_ADMIN=1 npm run test:e2e
npx playwright show-report
npm run e2e:limpiar   # borra usuarios @e2e.test y productos de prueba
```

## Scripts

| Script | Uso |
|---|---|
| `db:generate` / `db:migrate` (`:local` lee `.env.local`) | Genera y aplica migraciones con Drizzle Kit, usando `MIGRATOR_DATABASE_URL` |
| `db:seed` | Datos de ejemplo para un entorno vacío |
| `db:migrar-legado` | Importa los datos de `fornitureinvestment` |
| `admin:crear` | Crea un administrador o promueve uno existente |
| `auditoria:verificar` | Verifica la integridad de la cadena de auditoría |
| `pagos:conciliar` | Concilia órdenes pendientes con PayPal: finaliza, reembolsa o cancela |
| `test:e2e` / `e2e:limpiar` | Suite Playwright y limpieza de sus datos |
| `db:migrate:local` / `db:generate:local` | Migraciones leyendo `.env.local` |
