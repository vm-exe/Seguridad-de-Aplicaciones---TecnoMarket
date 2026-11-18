# Manual de laboratorios: WAF, SAST, SCA, secretos, contenedores, IaC, DAST y pentest

Cada laboratorio tiene esta estructura:

1. **Objetivo y fase del PDF.**
2. **Comandos** listos para copiar.
3. **Resultado esperado.** Lo obtuvimos al validar este manual el 16/11/2026; si su resultado difiere, algo cambió.
4. **Evidencia para el informe:** qué capturar para los anexos.

**Solo se necesita Docker Desktop.** Todas las herramientas corren en contenedores con su versión fijada, así que no hay que instalar Python, Semgrep, Trivy ni otras.

Los comandos están escritos para **PowerShell** y se ejecutan desde la carpeta `ventas-online-segura`; los de WAF, Semgrep y base de datos se probaron en PowerShell 5.1. En Git Bash, reemplace `${PWD}` por `$(pwd -W)` y anteponga `MSYS_NO_PATHCONV=1` a cada `docker run`.

| # | Laboratorio | Herramientas | Fase del PDF | Responsable sugerido |
|---|---|---|---|---|
| 0 | Preparación del entorno | Docker Compose | — | Todos |
| 1 | SAST | Semgrep (8 reglas propias + OWASP) | 3 | Integrante 1 |
| 2 | SCA y cadena de suministro | npm audit, OSV-Scanner, lockfile-lint | 3 | Integrante 1 |
| 3 | Secretos | Gitleaks | 3 | Integrante 1 |
| 4 | Contenedores | Trivy (imagen, SBOM) | 5 | Integrante 1 |
| 5 | Infraestructura como código | Checkov, Trivy config | 5 | Integrante 3 |
| 6 | WAF | ModSecurity + OWASP CRS, nginx | 6 | Integrante 5 |
| 7 | DAST | OWASP ZAP | 4 | Integrante 5 |
| 8 | Pentest de caja negra y gris | nmap, Burp Suite, curl | 4 | Integrante 5 |
| 9 | Pruebas funcionales de seguridad | Vitest, Playwright | 3 y 4 | Integrante 4 |
| 10 | Auditoría y SIEM | Bitácora encadenada, logs JSON | 6 | Integrante 4 |
| 11 | Pipeline CI/CD en GitHub | GitHub Actions | 3 y 5 | Integrante 1 |

---

## 0. Preparación del entorno (una vez)

**Requisitos:**
- Docker Desktop encendido. Si `docker` no se reconoce, cierre y vuelva a abrir la terminal.
- Node 22, solo para los laboratorios 2 y 9.

```powershell
cd ventas-online-segura
Copy-Item .env.docker.example .env.docker
# Edite .env.docker y reemplace cada CAMBIAR_* por un valor aleatorio. Para generar uno:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# (las contraseñas de BD deben coincidir con las de DATABASE_URL / MIGRATOR_DATABASE_URL)

docker compose --profile migrate --profile tareas build      # 3-5 min la primera vez
docker compose up -d db
docker compose --profile migrate run --rm migrate             # crea las tablas (usuario DDL)
docker compose --profile tareas run --rm tareas npx tsx --conditions=react-server scripts/seed.ts
docker compose up -d app waf
docker compose ps                                             # los 3 deben decir (healthy)
```

Abra **http://localhost:8080**. Esa es la única entrada: la app y la base de datos no publican puertos.

Crear un administrador (opcional, para los laboratorios de admin):
```powershell
docker compose --profile tareas run --rm -e ADMIN_PASSWORD="una frase larga 2026 segura" tareas `
  npx tsx --conditions=react-server scripts/crear-admin.ts admin@lab.test "Admin Lab"
```

Los correos de activación y recuperación de contraseña no se envían: quedan como JSON en `reportes/correos/`. Abra el más reciente y copie el enlace.

**Apagar:** `docker compose down`. Para borrar también la base de datos: `docker compose down -v`.

---

## 1. SAST con Semgrep

**Objetivo:** encontrar vulnerabilidades en el código fuente *antes* de ejecutarlo. Cubre la Fase 3: «Evidencia de herramientas SAST integradas».

### 1.1 Escanear el código real
```powershell
New-Item -ItemType Directory -Force reportes/sast | Out-Null
docker run --rm -v "${PWD}:/src:ro" -v "${PWD}/reportes/sast:/out" semgrep/semgrep:1.140.0 `
  semgrep scan --metrics=off --error `
  --config p/owasp-top-ten --config p/typescript --config p/react --config p/nextjs `
  --config /src/security/semgrep/reglas-ventas.yml `
  --json --output /out/semgrep.json --sarif-output=/out/semgrep.sarif /src/src /src/scripts
```
**Resultado esperado:** `Ran 88 rules on 80 files: 0 findings.` y código de salida 0.

### 1.2 Demostración: código vulnerable a propósito
Cree el archivo `reportes/lab-sast/acciones-pago-demo.tsx`. La carpeta `reportes/` está en `.gitignore`, así que no se sube a git. Contenido:

```tsx
import { sql } from "drizzle-orm";
import { db } from "@/db";

const API_SECRET_KEY = "demo-valor-ficticio-no-es-un-secreto-123"; // secreto en el código

export function Ficha({ p }: { p: { nombre: string } }) {
  return <div dangerouslySetInnerHTML={{ __html: p.nombre }} />;   // XSS
}
export async function buscar(q: string) {
  return db.execute(sql.raw("SELECT * FROM productos WHERE nombre = '" + q + "'")); // SQLi
}
export function token() { return Math.random().toString(36).slice(2); }           // token predecible
export async function pagar(req: Request) {
  const body = await req.json();
  const total = body.total;                                          // precio desde el cliente
  console.log("login", { password: body.password });                // secreto en logs
  return eval(body.codigo) + total;                                  // ejecución de código
}
```

```powershell
docker run --rm -v "${PWD}:/src:ro" semgrep/semgrep:1.140.0 semgrep scan --metrics=off `
  --config /src/security/semgrep/reglas-ventas.yml /src/reportes/lab-sast
```

**Resultado esperado: 7 hallazgos ERROR**, uno por cada regla propia:

| Línea | Regla | Hallazgo del sistema PHP que evita |
|---|---|---|
| 4 | `ventas-secreto-hardcodeado` | `KEY_TOKEN = "Tr1f0rc3&"` |
| 7 | `ventas-xss-dangerously-set-inner-html` | XSS en `detalles.php` |
| 11 | `ventas-sqli-raw-sql` | SQLi en `procesar.php` |
| 14 | `ventas-insecure-random-token` | `md5(uniqid(mt_rand()))` |
| 18 | `ventas-precio-desde-cliente` | monto del navegador en `capture.php` |
| 19 | `ventas-log-de-secretos` | — |
| 20 | `ventas-eval-o-new-function` | — |

> El valor del secreto es deliberadamente ficticio. Con una clave con formato real (p. ej. `sk_live_…` de Stripe), **GitHub Push Protection bloquea el `git push`**: nos pasó al subir este manual, y es una buena evidencia de un control de secretos del lado del proveedor.

### 1.3 Caso real para la exposición: un verdadero positivo y un falso positivo
La primera vez que corrimos Semgrep sobre el código real encontró **2 hallazgos ERROR**:
1. **Verdadero positivo:** `gcm-no-tag-length` en `src/lib/crypto.ts`. Al descifrar el DPI con AES-GCM no se fijaba la longitud de la etiqueta. Un atacante podía presentar una etiqueta truncada de 4 bytes y falsificarla con mucho menos esfuerzo.
   - **Corrección:** `authTagLength: 16` y validación de la longitud.
   - **Prueba de regresión:** `tests/crypto.test.ts`, «rechaza etiquetas GCM truncadas».
2. **Falso positivo:** la regla propia `ventas-log-de-secretos` se activó con `logger.warn("requestPasswordReset")`, porque el texto contiene *password*. Se resolvió cambiando el mensaje, **no** silenciando la regla.

Además, la regla `ventas-precio-desde-cliente` no cubría `src/lib/ordenes.ts` ni `paypal.ts`, que es donde vive la lógica de pagos. Se ampliaron sus rutas. **Lección:** las reglas SAST también deben revisarse.

**Evidencia para el informe:**
- captura de la salida de 1.1 con 0 hallazgos;
- captura de 1.2 con los 7 hallazgos;
- el archivo `reportes/sast/semgrep.sarif`.

---

## 2. SCA y cadena de suministro

**Objetivo:** encontrar dependencias de terceros con CVE conocidas y comprobar que el `package-lock.json` no fue manipulado.

```powershell
npm audit --omit=dev --omit=optional --audit-level=high
docker run --rm -v "${PWD}:/src:ro" ghcr.io/google/osv-scanner:v2.2.2 scan source --config /src/osv-scanner.toml --lockfile /src/package-lock.json
npx --yes lockfile-lint@4 --path package-lock.json --allowed-hosts npm --validate-https
```

**Resultado esperado:**
- npm audit: `found 0 vulnerabilities`.
- OSV: `No issues found`, con una vulnerabilidad aceptada en `osv-scanner.toml` (ver abajo).
- lockfile-lint: sin errores.

**Para explicar en la exposición:**
- Al construir el proyecto, `npm audit` encontró 11 vulnerabilidades, 3 de ellas críticas (`tinypool`, `better-auth`, `esbuild`). Se corrigieron actualizando versiones y con un `override`.
- `.npmrc` tiene `ignore-scripts=true`, para que ningún paquete ejecute código al instalarse.
- **Aceptación formal de un riesgo (17/11/2026).** El primer pipeline en GitHub falló porque apareció un aviso nuevo, GHSA-fc5q-39xc-vjpf: un ReDoS en `picomatch` ≤ 4.0.7, todavía sin versión corregida. Solo llega a través de herramientas de prueba (vitest/vite, que better-auth declara como dependencia *opcional*) y no entra en la imagen de producción. Por eso:
  - `npm audit` usa `--omit=optional`;
  - la excepción quedó en `osv-scanner.toml` con justificación y fecha de vencimiento (31/01/2027). Al vencer, el gate vuelve a fallar.

  Es un buen ejemplo de que un CVE nuevo puede romper un pipeline sin que cambie el código.
- Dependabot espera 7 días antes de proponer versiones nuevas (*cooldown*).

**Contraste con el sistema PHP:** PHPMailer estaba copiado a mano y no había forma de saber si tenía CVE.

---

## 3. Detección de secretos con Gitleaks

```powershell
New-Item -ItemType Directory -Force reportes/secretos | Out-Null
docker run --rm -v "${PWD}:/repo:ro" -v "${PWD}/reportes/secretos:/out" zricethezav/gitleaks:v8.28.0 `
  dir /repo --config /repo/.gitleaks.toml --no-banner --redact --report-format json --report-path /out/gitleaks.json
```

**Resultado esperado:** `leaks found: 9`, todos en `.env.docker` (6) y `.env.local` (3).
- **Es correcto:** esos archivos tienen los secretos reales del laboratorio, y por eso están en `.gitignore` y nunca se suben.
- En el pipeline Gitleaks revisa el **historial de git**, donde esos archivos no existen. Ahí el resultado esperado es 0.
- Una vez creado el repositorio, se puede probar en local con `gitleaks git /repo` en lugar de `dir`.

**Afinamiento (`.gitleaks.toml`):** se excluyeron, cada uno con su justificación:
- los artefactos generados (`.next/`, `reportes/`, etc.);
- los marcadores `CAMBIAR_*` de las plantillas;
- la lista de contraseñas prohibidas en `validation.ts`.

Sin este archivo, **el pipeline habría fallado** por los valores de ejemplo de `.env.example`.

**Demo:** pegue `AKIAIOSFODNN7EXAMPLE` en cualquier archivo de `src/`, vuelva a correr el comando y verá el hallazgo `aws-access-token`. Después bórrelo.

---

## 4. Escaneo de contenedores con Trivy

**Objetivo (Fase 5):** encontrar CVE en el sistema operativo base y en las librerías de la imagen Docker, además de secretos y malas configuraciones dentro de ella.

```powershell
New-Item -ItemType Directory -Force reportes/trivy | Out-Null
# 4.1 Nuestra imagen
docker run --rm -v //var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache aquasec/trivy:0.67.2 `
  image --scanners vuln,secret --severity CRITICAL,HIGH ventas-online-segura:local

# 4.2 Contraste: una imagen obsoleta
docker run --rm -v //var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache aquasec/trivy:0.67.2 `
  image --severity CRITICAL,HIGH node:16-alpine

# 4.3 SBOM (inventario de componentes) de nuestra imagen
docker run --rm -v //var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache -v "${PWD}/reportes/trivy:/out" `
  aquasec/trivy:0.67.2 image --format cyclonedx --output /out/sbom-imagen.json ventas-online-segura:local
```

**Resultados esperados:**

| Imagen | CRITICAL | HIGH | Secretos |
|---|---|---|---|
| `ventas-online-segura:local` (Alpine 3.22.2) | **0** | **0** | 0 |
| `node:16-alpine` (sin soporte) | 1 | 41 | — |

**Por qué la nuestra sale limpia:**
- imagen base fijada y actualizada (`apk upgrade`);
- construcción multi-etapa: la imagen final no lleva compiladores ni devDependencies;
- npm eliminado de la imagen final;
- usuario sin privilegios.

---

## 5. Infraestructura como código: Checkov y Trivy config

```powershell
docker run --rm -v "${PWD}:/src:ro" bridgecrew/checkov:3.2.495 -d /src/infra/terraform -f /src/Dockerfile `
  --framework terraform dockerfile --quiet --compact
docker run --rm -v trivy-cache:/root/.cache -v "${PWD}:/src:ro" aquasec/trivy:0.67.2 `
  config --severity CRITICAL,HIGH --exit-code 1 /src
```

**Resultados esperados:**
- Checkov: `Passed checks: 284, Failed checks: 0, Skipped checks: 23`.
- Trivy config: código de salida 0.

**Caso para la exposición: dos herramientas encuentran cosas distintas.** Trivy halló 4 problemas que Checkov no reportó. Se aceptaron con su justificación escrita junto al recurso (`#trivy:ignore:<ID>`):

| ID | Recurso | Por qué se acepta |
|---|---|---|
| AVD-AWS-0053 | ALB público | Es una tienda pública; el ALB lo protegen AWS WAF y TLS |
| AVD-AWS-0132 | Bucket de logs con AES256 | Los *access logs* del ALB no admiten SSE-KMS |
| AVD-AWS-0104 (×2) | Salida 443 y 587 a internet | PayPal, HIBP y el correo tienen IPs variables. Mejora futura: proxy de salida con lista blanca |

**Demo de detección:**
1. En `infra/terraform/aws/security_groups.tf`, agregue una regla de entrada al puerto 22 desde `0.0.0.0/0`.
2. Corra Checkov: aparece `CKV_AWS_24` (*FAILED*).
3. Revierta el cambio.

---

## 6. WAF: ModSecurity + OWASP CRS

**Objetivo (Fase 6):** demostrar que el perímetro bloquea el OWASP Top 10 **sin romper** el uso legítimo.

### 6.1 Ataques bloqueados
```powershell
$B = "http://localhost:8080"
curl.exe -s -o NUL -w "%{http_code}`n" "$B/tienda?q=%27%20OR%201%3D1--"                                  # SQLi
curl.exe -s -o NUL -w "%{http_code}`n" -X POST --form-string "nombres=x' UNION SELECT password FROM user--" "$B/registro"
curl.exe -s -o NUL -w "%{http_code}`n" -X POST --form-string "nombres=<script>alert(1)</script>" "$B/registro"  # XSS
curl.exe -s -o NUL -w "%{http_code}`n" "$B/tienda?q=;cat%20/etc/passwd"                                  # comandos
curl.exe -s -o NUL -w "%{http_code}`n" -A "sqlmap/1.8" "$B/"                                              # escáner
curl.exe -s -o NUL -w "%{http_code}`n" "$B/api/imagenes/..%2F..%2F..%2Fetc%2Fpasswd"                     # traversal
1..20 | ForEach-Object { curl.exe -s -o NUL -w "%{http_code} " -X POST -d "x=1" "$B/login" }              # fuerza bruta
```
**Resultados esperados:**
- 403, 403, 403, 403, 403 y 400.
- En la ráfaga de logins: unos seis `200` y después `429`.

### 6.2 Ver qué regla bloqueó (el log de auditoría del WAF)
```powershell
docker compose logs waf --since 5m | Select-String "ModSecurity: Access denied" | Select-Object -Last 3
docker compose logs waf --since 5m --no-log-prefix | Select-String '^\{"transaction"' | Select-Object -Last 1
```
El JSON de la segunda línea trae `messages[].details.ruleId`: 942100 (SQLi vía libinjection), 941100 (XSS) y 949110 (puntaje total).

### 6.3 Afinamiento (falsos positivos): el aprendizaje principal
Encender el CRS sin afinarlo **rompió la aplicación**: el registro, el login y el pago devolvían 403 o 500. Los seis casos encontrados y su corrección mínima están en `docs/EVIDENCIA_LABORATORIO.md` §4 (FP-002 a FP-006, HDR-1 y HDR-2).

**Ejercicio para la clase:**
1. Comente el bloque `FP-002` en `infra/waf/modsecurity/RESPONSE-999-EXCLUSION-RULES-AFTER-CRS.conf`.
2. Corra `docker compose restart waf`.
3. Intente registrarse en el sitio: obtendrá 403.
4. Busque la regla en el log (6.2).
5. Restaure el bloque.

### 6.4 Cabeceras
```powershell
curl.exe -s -D - -o NUL http://localhost:8080/tienda
```
**Resultado esperado:** **una** CSP con *nonce*, HSTS, `X-Frame-Options: DENY`, `nosniff` y `Referrer-Policy`, sin duplicados ni versión del servidor.

**Nota:** si al repetir pruebas aparece «Demasiados intentos» o 429, es el control funcionando. Para reiniciar los contadores:
```powershell
"DELETE FROM rate_limit;" | docker exec -i ventas-db sh -c 'MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysql -uroot ventas_segura'
```

---

## 7. DAST con OWASP ZAP (caja negra)

```powershell
New-Item -ItemType Directory -Force reportes/zap | Out-Null
Copy-Item security/zap/rules.tsv reportes/zap/
docker run --rm -v "${PWD}/reportes/zap:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable `
  zap-baseline.py -t http://host.docker.internal:8080 -c rules.tsv -r zap-baseline.html -J zap-baseline.json -a -j
```

**Resultado esperado:** `FAIL-NEW: 0  WARN-NEW: 6  PASS: 64`.

- La justificación de cada advertencia está en `EVIDENCIA_LABORATORIO.md` §5.
- `reportes/zap/zap-baseline-antes-ajustes.html` es el reporte de la primera corrida, con 1 fallo, y sirve para comparar antes y después.
- Para un escaneo **activo** (ataques reales) y autenticado, ver `security/zap/README.md`. Tarda más y debe correrse solo contra el laboratorio.

**Evidencia para el informe:** el HTML de los dos reportes y una captura del resumen.

---

## 8. Pentest de caja negra y caja gris

### 8.1 Reconocimiento con nmap (caja negra)
```powershell
docker run --rm instrumentisto/nmap:7.95 -sT -sV -Pn -p 80,443,3000,3306,8080,8443,33060 host.docker.internal
```
**Resultado esperado:** solo `8080/tcp open http nginx (reverse proxy)`, sin versión; 3000 y 3306 cerrados.

> **Hallazgo real del laboratorio:** la primera vez apareció `3306 open MariaDB 10.4.28`, el MySQL de **XAMPP** del sistema PHP, escuchando con `root` sin contraseña. Es el mismo problema H-19 del sistema heredado, ahora visto desde fuera. Mantenga XAMPP apagado durante el laboratorio.

### 8.2 Caja gris con Burp Suite Community
**Configuración:**
1. Proxy del navegador en `127.0.0.1:8080` de Burp. Como Burp y el WAF usan el mismo puerto por defecto, cambie el *listener* de Burp a `8081`.
2. Navegue `http://localhost:8080`.

| Caso de abuso | Pasos en Burp | Resultado esperado |
|---|---|---|
| IDOR | Con el usuario B, abra `/pedido/<id del pedido de A>` | 404; en la bitácora queda `acceso.pedido_ajeno` |
| Manipulación de precio | Intercepte el POST de «Pagar» y agregue un campo `total=1` | 403 del WAF (regla 1200). Aunque pasara, el servidor recalcula el total |
| CSRF | En Repeater, cambie la cabecera `Origin` a `https://evil.example` en una Server Action | Rechazado («Invalid Server Actions request» en el log de la app) |
| *Cookie* alterada | Edite la *cookie* `vos.carrito` | El carrito aparece vacío (firma HMAC inválida) |
| Fuerza bruta | Intruder sobre el POST `/login` con 20 contraseñas | 429 del WAF tras unos 6 intentos; la app bloquea la cuenta tras 5 |
| Condición de carrera | Repeater → *Send group in parallel* con dos «Aprobar pago» | El stock baja solo 1 |

---

## 9. Pruebas funcionales de seguridad (automatizadas)

```powershell
npm install
npm test                      # 25 pruebas unitarias (Vitest)
npm run test:cobertura        # con umbrales de cobertura
# E2E contra el laboratorio (pasa por el WAF). Ejecute pocas a la vez por los límites de tasa:
$env:E2E_CHANNEL="chrome"; $env:E2E_BASE_URL="http://localhost:8080"; $env:E2E_MAILBOX_DIR="./reportes/correos"
npx playwright test e2e/cabeceras.spec.ts
npx playwright test e2e/compra.spec.ts -g stock
npx playwright show-report
```

**Resultados esperados:** `25 passed` (unitarias), `5 passed` (cabeceras) y `1 passed` (compra con doble aprobación).

La suite completa de 17 pruebas se ejecuta contra la app **sin** WAF (ver README, «Pruebas E2E»), porque detrás del WAF todas las peticiones salen de la misma IP y activan los límites.

---

## 10. Auditoría y SIEM

```powershell
# Eventos de seguridad en formato JSON (lo que recibiría CloudWatch / el SIEM)
docker compose logs app --no-log-prefix | Select-String '"type":"audit"' | Select-Object -Last 5

# Integridad de la bitácora encadenada
docker compose --profile tareas run --rm tareas npx tsx --conditions=react-server scripts/verificar-auditoria.ts
```

**Demo de manipulación:**
1. Altere un evento:
   ```powershell
   "UPDATE auditoria SET ip='6.6.6.6' WHERE id=1;" | docker exec -i ventas-db sh -c 'MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysql -uroot ventas_segura'
   ```
2. Repita la verificación. **Resultado esperado:** `ALERTA: cadena rota en el evento #1`. El panel `/admin/auditoria` muestra la alerta en rojo.
3. Restaure el valor original o recree el laboratorio con `docker compose down -v`.

Las consultas de detección del SIEM (fuerza bruta, acciones de admin fuera de horario, IDOR) están en `docs/DEVSECOPS.md` §4.

---

## 11. Pipeline CI/CD en GitHub (pendiente de crear el repositorio)

1. Crear un repositorio **vacío** en GitHub (por ejemplo `ventas-online-segura`).
2. Desde esta carpeta:
   ```powershell
   git init; git add .; git commit -m "Migración segura del sistema de ventas"
   git branch -M main
   git remote add origin https://github.com/<usuario>/ventas-online-segura.git
   git push -u origin main
   ```
   Antes del primer *push*, compruebe que `git status` **no** lista `.env.local` ni `.env.docker`.
3. En GitHub:
   - La pestaña **Actions** ejecuta los jobs `build-test`, `sast`, `secrets`, `sca`, `iac`, `container`, `e2e` y `dast`.
   - **Security → Code scanning** muestra los resultados SARIF.
   - Los **artefactos** del run incluyen los reportes de ZAP y Playwright y los SBOM.
4. Demo de bloqueo:
   - Crear la rama `demo-sast`.
   - Copiar el archivo de 1.2 dentro de `src/app/`.
   - Hacer *push* y abrir un *pull request*: el job `sast` queda en rojo.

---

## Lista de evidencias para los anexos del informe

- [ ] `docker compose ps` con los 3 contenedores *healthy* y solo el 8080 publicado
- [ ] SAST: 0 hallazgos en el código real y 7 en la demo; historia del hallazgo GCM
- [ ] SCA: npm audit y OSV con 0 vulnerabilidades
- [ ] Gitleaks: detecta los `.env` locales, que están ignorados por git
- [ ] Trivy: nuestra imagen (0) frente a `node:16-alpine` (1 CRITICAL, 41 HIGH); SBOM
- [ ] Checkov (284 controles superados, 0 fallos) y Trivy config con las justificaciones
- [ ] WAF: tabla de ataques bloqueados con el ID de regla y un ejemplo del log JSON
- [ ] WAF: casos de falsos positivos y su corrección mínima
- [ ] ZAP: reporte HTML antes y después
- [ ] nmap: solo el 8080 abierto, y el hallazgo de XAMPP
- [ ] Burp: capturas de IDOR, CSRF y la condición de carrera
- [ ] Bitácora: verificación íntegra y detección de manipulación
- [ ] GitHub Actions: pipeline en verde y PR `demo-sast` en rojo
