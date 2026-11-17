# Evidencia del laboratorio contenerizado (Fases 4, 5 y 6)

**Fecha:** 16/11/2026.

**Entorno:**
- Docker Desktop 29.9 en Windows 11.
- La aplicación construida desde este repositorio.
- MySQL 8.4 en red interna, sin puertos publicados.
- Nginx + ModSecurity 3.0.17 + OWASP CRS 4.25.2 (paranoia 2) como única entrada, en `localhost:8080`.

Este laboratorio reemplaza el despliegue en la nube, que no fue posible con cuentas gratuitas. Reproduce la misma arquitectura: WAF → aplicación sin privilegios → base de datos aislada. La infraestructura cloud equivalente se entrega como código (`infra/terraform/aws/`) validado con Checkov.

## 1. Cómo reproducirlo

```bash
cp .env.docker.example .env.docker          # completar los secretos (ver README)
docker compose --profile migrate --profile tareas build
docker compose up -d db
docker compose --profile migrate run --rm migrate                                      # migraciones (usuario DDL)
docker compose --profile tareas run --rm tareas npx tsx --conditions=react-server scripts/seed.ts
docker compose --profile tareas run --rm -e ADMIN_PASSWORD='<frase-larga>' tareas \
  npx tsx --conditions=react-server scripts/crear-admin.ts admin@ejemplo.com "Nombre"
docker compose up -d app waf                                                           # http://localhost:8080
```

- Los correos de activación y recuperación quedan como JSON en `reportes/correos/`, porque `MAIL_CAPTURE_DIR` está activado para el laboratorio.
- Las tareas administrativas corren en el contenedor `tareas`, dentro de la red interna, porque la base de datos no se expone al host.

## 2. Aislamiento de red

| Prueba | Resultado |
|---|---|
| `docker compose ps` | Solo `ventas-waf` publica un puerto (`0.0.0.0:8080`); `ventas-app` (3000) y `ventas-db` (3306) no |
| `curl http://localhost:3000` | Sin respuesta: la app no es alcanzable sin pasar por el WAF |
| Red `backend` | `internal: true`: la base de datos no tiene salida a internet |
| Contenedor de la app | `read_only`, `cap_drop: ALL`, `no-new-privileges`, usuario uid 1001 |

## 3. El WAF bloquea ataques (caja negra)

| Ataque | Petición | Respuesta | Reglas CRS que dispararon |
|---|---|---|---|
| SQLi booleana | `GET /tienda?q=' OR 1=1--` | **403** | 942100 (libinjection), 942130, 942180, 942330, 942390 (puntaje 25) |
| SQLi UNION en formulario | `POST /registro` con `nombres=x' UNION SELECT password FROM user--` | **403** | 942100, 942190, 942200, 942260, 942270, 942480 (puntaje 30) |
| XSS almacenado | `POST /registro` con `nombres=<script>alert(1)</script>` | **403** | 941100 (libinjection), 941110, 941160, 941320, 941390 |
| Inyección de comandos | `GET /tienda?q=;cat /etc/passwd` | **403** | familia 932xxx |
| *Path traversal* | `GET /api/imagenes/..%2F..%2F..%2Fetc%2Fpasswd` | **400** | Rechazado por nginx y por la validación de la app |
| Escáner automatizado | `User-Agent: sqlmap/1.8` | **403** | Regla propia 1100 |
| *Open redirect* / RFI | `GET /login?next=https://evil.example` | **403** | 931130 (RFI fuera de dominio); además la app ignora destinos externos |
| Fuerza bruta en el login | 20 POST seguidos a `/login` | 6× **200**, luego **429** | `limit_req` zona `auth_ui` (10/min, ráfaga 5) |
| Content-Type no permitido | `POST /checkout` `text/plain` sin `Next-Action` | **403** | 920420 |
| CSRF a Server Action | `POST /registro` con `Origin: https://evil.example` | **Rechazado** | Next.js compara `Origin` con `X-Forwarded-Host` («Invalid Server Actions request») |

## 4. Afinamiento del WAF: falsos positivos encontrados y corregidos

Este es el ciclo normal de puesta en producción de un WAF: se observan los bloqueos legítimos en el log de auditoría (JSON) y se aplica la **exclusión mínima**, es decir, la regla mínima, para el campo mínimo y en la ruta mínima.

| # | Síntoma | Causa (evidencia en el log) | Corrección | Archivo |
|---|---|---|---|---|
| FP-002 | Registro e inicio de sesión legítimos bloqueados (403, puntaje 13-28) | Next.js envía campos internos `_1_$ACTION_1:0 = {"id":"…","bound":"$@1"}` y `0 = [{},"$K1"]`, y su JSON dispara 942200, 942340 y 942430 | `SecRuleUpdateTargetByTag` excluye solo los campos `$ACTION_*` y los numéricos de las familias SQLi/genéricas. Los campos del usuario se siguen inspeccionando (la SQLi en `nombres` sigue dando 403) | `RESPONSE-999-…AFTER-CRS.conf` |
| FP-003 | Una contraseña robusta podía ser bloqueada | Frases con `'`, `--` u `or` disparan las reglas 942xxx | Se excluyen de las reglas SQLi solo los campos `password`/`actual`; nunca llegan al SQL (se hashean) | `RESPONSE-999-…AFTER-CRS.conf` |
| FP-004 | El botón «Pagar» se bloqueaba (403) | Una Server Action sin campos se envía como `text/plain` (regla 920420) | `text/plain` se permite **solo** con la cabecera `Next-Action` | `REQUEST-900-…BEFORE-CRS.conf` (regla 1000) |
| FP-005 | Todas las Server Actions fallaban con un 500 en la app | nginx enviaba `X-Forwarded-Host: localhost` (sin puerto) y Next.js lo rechazaba frente al `Origin: localhost:8080`, como posible CSRF | `X-Forwarded-Host $http_host` (conserva el puerto). La protección CSRF de Next sigue activa: un `Origin` ajeno se rechaza | `nginx/default.conf.template` |
| FP-006 | 429 a usuarios legítimos al pagar | La precarga de enlaces de Next.js (`?_rsc=`) superaba la ráfaga de 40 de la zona general | Los archivos estáticos `/_next/static` quedan sin límite y la zona general sube a 30/s con ráfaga de 150. El límite estricto de autenticación se mantiene | `nginx/*.template` |
| HDR-1 | Cabeceras de seguridad duplicadas, con HSTS contradictorio | nginx y la app las emitían a la vez | El WAF oculta las de la app y emite una sola versión canónica | `nginx/default.conf.template` |
| HDR-2 | ZAP: «CSP no definida» en las respuestas 403 | Las páginas de bloqueo las genera el WAF, no la app | CSP restrictiva de respaldo **solo** cuando la respuesta no trae una (`map $upstream_http_content_security_policy`) | `nginx/*.template` |
| HC-1 | WAF marcado como *unhealthy* | El healthcheck de la imagen consulta `https://:8443` y aquí solo hay HTTP en 8080 | Healthcheck propio en `docker-compose.yml` | `docker-compose.yml` |

**Lección para el informe.** Activar el CRS en paranoia 2 sin afinarlo **rompía la aplicación** (FP-002, FP-004 y FP-005). Un WAF sin pruebas funcionales de punta a punta genera dos riesgos: falsos positivos que tumban el negocio, o la tentación de desactivarlo. Las pruebas E2E a través del WAF son las que detectaron cada caso.

## 5. DAST con OWASP ZAP (baseline, caja negra)

```bash
docker run --rm -v "$(pwd)/reportes/zap:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://host.docker.internal:8080 -c rules.tsv -r zap-baseline.html -J zap-baseline.json -a -j
```

| Corrida | FAIL | WARN | PASS | Reporte |
|---|---|---|---|---|
| Antes del afinamiento | 1 (CSP ausente en las páginas 403 del WAF) | 6 | 63 | `reportes/zap/zap-baseline-antes-ajustes.html` |
| **Después del afinamiento** | **0** | 6 | **64** | `reportes/zap/zap-baseline.html` |

Las seis advertencias restantes se aceptan, cada una con su justificación:

| Alerta ZAP | Justificación |
|---|---|
| 10031 User Controllable HTML Element Attribute | El término de búsqueda se refleja en el `value` del input, pero React lo escapa. Además, el WAF bloquea los *payloads* y la CSP con *nonce* impide ejecutar scripts inyectados |
| 10094 Base64 Disclosure | Son el *nonce* de la CSP y la carga serializada de React Server Components; no son datos sensibles |
| 10111 Authentication Request Identified | Informativa: ZAP reconoce el formulario de login |
| 10202 Absence of Anti-CSRF Tokens | Las Server Actions de Next.js validan `Origin` contra el host (probado: un `Origin` ajeno se rechaza) y las *cookies* de sesión son `SameSite=Lax`. Better Auth valida `trustedOrigins`. Esta defensa por verificación de origen es equivalente a un token anti-CSRF y la acepta OWASP |
| 90004 Cross-Origin-Embedder-Policy ausente | Solo se necesita para usar `SharedArrayBuffer`. La app no lo usa y ya envía COOP y CORP |
| 90005 Sec-Fetch-Dest ausente | Es una cabecera de *petición* que ZAP no envía; no depende del servidor |

## 6. Pruebas funcionales a través del WAF (Playwright)

```bash
E2E_CHANNEL=chrome E2E_BASE_URL=http://localhost:8080 E2E_MAILBOX_DIR=./reportes/correos npx playwright test e2e/cabeceras.spec.ts
E2E_CHANNEL=chrome E2E_BASE_URL=http://localhost:8080 E2E_MAILBOX_DIR=./reportes/correos npx playwright test e2e/compra.spec.ts -g stock
```

| Prueba | Resultado |
|---|---|
| Cabeceras, CSP con *nonce*, *health*, rutas privadas, *path traversal* (5) | Aprobadas |
| Registro → login bloqueado sin verificar → verificación por correo → login | Aprobada |
| Mensaje genérico (anti-enumeración) y contraseña débil rechazada | Aprobadas |
| IDOR en pedidos (404) y *cookie* de carrito alterada | Aprobadas |
| Compra con doble aprobación simultánea: el stock se descuenta **una** vez | Aprobada |

**Nota sobre límites de tasa.** Detrás del WAF todas las pruebas llegan con la **misma IP**, así que se activan a la vez:
- el límite de nginx: 10 POST de autenticación por minuto;
- los límites de la app: 5 registros por hora y 10 logins cada 5 minutos por IP.

Correr la suite completa de seguido produce 429 o «Demasiados intentos», es decir, los controles funcionando. Por eso el pipeline de CI corre la suite completa contra la app directamente (job `e2e`) y, detrás del WAF, solo DAST. Para repetir pruebas en el laboratorio, reinicie los contadores:

```bash
"DELETE FROM rate_limit;" | docker exec -i ventas-db sh -c 'MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysql -uroot ventas_segura'
```

## 7. Integridad y limpieza

- `scripts/verificar-auditoria.ts` en el contenedor `tareas` → `OK: 17 eventos íntegros`.
- `scripts/limpiar-e2e.ts` → borra los usuarios `@e2e.test` creados por las pruebas.
