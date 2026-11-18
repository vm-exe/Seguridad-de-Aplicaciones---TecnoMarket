# Guía del equipo: qué hace cada parte y cómo probarla

Proyecto final de Seguridad en Aplicaciones (UMG). Sistema: **Ventas Online Segura**, la migración del sistema PHP «Sistemas de ventas en línea» a Next.js con controles de seguridad.

Esta guía sirve para dos cosas: que cada integrante entienda su parte del sistema y que pueda demostrarla en vivo durante la exposición. Cada sección tiene la misma estructura:

1. **Alcance:** qué fase del PDF del curso cubre.
2. **Funciones:** qué hace cada pieza y dónde está en el código.
3. **Cómo probarlo:** los comandos y el resultado esperado.
4. **Guion de demostración:** 4 a 5 minutos.
5. **Preguntas probables del catedrático.**

Documentos relacionados:

| Documento | Contenido |
|---|---|
| `ANALISIS_MIGRACION.md` (raíz del repositorio) | Hallazgos del sistema PHP, STRIDE/DREAD, requisitos RS-01 a RS-22 y runbook |
| `docs/DEVSECOPS.md` | Detalle del pipeline, el WAF y el SIEM |
| `docs/LABORATORIOS.md` | **Manual paso a paso de los 11 laboratorios** (solo requiere Docker Desktop), con resultados esperados y lista de evidencias |
| `docs/EVIDENCIA_LABORATORIO.md` | Resultados reales del laboratorio Docker: ataques bloqueados, falsos positivos corregidos, ZAP antes y después |
| `README.md` | Instalación |

---

## 0. Reparto propuesto

| Integrante | Rol | Fases del PDF | Partes del sistema |
|---|---|---|---|
| **1. Coordinación** | DevSecOps: CI/CD, SAST y escaneo de contenedores | Fase 3 (SAST/SCA) y Fase 5 (contenedores) | `.github/workflows/devsecops.yml`, `security/semgrep/`, `Dockerfile`, Trivy, Gitleaks, OSV, SBOM, `.npmrc` y Dependabot |
| **2** | Análisis de riesgos y modelado de amenazas | Fase 1 y Fase 6 (tratamiento del riesgo y matriz de calor) | `ANALISIS_MIGRACION.md`: inventario ISO 27001, STRIDE/DREAD, 7 capas y requisitos RS |
| **3** | Arquitectura cloud e infraestructura como código | Fase 2 y Fase 5 (IaC) | `infra/terraform/aws/`, Checkov, AWS WAF, KMS, Secrets Manager, RDS, health checks |
| **4** | Desarrollo seguro: identidad y protección de datos | Fase 3 (codificación segura) | Better Auth, 2FA, sesiones, límite de intentos, cifrado del DPI, validación, bitácora |
| **5** | Ciberdefensa: pruebas ofensivas, WAF y monitoreo | Fase 4 y Fase 6 (WAF/RASP/SIEM) | Pentest caja negra/gris, casos de abuso, pagos e IDOR, ModSecurity, suite E2E, logs y SIEM |

Se puede reacomodar. Lo importante es que **cada fase del PDF tenga un responsable** y que cada quien domine sus pruebas.

---

## 1. Preparar el entorno (todos, una vez)

Requisitos: Node 22, XAMPP con MySQL encendido y Chrome. Docker Desktop es opcional; solo hace falta para el laboratorio con WAF.

```bash
cd ventas-online-segura
npm install
# .env.local: copiar de .env.example y completar (pedir los valores al coordinador; nunca subirlos a git)
npm run db:migrate:local      # crea/actualiza las tablas con el usuario de DDL
npm run db:migrar-legado      # importa catálogo, clientes y compras del sistema PHP (opcional)
npm run admin:crear -- su-correo@ejemplo.com "Su Nombre"
npm run dev                   # http://localhost:3000
```

Sin SMTP configurado, los enlaces de activación y recuperación de contraseña aparecen en la consola de `npm run dev`.

Para las pruebas automáticas, todos usan:

| Comando | Qué valida | Resultado esperado |
|---|---|---|
| `npm test` | 24 pruebas unitarias (Vitest) | `24 passed` |
| `npm run test:cobertura` | Igual, más la cobertura mínima de los módulos de seguridad | Sin líneas `ERROR: Coverage` |
| `npm run test:e2e` | 17 pruebas de navegador (Playwright); ver el procedimiento en `README.md` | `17 passed` |
| `npm run typecheck` / `npm run lint` | Tipos y estilo | Sin salida de errores |
| `npm audit --omit=dev --omit=optional` | Dependencias vulnerables | `found 0 vulnerabilities` |
| `npm run auditoria:verificar` | Integridad de la bitácora | `OK: N eventos íntegros` |

---

## 2. Mapa del sistema

```
Navegador ──HTTPS──> WAF (ModSecurity CRS / AWS WAF) ──> ALB ──> App Next.js (contenedor no-root)
                                                                   │
                ┌──────────────────────────────────────────────────┼─────────────────────┐
                ▼                         ▼                        ▼                     ▼
         MySQL / RDS (KMS)        Imágenes (S3/EFS)         PayPal Orders v2       SMTP (correo)
                                                                   │
                                     Logs JSON + bitácora encadenada ──> CloudWatch ──> SIEM
```

| Carpeta | Qué contiene |
|---|---|
| `src/proxy.ts` | Se ejecuta antes de cada página: CSP con nonce y redirección temprana de rutas privadas |
| `src/lib/` | Lógica de negocio y seguridad: auth, cifrado, pagos, auditoría, límites de intentos, validación |
| `src/app/(auth)/` | Login, 2FA, registro y recuperación de contraseña (Server Actions) |
| `src/app/(tienda)/` | Inicio, tienda, producto y carrito |
| `src/app/(cliente)/` | Checkout, pedidos y seguridad de la cuenta |
| `src/app/admin/` | Panel de administración: productos, categorías, órdenes, usuarios, auditoría y configuración |
| `src/app/api/` | `auth/*` (Better Auth), `health`, `imagenes/*` |
| `src/db/` | Esquema de base de datos (Drizzle) |
| `scripts/` | Migración de datos, creación de admin, conciliación de pagos, verificación de la bitácora |
| `tests/`, `e2e/` | Pruebas unitarias y de navegador |
| `infra/`, `.github/`, `security/` | Contenedores, WAF, Terraform, pipeline y reglas de SAST/DAST |

---

## 3. Integrante 1: DevSecOps (CI/CD, SAST y escaneo de contenedores)

### 3.1 Alcance
- **Fase 3 del PDF:** SAST, SCA y prácticas de codificación segura automatizadas.
- **Fase 5 del PDF:** escaneo de contenedores y artefactos.
- Es la **evidencia de herramientas SAST/SCA integradas** que exige la matriz de ponderación.

### 3.2 El pipeline: `.github/workflows/devsecops.yml`

Se ejecuta en cada *push*, en cada *pull request* y una vez por semana. Si un job falla, el cambio no avanza.

| Job | Herramienta | Qué detecta | Bloquea si… |
|---|---|---|---|
| `build-test` | npm, tsc, ESLint, Vitest, `next build` | Errores de tipos, de estilo, pruebas fallidas o un build roto | Falla cualquier paso |
| `sast` | **Semgrep** con las reglas OWASP Top 10, TypeScript, React, Next.js y secretos, más **8 reglas propias** | Inyección, XSS, secretos en el código, criptografía débil | Aparece un hallazgo de severidad ERROR |
| `secrets` | **Gitleaks** sobre todo el historial de git | Claves, tokens o contraseñas subidas por error | Encuentra un secreto |
| `sca` | `lockfile-lint`, **npm audit**, **OSV-Scanner**, SBOM CycloneDX | Dependencias con CVE conocidas o un lockfile manipulado | Hay vulnerabilidades HIGH/CRITICAL, o un hallazgo de OSV que no está aceptado en `osv-scanner.toml` |
| `iac` | **Checkov** | Configuraciones inseguras en Terraform, Dockerfile y compose | Falla un check que no tiene justificación |
| `container` | **Trivy** sobre la imagen Docker y el SBOM de la imagen | CVE del sistema operativo base y de las librerías, secretos y configuraciones dentro de la imagen | Hay CRITICAL/HIGH con parche disponible |
| `e2e` | **Playwright** contra la app con MySQL efímero | Que los controles funcionen de punta a punta | Falla una prueba |
| `dast` | **OWASP ZAP** baseline a través del WAF | Cabeceras faltantes, *cookies* inseguras, fugas de información | Una regla marcada FAIL en `security/zap/rules.tsv` |

**Cadena de suministro (*supply chain*):**
- Todas las acciones de GitHub están fijadas por **SHA de commit**, no por etiqueta. Una etiqueta se puede mover a código malicioso; un SHA no.
- Las imágenes de Gitleaks, OSV y MySQL se fijan por **digest** `@sha256`.
- `.npmrc` tiene `ignore-scripts=true`, para que ningún paquete ejecute código al instalarse.
- Dependabot espera **7 días** antes de proponer una versión nueva (*cooldown*), por si esa versión resulta comprometida.
- Los permisos del workflow son mínimos (`contents: read`). Solo los jobs que suben SARIF tienen `security-events: write`.

**Reglas SAST propias (`security/semgrep/reglas-ventas.yml`).** Están escritas para los riesgos de este sistema:

| Regla | Qué impide | Hallazgo del sistema PHP relacionado |
|---|---|---|
| `ventas-xss-dangerously-set-inner-html` | Insertar HTML sin escapar | XSS almacenado en `detalles.php` |
| `ventas-sqli-raw-sql` | SQL armado concatenando texto | SQLi en `admin/productos/procesar.php` |
| `ventas-insecure-random-token` | Usar `Math.random()` para tokens | `md5(uniqid(mt_rand()))` en `clienteFunciones.php` |
| `ventas-precio-desde-cliente` | Leer precio o total desde la petición | `capture.php` confiaba en el monto del navegador |
| `ventas-log-de-secretos` | Registrar contraseñas o tokens en logs | — |
| `ventas-eval-o-new-function` | Ejecutar código dinámico | — |
| `ventas-secreto-hardcodeado` | Constantes con secretos en el código | `KEY_TOKEN = "Tr1f0rc3&"` |
| `ventas-redirect-abierto` | Redirigir a URLs controladas por el usuario | — |

**Contenedor (`Dockerfile`):**
- Construcción multi-etapa: la imagen final no contiene compiladores ni npm.
- Corre con un usuario sin privilegios (uid 1001) y es compatible con sistema de archivos de solo lectura.
- Tiene `HEALTHCHECK` y no contiene secretos.
- En `docker-compose.yml`, el contenedor de la app corre con `read_only`, `cap_drop: ALL` y `no-new-privileges`.

### 3.3 Cómo probarlo

**En GitHub.** Es la forma más vistosa para la exposición:
1. Subir el repositorio a GitHub y abrir la pestaña **Actions**. El pipeline corre solo.
2. Revisar los resultados:
   - **Security → Code scanning:** hallazgos de Semgrep, OSV, Checkov y Trivy (SARIF).
   - **Artefactos del run:** SBOM, reporte de ZAP, reporte de Playwright y logs del WAF.

**Demostrar que el pipeline bloquea código inseguro:**
1. Crear una rama: `git checkout -b demo-sast`.
2. Agregar en cualquier componente:
   - `<div dangerouslySetInnerHTML={{ __html: p.nombre }} />`
   - `const token = Math.random().toString(36)`
3. Hacer *push* y abrir un *pull request*.
4. Resultado esperado: el job `sast` falla, citando `ventas-xss-dangerously-set-inner-html` y `ventas-insecure-random-token`.

**En local (Windows):**
```bash
# SCA
npm audit --omit=dev --omit=optional --audit-level=high
npx --yes lockfile-lint@4 --path package-lock.json --allowed-hosts npm --validate-https

# SAST (requiere Python: pip install semgrep)
semgrep scan --config p/owasp-top-ten --config security/semgrep/ --error src

# Escaneo con Trivy (binario de https://github.com/aquasecurity/trivy/releases)
trivy fs --scanners vuln,secret,misconfig .
# Con Docker Desktop:
docker build -t ventas-online:local .
trivy image --severity HIGH,CRITICAL ventas-online:local
trivy image --format cyclonedx -o sbom-imagen.json ventas-online:local

# Secretos (binario de gitleaks)
gitleaks detect --source . -v
```

### 3.4 Guion de demostración (5 min)
1. **Contexto (30 s):** el sistema PHP no tenía control de dependencias (PHPMailer copiado a mano), tenía secretos en el código y nada revisaba el código antes de publicarlo.
2. **Recorrido (1 min):** mostrar el diagrama de jobs en GitHub Actions y explicar el orden: build, luego SAST/SCA/IaC/secretos en paralelo, luego contenedor, luego E2E y DAST.
3. **Demo en vivo (2 min):** el *pull request* `demo-sast` con `dangerouslySetInnerHTML` aparece en rojo. Abrir el hallazgo en Code scanning y mostrar la regla propia.
4. **Contenedor (1 min):** reporte de Trivy y SBOM; explicar la imagen sin privilegios y el sistema de archivos de solo lectura.
5. **Cadena de suministro (30 s):** fijado por SHA, `ignore-scripts` y el *cooldown*. Mencionar que con esto se evitan ataques como el del paquete `event-stream`.

### 3.5 Preguntas probables
- **¿Por qué Semgrep y no SonarQube?** Es gratuito, corre en segundos dentro del CI, sus reglas se escriben en YAML (por eso tenemos 8 propias) y sus resultados se suben a GitHub como SARIF.
- **¿Qué pasa con un falso positivo?**
  - Trivy: se documenta en `.trivyignore` con su justificación.
  - OSV: en `osv-scanner.toml`.
  - Checkov: con `#checkov:skip=ID:motivo` junto al recurso.
  - Nunca se desactiva el *gate* completo.
- **¿Qué es un SBOM y para qué sirve?** Es el inventario de componentes de la aplicación. Cuando se publica un CVE nuevo, sirve para saber en minutos si nos afecta.
- **¿Por qué fijar por SHA?** Porque una etiqueta de una acción de GitHub se puede reasignar y un SHA no; así se mitiga un compromiso del proveedor de esa acción.

---

## 4. Integrante 2: Análisis de riesgos y modelado de amenazas

### 4.1 Alcance
- **Fase 1 del PDF:** inventario ISO 27001, STRIDE/DREAD y las 7 capas.
- **Fase 6 del PDF:** tratamiento del riesgo y matriz de calor.

Vale 4 puntos de la ponderación.

### 4.2 Qué contiene `ANALISIS_MIGRACION.md` (raíz del repositorio)

| Sección | Contenido | Uso en la presentación |
|---|---|---|
| §2 | Inventario del sistema PHP: módulos, tecnologías y esquema de base de datos | Base del inventario de activos ISO 27001 (falta agregar los campos CIA, propietario y custodio) |
| §3 | **32 hallazgos** (H-01 a H-32) con archivo:línea, OWASP 2025, CWE, severidad y capa | Línea base «antes de los controles» |
| §5 | Arquitectura nueva y diagrama de flujo de datos con fronteras de confianza | Contexto para STRIDE |
| §6 | Qué control corrige cada hallazgo, con tipo P/D/C (preventivo, detectivo o correctivo) | Plan de mitigación técnica por hallazgo |
| §6.1 | **22 requisitos RS-01 a RS-22**, cada uno con su criterio de aceptación y la prueba que lo verifica | Trazabilidad amenaza → requisito → prueba |
| §8.1 y §8.2 | DREAD antes y después de los controles | Datos para la **matriz de calor** |
| §8.3 y §8.4 | STRIDE por elemento del diagrama de flujo y amenazas T-12 a T-21 de la arquitectura nueva | Cobertura de las 6 categorías STRIDE |
| §8.5 | Runbook de incidentes: fuerza bruta, manipulación de pagos, bitácora alterada y fuga de un secreto | Gestión de incidentes (capa 7) |

### 4.3 Cómo probarlo y demostrarlo
- **Trazabilidad viva.** Elegir un requisito, por ejemplo RS-06: «toda acción de /admin rechaza a un no-admin o a un admin sin 2FA». Ejecutar su prueba y mostrarla en verde:
  ```bash
  npx playwright test e2e/admin.spec.ts e2e/compra.spec.ts -g "admin"
  ```
- **Antes y después.** Para un hallazgo crítico, por ejemplo H-06 (precio manipulable):
  1. Mostrar la línea vulnerable en `capture.php` del sistema PHP.
  2. Mostrar el control en `src/lib/ordenes.ts` (`finalizarCaptura`).
  3. Mostrar la prueba que lo verifica.
- **Matriz de calor.** Con la tabla de §8.2, graficar probabilidad contra impacto antes y después. En Excel, una cuadrícula 5×5 con formato condicional es suficiente.

### 4.4 Guion de demostración (5 min)
1. Método: STRIDE para identificar amenazas, DREAD para puntuarlas y las 7 capas para clasificarlas.
2. Tres hallazgos críticos del sistema PHP, con su evidencia de código:
   - SQLi en el admin;
   - manipulación del monto pagado;
   - activación de cualquier cuenta con `token=%`.
3. Matriz de calor antes y después: los críticos bajan a medio o bajo.
4. Riesgo residual y por qué se **mitiga** en lugar de **eliminarse**. Ejemplos: el bloqueo de cuentas por fuerza bruta (T-05) y la dependencia de PayPal.
5. Runbook: qué hace el equipo si la bitácora aparece alterada.

### 4.5 Preguntas probables
- **¿Por qué DREAD si se considera subjetivo?** Porque lo pide el curso. Para que sea repetible, se puntuó en equipo con criterios fijos, y se puede contrastar con CVSS.
- **¿Qué riesgos se aceptan?**
  - El bloqueo de una cuenta por un atacante (*DoS* dirigido), que es el costo de frenar la fuerza bruta.
  - La dependencia de PayPal y de AWS: es un riesgo **transferido**.

---

## 5. Integrante 3: Arquitectura cloud e infraestructura como código

### 5.1 Alcance
- **Fase 2 del PDF:** diagrama de arquitectura de seguridad, IAM con mínimo privilegio y cifrado.
- **Fase 5 del PDF:** *hardening* de IaC con Checkov.

### 5.2 Qué hace cada archivo de `infra/terraform/aws/`

| Archivo | Qué crea | Control de seguridad |
|---|---|---|
| `network.tf` | VPC con 2 subredes públicas, 2 privadas y NAT; *flow logs* | La app y la base de datos no son accesibles desde internet; el tráfico queda registrado |
| `security_groups.tf` | Reglas de red | ALB solo en el puerto 443; la app solo acepta tráfico del ALB; RDS solo de la app. **Sin puerto 22 abierto** |
| `alb.tf` | Balanceador HTTPS | Política TLS 1.3/1.2, redirección de HTTP a HTTPS, descarta cabeceras inválidas, *health check* `/api/health?db=1` (*readiness*) |
| `waf.tf` | AWS WAFv2 | Reglas administradas de OWASP, SQLi, entradas maliciosas conocidas y reputación de IP; límite de tasa en las rutas de login |
| `ecs.tf` | Fargate con la app | Sistema de archivos de solo lectura; los secretos se inyectan desde Secrets Manager |
| `rds.tf` | MySQL 8.4 | Cifrado con **KMS**, contraseña maestra gestionada por RDS, no público, respaldos y protección contra borrado |
| `kms.tf`, `secrets.tf` | Clave KMS con rotación y secretos | Nada sensible en el código ni en las imágenes |
| `s3.tf`, `efs.tf` | Imágenes y logs | Acceso público bloqueado, SSE-KMS, versionado, solo TLS |
| `iam.tf` | Roles de la tarea | Mínimo privilegio: solo los secretos y el bucket de esta app |
| `cloudwatch.tf` | Logs y alarmas | Alarmas por fuerza bruta, accesos denegados y montos manipulados (alimentan el SIEM) |
| `providers.tf`, `backend.hcl.example` | Versiones fijadas y estado remoto | Estado en S3 cifrado con KMS y con bloqueo |
| `variables.tf` | Parámetros | Bloques `validation` que rechazan entornos, regiones o CIDR inválidos |

### 5.3 Cómo probarlo
```bash
pip install checkov
checkov -d infra/terraform/aws        # esperado: 0 fallos (los omitidos tienen justificación)
checkov -f Dockerfile
# Con Terraform instalado (no aplica nada en AWS):
cd infra/terraform/aws && terraform init -backend=false && terraform validate && terraform fmt -check
```

**Demo de detección de una mala configuración:**
1. Abrir temporalmente el puerto 22 a `0.0.0.0/0` en `security_groups.tf`.
2. Correr Checkov: debe fallar con `CKV_AWS_24` o similar.
3. Revertir el cambio.

**Health checks en la app:**
- `curl http://localhost:3000/api/health` responde `{"status":"ok"}`. Es el *liveness*: el proceso está vivo.
- `curl "http://localhost:3000/api/health?db=1"` también verifica la base de datos. Es el *readiness*, el que usa el ALB.

### 5.4 Guion de demostración (5 min)
1. Diagrama de §5.2 del análisis: el flujo navegador → WAF → ALB → ECS → RDS/S3/Secrets Manager, con sus fronteras de confianza.
2. Defensa en capas: red (subredes y *security groups*), perímetro (WAF y TLS), cómputo (contenedor de solo lectura), datos (KMS).
3. Mínimo privilegio: el rol IAM de la tarea y los dos usuarios de base de datos (`ventas_app` solo lectura y escritura de datos; `ventas_migrator` con permisos de esquema).
4. Checkov en vivo con 0 fallos, luego la demo del puerto 22.
5. Costo y despliegue: `terraform plan` y por qué no se deja corriendo.

### 5.5 Preguntas probables
- **¿Cómo se gestionan las claves?** Con KMS y rotación automática. La contraseña maestra de RDS la gestiona RDS. La app lee sus secretos de Secrets Manager al arrancar.
- **¿Por qué la contraseña de la app en el estado de Terraform no es un problema?** El estado vive en S3 cifrado con KMS, con acceso restringido y con bloqueo.

---

## 6. Integrante 4: Desarrollo seguro (identidad y protección de datos)

### 6.1 Alcance
- **Fase 3 del PDF:** prácticas de codificación segura.
- **Capa 2 de las 7 capas (Aplicación):** código, lógica de negocio, autenticación y autorización.

### 6.2 Funciones principales

| Archivo → función | Qué hace | Hallazgo del sistema PHP que corrige |
|---|---|---|
| `src/lib/auth.ts` → `auth` | Configura Better Auth en varios frentes (detalle abajo) | Tokens MD5 predecibles, búsquedas con `LIKE`, sin MFA |
| `src/app/(auth)/acciones.ts` → `iniciarSesion` | Valida con Zod y limita intentos por IP **y** por cuenta (5 cada 15 min); responde con un mensaje genérico | Fuerza bruta y enumeración de usuarios |
| … → `verificarSegundoFactor` | Verifica el código TOTP o un código de respaldo | — |
| … → `registrar` | Valida, cifra el DPI, responde igual exista o no la cuenta y rechaza contraseñas filtradas | DPI en texto plano, enumeración vía `clienteAjax.php` |
| … → `solicitarRecuperacion` / `restablecerPassword` | Enlace válido 30 min y de un solo uso; limitado por IP y por correo | Restablecer la contraseña de cualquiera con `token=%` |
| `src/lib/session.ts` → `requerirAdmin` / `asegurarAdmin` | Autorización **en el servidor** en cada página y acción admin; exige 2FA y sesión reciente para acciones críticas; audita los intentos denegados | `borrar.php` y `procesar.php` no revisaban la sesión |
| `src/lib/rate-limit.ts` → `permitir` / `permitirIp` | Contador persistente en la base de datos, compartido entre instancias | Sin límite de intentos |
| `src/lib/crypto.ts` → `cifrarCampo` / `descifrarCampo` | AES-256-GCM con IV aleatorio; detecta si el dato fue alterado | `cifrado.php`: AES-128-CBC con la clave fija «Tr1f0rc3&» |
| … → `hmacIndice` | Índice HMAC del DPI para detectar duplicados sin descifrarlo | — |
| `src/lib/validation.ts` | Esquemas Zod de lista blanca para todos los formularios | `$_GET` y `$_POST` concatenados directo en SQL y HTML |
| `src/lib/audit.ts` → `auditar` / `verificarCadena` | Bitácora en la que cada evento lleva el HMAC del anterior; si se borra o altera una fila, la cadena se rompe | Sin registro de eventos (no repudio) |
| `src/lib/env.ts` | Valida la configuración al arrancar; en producción exige `TRUST_PROXY` | Secretos fijos en el código y root sin contraseña |
| `src/lib/errores.ts` | Separa el error del usuario de la falla del sistema; esta última se registra en el log | Mensajes de `PDOException` mostrados al usuario |

El objeto `auth` de `src/lib/auth.ts` se encarga de:
- **Contraseñas:** mínimo 12 caracteres, hash scrypt y rechazo de contraseñas filtradas (HIBP).
- **Correo:** verificación obligatoria antes del primer ingreso.
- **Sesiones:** duran 1 día y las *cookies* son HttpOnly, Secure y SameSite.
- **2FA:** TOTP, con bloqueo de la **cuenta** tras 5 códigos fallidos.
- **Roles:** cliente o administrador.

### 6.3 Cómo probarlo
```bash
npm test                          # validation, crypto, rutas y rate-limit (24 pruebas)
npx playwright test e2e/auth.spec.ts
npm run auditoria:verificar
```

**Pruebas manuales:**
- **Fuerza bruta:** 6 logins fallidos con el mismo correo. Resultado esperado: «Demasiados intentos».
- **DPI cifrado:** después de registrarse, revisar `cliente_perfil.dpi_cifrado` en phpMyAdmin. Debe verse `v1:…`, no el número. En `/cuenta/seguridad` aparece enmascarado.
- **Bitácora a prueba de manipulación:**
  1. En phpMyAdmin, cambiar la IP de una fila de `auditoria`.
  2. Correr `npm run auditoria:verificar`. Resultado esperado: «ALERTA: cadena rota en el evento #N».
  3. `/admin/auditoria` muestra la alerta en rojo.
  4. Restaurar el valor original.
- **2FA obligatorio:** un administrador sin 2FA que intenta entrar a `/admin` es enviado a `/cuenta/seguridad?requiere2fa=1`.

### 6.4 Guion de demostración (5 min)
1. Login lado a lado: el sistema PHP con `LIKE` y sin límites, contra el nuevo con mensaje genérico y bloqueo.
2. Activar el 2FA con el QR en vivo usando una app autenticadora del celular.
3. Mostrar el DPI cifrado en la base de datos y enmascarado en la interfaz.
4. Demo de la bitácora manipulada.
5. Cierre: «no escribimos nuestra propia criptografía ni nuestro propio login; usamos librerías mantenidas y las configuramos de forma segura».

### 6.5 Preguntas probables
- **¿Por qué no JWT?** Las sesiones en la base de datos se pueden revocar de inmediato, por ejemplo al cambiar la contraseña o el rol. Un JWT sigue siendo válido hasta que vence.
- **¿Y si roban la base de datos?** Las contraseñas tienen hash scrypt. El DPI está cifrado y la clave no está en la base de datos sino en Secrets Manager. La base de datos además está cifrada en reposo con KMS.
- **¿Por qué los clientes migrados deben restablecer su contraseña?** Para no heredar contraseñas débiles y para verificar que el correo sigue siendo suyo.

---

## 7. Integrante 5: Ciberdefensa (pruebas ofensivas, WAF y monitoreo)

### 7.1 Alcance
- **Fase 4 del PDF:** caja negra, caja gris/blanca, casos de abuso y perímetro.
- **Fase 6 del PDF:** WAF, RASP y SIEM.

### 7.2 Funciones de la lógica de negocio que más se atacan

| Archivo → función | Qué hace | Ataque que impide |
|---|---|---|
| `src/lib/ordenes.ts` → `iniciarPago` | Calcula el total **en el servidor** desde la base de datos y crea la orden | Manipular el precio desde el navegador |
| … → `confirmarPago` | Toma la orden con un UPDATE condicional (`pendiente → procesando`); solo una petición gana | Condición de carrera: doble clic que descuenta el stock dos veces |
| … → `finalizarCaptura` | Compara el monto, la moneda y el `custom_id` contra PayPal; si no coinciden o falta stock, **reembolsa** | Pago parcial o alterado |
| `src/lib/paypal.ts` | Crea, captura, reembolsa y consulta las órdenes de servidor a servidor, con `PayPal-Request-Id` para que reintentar no duplique la operación | Duplicar cobros |
| `scripts/conciliar-pagos.ts` | Revisa las órdenes pendientes contra PayPal y las finaliza, reembolsa o cancela | Cobros perdidos por un *timeout* |
| `src/app/(cliente)/pedido/[id]/page.tsx` | Muestra el pedido solo si pertenece al usuario; si no, responde 404 | IDOR/BOLA (`compra_detalle.php`) |
| `src/lib/carrito.ts` | El carrito vive en una *cookie* firmada con HMAC; el precio nunca sale de la *cookie* | Alterar la *cookie* |
| `src/lib/uploads.ts` | Valida el tipo de imagen por su contenido real (*magic bytes*), limita a 2 MB y le asigna un nombre UUID | Subir una *web shell* |
| `src/proxy.ts` | CSP con *nonce* distinto en cada petición | XSS |
| `infra/waf/` | Nginx + ModSecurity OWASP CRS (nivel de paranoia 2) y límites de tasa en las rutas de login | Inyección, escaneos y fuerza bruta en el perímetro |
| `src/lib/logger.ts` + `audit.ts` | Logs JSON hacia CloudWatch y el SIEM, con datos sensibles ocultos | Detección y respuesta |

### 7.3 Cómo probarlo

**Suite automática de casos de abuso:**
```bash
npx playwright test e2e/compra.spec.ts e2e/cabeceras.spec.ts
```
Cubre IDOR, la condición de carrera, la *cookie* alterada, el acceso de un cliente al panel admin, la CSP y el *path traversal*.

**Caja negra.** Desde fuera, sin credenciales:
```bash
nmap -sV -p- localhost              # solo debe exponerse el puerto de la app (o 8080 del WAF)
# ZAP Desktop: Automated Scan a http://localhost:8080 (laboratorio con WAF) o :3000
# Ver security/zap/README.md para el escaneo autenticado
```

**Caja gris.** Con Burp Suite Community o la pestaña Network del navegador:

| Caso | Pasos | Resultado esperado |
|---|---|---|
| IDOR | Con un usuario B, abrir `/pedido/<id-de-A>` | 404, y `acceso.pedido_ajeno` registrado en la bitácora |
| Manipulación de precio | Interceptar el checkout e intentar enviar `total=1` | Se ignora: el servidor recalcula el total. El WAF de laboratorio además bloquea esos campos (regla 1200) |
| SQLi | En la búsqueda: `' OR 1=1 --`; en el producto: `/producto/1%20OR%201=1` | «No se encontraron productos» y 404 |
| XSS almacenado | Como admin, crear un producto llamado `<img src=x onerror=alert(1)>` | Se muestra como texto y no aparece ninguna alerta |
| *Path traversal* | `/api/imagenes/..%2F..%2F.env.local` | 404 |
| *Open redirect* | `/login?next=https://evil.example` | Después del login se queda en el sitio |
| Fuerza bruta | Burp Intruder sobre el login | Se bloquea al quinto intento; a través del WAF, nginx responde 429 |

**Laboratorio con WAF (Docker Desktop).** El procedimiento completo y los resultados obtenidos están en `docs/EVIDENCIA_LABORATORIO.md`:
```bash
docker compose up -d db && docker compose --profile migrate run --rm migrate
docker compose --profile tareas run --rm tareas npx tsx --conditions=react-server scripts/seed.ts
docker compose up -d waf app
curl "http://localhost:8080/tienda?q=1'%20UNION%20SELECT%20password%20FROM%20user--"   # 403 de ModSecurity
docker compose logs waf | grep -i "ModSecurity"                                       # evidencia del bloqueo
```

**SIEM.** Ver `docs/DEVSECOPS.md` §4:
- Los logs de la app son JSON. Por ejemplo, un login fallido se registra con `"type":"audit","event":"auth.login.failed","ip":…,"email_hash":…`.
- En AWS, CloudWatch tiene alarmas para fuerza bruta (`auth.login.failed`), accesos denegados (`authz.denied`) y montos manipulados (`payment.amount_mismatch`), y consultas de Logs Insights listas para usar.

### 7.4 Guion de demostración (5 min)
1. Superficie de ataque: tabla de rutas públicas y privadas (ver §2) y el resultado de nmap.
2. Caja negra: reporte de ZAP antes (sistema PHP: sin cabeceras, cookies sin flags) y después (nuevo sistema).
3. Caja gris en vivo con Burp: IDOR → 404; un SQLi a través del WAF → 403 de ModSecurity.
4. Caso de abuso de negocio: las dos pestañas aprobando el mismo pago, con el stock descontado una sola vez (`compra.spec.ts`).
5. Monitoreo: el evento llega como JSON, la consulta del SIEM detecta la fuerza bruta y el runbook dice qué hacer.

### 7.5 Preguntas probables
- **¿Hay RASP?** No hay un producto RASP comercial. Su función se cubre con controles dentro de la aplicación:
  - validación en cada capa y autorización por objeto;
  - detección de montos manipulados y de la bitácora alterada;
  - eventos de seguridad en tiempo real hacia el SIEM.

  Si hiciera falta un RASP formal, se puede proponer uno como trabajo futuro, por ejemplo OpenRASP o Datadog ASM.
- **¿Por qué no se usan webhooks de PayPal?** La captura es síncrona y verificada. La conciliación (`npm run pagos:conciliar`) cubre los casos que un webhook resolvería: respuestas perdidas, capturas PENDING y reembolsos.

---

## 8. Matriz completa de pruebas

| # | Control | Prueba automática | Prueba manual | Responsable |
|---|---|---|---|---|
| 1 | CSP con nonce y cabeceras | `e2e/cabeceras.spec.ts` | DevTools → Network → Headers | 5 |
| 2 | Contraseñas robustas y HIBP | `tests/validation.test.ts`, `e2e/auth.spec.ts` | Registrarse con «password123456» | 4 |
| 3 | Verificación de correo | `e2e/auth.spec.ts` | Intentar entrar antes de activar la cuenta | 4 |
| 4 | Límite de intentos y bloqueo | `e2e/auth.spec.ts` | 6 logins fallidos | 4 |
| 5 | 2FA obligatorio para admin | `e2e/admin.spec.ts` | Un admin nuevo intenta entrar a `/admin` | 4 |
| 6 | Autorización admin y sesión reciente | `e2e/compra.spec.ts` (un cliente en `/admin`) | Cambiar un rol con una sesión de más de 10 min | 4 |
| 7 | IDOR en pedidos | `e2e/compra.spec.ts` | Burp: el pedido de otro usuario | 5 |
| 8 | Precio desde el servidor y condición de carrera | `e2e/compra.spec.ts`, `tests/precios.test.ts` | Dos pestañas aprobando el mismo pago | 5 |
| 9 | XSS almacenado | `e2e/admin.spec.ts` | Crear un producto con un *payload* | 5 |
| 10 | SQLi | `e2e/admin.spec.ts`, `tests/validation.test.ts` | Búsqueda con `' OR 1=1 --` | 5 |
| 11 | Cookie firmada | `e2e/compra.spec.ts` | Editar la *cookie* `vos.carrito` | 5 |
| 12 | Cifrado del DPI | `tests/crypto.test.ts` | Revisar la tabla `cliente_perfil` | 4 |
| 13 | Bitácora encadenada | `npm run auditoria:verificar`, `e2e/admin.spec.ts` | Alterar una fila | 4 |
| 14 | *Open redirect* | `tests/rutas.test.ts`, `e2e/auth.spec.ts` | `/login?next=https://…` | 5 |
| 15 | Subida de imágenes | `e2e/cabeceras.spec.ts` (*path traversal*) | Subir un `.php` renombrado a `.jpg` → «Formato no permitido» | 5 |
| 16 | SAST | Job `sast` | El PR `demo-sast` | 1 |
| 17 | SCA y cadena de suministro | Job `sca`, `npm audit` | `lockfile-lint` | 1 |
| 18 | Contenedor | Job `container` (Trivy) | `trivy image` | 1 |
| 19 | Secretos | Job `secrets` (Gitleaks) | `gitleaks detect` | 1 |
| 20 | IaC | Job `iac` (Checkov) | La demo del puerto 22 | 3 |
| 21 | DAST | Job `dast` (ZAP) | ZAP Desktop | 5 |
| 22 | Readiness | `e2e/cabeceras.spec.ts` | `curl /api/health?db=1` con MySQL apagado → 503 | 3 |

---

## 9. Guion de la exposición conjunta (~30 min)

| Min | Quién | Tema |
|---|---|---|
| 0–3 | 2 | Problema: el sistema PHP y sus 32 hallazgos, con la matriz de calor «antes» |
| 3–8 | 2 | STRIDE/DREAD, las 7 capas y los requisitos RS |
| 8–13 | 3 | Arquitectura cloud y Terraform con Checkov |
| 13–18 | 4 | Codificación segura: login, 2FA, cifrado y bitácora |
| 18–23 | 1 | DevSecOps: pipeline, SAST con un PR bloqueado, Trivy y SBOM |
| 23–28 | 5 | Ciberdefensa: ZAP, Burp, WAF, casos de abuso y SIEM |
| 28–30 | 2 | Matriz de calor «después», riesgo residual y dictamen final |

**Antes de exponer:**
- Correr `npm test` y `npm run test:e2e` el mismo día.
- Tener capturas de respaldo de cada demo por si falla la red.
- Correr `npm run e2e:limpiar` después de los ensayos.
