// Catálogo de pruebas del panel. Cada prueba ejecuta EXACTAMENTE los comandos documentados en
// docs/LABORATORIOS.md, con versiones fijadas, y compara el resultado con el esperado.
// Ningún comando recibe datos del navegador: el panel solo envía el id de la prueba.
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { RAIZ, npmCli } from "./comun.mjs";

const WAF = "http://localhost:8080";
const JAEGER = "http://localhost:16686";
const rep = (...p) => path.join(RAIZ, "reportes", ...p);
const asegurarDir = (...p) => mkdirSync(rep(...p), { recursive: true });

const IMG = {
  semgrep: "semgrep/semgrep:1.140.0",
  osv: "ghcr.io/google/osv-scanner:v2.2.2",
  gitleaks: "zricethezav/gitleaks:v8.28.0",
  trivy: "aquasec/trivy:0.67.2",
  checkov: "bridgecrew/checkov:3.2.495",
  zap: "ghcr.io/zaproxy/zaproxy:stable",
};
const SOCKET = ["-v", "/var/run/docker.sock:/var/run/docker.sock", "-v", "trivy-cache:/root/.cache"];

const DEMO_SAST = `import { sql } from "drizzle-orm";
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
`;

/** Resultado según el código de salida esperado. */
const porCodigo = (codigo, esperado = 0, ok = "Resultado esperado", mal = "No coincide con lo esperado") =>
  codigo === esperado ? { resultado: "aprobada", resumen: ok } : { resultado: "fallida", resumen: `${mal} (código ${codigo})` };

async function solicitud(ctx, nombre, url, opciones = {}) {
  try {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), ...opciones });
    ctx.log(`${String(r.status).padEnd(4)} ${nombre}`);
    return r;
  } catch (e) {
    ctx.log(`ERR  ${nombre}: ${e.message}`);
    return null;
  }
}

export const CATEGORIAS = [
  { id: "codigo", nombre: "Código y dependencias", fase: "Fase 3" },
  { id: "contenedores", nombre: "Contenedores e infraestructura", fase: "Fase 5" },
  { id: "perimetro", nombre: "Perímetro: WAF y DAST", fase: "Fases 4 y 6" },
  { id: "funcionales", nombre: "Pruebas funcionales de seguridad", fase: "Fases 3 y 4" },
  { id: "monitoreo", nombre: "Monitoreo y auditoría", fase: "Fase 6" },
];

export const PRUEBAS = [
  // ---------------------------------------------------------------- Fase 3
  {
    id: "sast-semgrep",
    categoria: "codigo",
    nombre: "SAST: código de la aplicación",
    herramienta: "Semgrep",
    responsable: "Integrante 1",
    descripcion: "Analiza el código fuente sin ejecutarlo: reglas OWASP Top 10, TypeScript, React, Next.js y 8 reglas propias escritas para los hallazgos del sistema PHP.",
    esperado: "0 hallazgos (código de salida 0).",
    duracion: "1-2 min",
    reportes: [{ nombre: "SARIF", ruta: "sast/semgrep.sarif" }],
    async ejecutar(ctx) {
      asegurarDir("sast");
      const c = await ctx.dockerRun(["-v", `${RAIZ}:/src:ro`, "-v", `${rep("sast")}:/out`, IMG.semgrep,
        "semgrep", "scan", "--metrics=off", "--error", "--no-git-ignore",
        "--config", "p/owasp-top-ten", "--config", "p/typescript", "--config", "p/react", "--config", "p/nextjs",
        "--config", "/src/security/semgrep/reglas-ventas.yml",
        "--sarif-output=/out/semgrep.sarif", "/src/src", "/src/scripts", "/src/monitor"]);
      return porCodigo(c, 0, "0 hallazgos en el código real", "Semgrep encontró hallazgos");
    },
  },
  {
    id: "sast-demo",
    categoria: "codigo",
    nombre: "SAST: demostración con código vulnerable",
    herramienta: "Semgrep",
    responsable: "Integrante 1",
    descripcion: "Escanea un archivo escrito vulnerable a propósito (XSS, SQLi, secreto, token predecible, precio desde el cliente, eval y secreto en logs). Se crea en reportes/, que no se sube a git.",
    esperado: "7 hallazgos ERROR, uno por cada regla propia: demuestra que las reglas detectan lo que deben.",
    duracion: "30 s",
    reportes: [],
    async ejecutar(ctx) {
      asegurarDir("lab-sast");
      writeFileSync(rep("lab-sast", "acciones-pago-demo.tsx"), DEMO_SAST);
      ctx.log("Archivo de demostración: reportes/lab-sast/acciones-pago-demo.tsx");
      let salida = "";
      const c = await ctx.dockerRun(["-v", `${RAIZ}:/src:ro`, IMG.semgrep, "semgrep", "scan", "--metrics=off", "--error", "--no-git-ignore",
        "--config", "/src/security/semgrep/reglas-ventas.yml", "/src/reportes/lab-sast"], { alSalida: (l) => (salida += l + "\n") });
      const n = Number(/(\d+) findings?\./.exec(salida)?.[1] ?? /(\d+) Code Findings?/.exec(salida)?.[1] ?? -1);
      return c === 1 && n === 7
        ? { resultado: "aprobada", resumen: "Las 7 reglas propias detectaron su vulnerabilidad" }
        : { resultado: "fallida", resumen: `Se esperaban 7 hallazgos y hubo ${n < 0 ? "?" : n}` };
    },
  },
  {
    id: "sca",
    categoria: "codigo",
    nombre: "SCA: dependencias vulnerables",
    herramienta: "npm audit + OSV-Scanner",
    responsable: "Integrante 1",
    descripcion: "Busca CVE conocidas en las librerías de terceros. npm audit revisa las de producción; OSV-Scanner revisa todo el lockfile contra la base OSV.dev / GitHub Advisories, respetando las excepciones aceptadas en osv-scanner.toml.",
    esperado: "npm audit: 0 vulnerabilidades. OSV: «No issues found» (1 aceptada con vencimiento).",
    duracion: "1 min",
    reportes: [],
    async ejecutar(ctx) {
      ctx.log("== npm audit (producción, falla en HIGH/CRITICAL)");
      const a = await ctx.correr(process.execPath, [npmCli(), "audit", "--omit=dev", "--omit=optional", "--audit-level=high"]);
      ctx.log("");
      ctx.log("== OSV-Scanner (lockfile completo)");
      const o = await ctx.dockerRun(["-v", `${RAIZ}:/src:ro`, IMG.osv, "scan", "source", "--config", "/src/osv-scanner.toml", "--lockfile", "/src/package-lock.json"]);
      if (a === 0 && o === 0) return { resultado: "aprobada", resumen: "Sin vulnerabilidades no aceptadas" };
      return { resultado: "fallida", resumen: `npm audit: código ${a}; OSV: código ${o}` };
    },
  },
  {
    id: "secretos-git",
    categoria: "codigo",
    nombre: "Secretos en el historial de git",
    herramienta: "Gitleaks",
    responsable: "Integrante 1",
    descripcion: "Revisa todos los commits buscando claves, tokens y contraseñas. Es lo mismo que hace el pipeline antes de aceptar un cambio.",
    esperado: "0 secretos en el historial (los .env reales están en .gitignore y nunca se subieron).",
    duracion: "30 s",
    reportes: [],
    async ejecutar(ctx) {
      if (!existsSync(path.join(RAIZ, ".git"))) return { resultado: "fallida", resumen: "Esta carpeta no es un clon de git: use git clone para obtener el proyecto" };
      const c = await ctx.dockerRun(["-v", `${RAIZ}:/repo:ro`, IMG.gitleaks, "git", "/repo", "--config", "/repo/.gitleaks.toml", "--no-banner", "--redact", "--verbose"]);
      return porCodigo(c, 0, "Ningún secreto en el historial", "Gitleaks encontró secretos en el historial");
    },
  },
  {
    id: "secretos-carpeta",
    categoria: "codigo",
    nombre: "Secretos en la carpeta local",
    herramienta: "Gitleaks",
    responsable: "Integrante 1",
    descripcion: "Escanea los archivos tal como están en el disco, incluidos los que git ignora. Demuestra que la herramienta SÍ detecta los secretos reales del laboratorio (.env.docker, .env.local) y por qué esos archivos nunca deben subirse.",
    esperado: "Detecta secretos, y TODOS están en archivos .env ignorados por git.",
    duracion: "30 s",
    reportes: [{ nombre: "JSON (valores ocultos)", ruta: "secretos/gitleaks.json" }],
    async ejecutar(ctx) {
      asegurarDir("secretos");
      await ctx.dockerRun(["-v", `${RAIZ}:/repo:ro`, "-v", `${rep("secretos")}:/out`, IMG.gitleaks, "dir", "/repo",
        "--config", "/repo/.gitleaks.toml", "--no-banner", "--redact", "--report-format", "json", "--report-path", "/out/gitleaks.json"]);
      let hallazgos = [];
      try {
        hallazgos = JSON.parse(readFileSync(rep("secretos", "gitleaks.json"), "utf8"));
      } catch {
        return { resultado: "fallida", resumen: "No se generó el reporte de Gitleaks" };
      }
      const fuera = hallazgos.filter((h) => !/(^|\/)\.env(\.local|\.docker)?$/.test(h.File));
      const archivos = [...new Set(hallazgos.map((h) => h.File.replace(/^\/repo\//, "")))];
      ctx.log(`Secretos detectados: ${hallazgos.length}, en: ${archivos.join(", ") || "(ninguno)"}`);
      if (fuera.length) return { resultado: "fallida", resumen: `${fuera.length} secreto(s) fuera de los .env: revíselos` };
      if (!hallazgos.length) return { resultado: "aprobada", resumen: "Sin secretos (no hay archivos .env locales)" };
      return { resultado: "aprobada", resumen: `${hallazgos.length} secretos detectados, todos en archivos .env ignorados por git` };
    },
  },

  // ---------------------------------------------------------------- Fase 5
  {
    id: "trivy-app",
    categoria: "contenedores",
    nombre: "Imagen de la aplicación",
    herramienta: "Trivy",
    responsable: "Integrante 1",
    descripcion: "Busca CVE del sistema operativo y de las librerías, además de secretos, dentro de la imagen Docker de la app. También genera el SBOM (inventario de componentes).",
    esperado: "0 vulnerabilidades CRITICAL/HIGH con parche disponible.",
    duracion: "1 min",
    reportes: [{ nombre: "SBOM CycloneDX", ruta: "trivy/sbom-imagen.json" }],
    async ejecutar(ctx) {
      asegurarDir("trivy");
      const c = await ctx.dockerRun([...SOCKET, IMG.trivy, "image", "--quiet", "--scanners", "vuln,secret", "--severity", "CRITICAL,HIGH", "--ignore-unfixed", "--exit-code", "1", "ventas-online-segura:local"]);
      ctx.log("");
      ctx.log("== SBOM (CycloneDX)");
      await ctx.dockerRun([...SOCKET, "-v", `${rep("trivy")}:/out`, IMG.trivy, "image", "--quiet", "--format", "cyclonedx", "--output", "/out/sbom-imagen.json", "ventas-online-segura:local"]);
      return porCodigo(c, 0, "0 CRITICAL/HIGH con parche", "Hay vulnerabilidades con parche disponible");
    },
  },
  {
    id: "trivy-waf",
    categoria: "contenedores",
    nombre: "Imagen del WAF",
    herramienta: "Trivy",
    responsable: "Integrante 1",
    descripcion: "El WAF es una imagen propia: OWASP CRS más el módulo OpenTelemetry de nginx.org (86 paquetes adicionales). También se escanea.",
    esperado: "0 vulnerabilidades CRITICAL/HIGH con parche disponible.",
    duracion: "1 min",
    reportes: [],
    async ejecutar(ctx) {
      const c = await ctx.dockerRun([...SOCKET, IMG.trivy, "image", "--quiet", "--scanners", "vuln,secret", "--severity", "CRITICAL,HIGH", "--ignore-unfixed", "--exit-code", "1", "ventas-waf:local"]);
      return porCodigo(c, 0, "0 CRITICAL/HIGH con parche", "Hay vulnerabilidades con parche disponible");
    },
  },
  {
    id: "trivy-contraste",
    categoria: "contenedores",
    nombre: "Contraste: imagen obsoleta",
    herramienta: "Trivy",
    responsable: "Integrante 1",
    descripcion: "Escanea node:16-alpine, una imagen sin soporte, para comparar con la nuestra. Aquí SÍ deben aparecer vulnerabilidades.",
    esperado: "Encuentra vulnerabilidades CRITICAL/HIGH (en la validación: 1 CRITICAL y 41 HIGH).",
    duracion: "1-2 min",
    reportes: [],
    async ejecutar(ctx) {
      const c = await ctx.dockerRun([...SOCKET, IMG.trivy, "image", "--quiet", "--severity", "CRITICAL,HIGH", "--exit-code", "1", "node:16-alpine"]);
      return c === 1
        ? { resultado: "aprobada", resumen: "La imagen obsoleta tiene vulnerabilidades, como se esperaba" }
        : { resultado: "fallida", resumen: `Código ${c}: se esperaban vulnerabilidades` };
    },
  },
  {
    id: "iac",
    categoria: "contenedores",
    nombre: "Infraestructura como código",
    herramienta: "Checkov + Trivy config",
    responsable: "Integrante 3",
    descripcion: "Revisa el Terraform de AWS, los Dockerfile y el workflow de GitHub Actions contra cientos de buenas prácticas (cifrado, mínimo privilegio, logs, red). Las excepciones están justificadas junto a cada recurso.",
    esperado: "Checkov: 0 controles fallidos. Trivy config: código de salida 0.",
    duracion: "1-2 min",
    reportes: [],
    async ejecutar(ctx) {
      ctx.log("== Checkov");
      const ck = await ctx.dockerRun(["-v", `${RAIZ}:/src:ro`, "-w", "/src", IMG.checkov, "-d", ".",
        "--framework", "terraform,dockerfile,github_actions", "--skip-path", "node_modules", "--skip-path", ".next", "--skip-path", "reportes",
        "--config-file", "security/checkov/.checkov.yaml", "--compact", "--quiet"]);
      ctx.log("");
      ctx.log("== Trivy config");
      const tc = await ctx.dockerRun(["-v", "trivy-cache:/root/.cache", "-v", `${RAIZ}:/src:ro`, IMG.trivy, "config", "--quiet", "--severity", "CRITICAL,HIGH", "--exit-code", "1",
        "--skip-dirs", "/src/node_modules", "--skip-dirs", "/src/.next", "/src"]);
      if (ck === 0 && tc === 0) return { resultado: "aprobada", resumen: "Checkov y Trivy config sin fallos" };
      return { resultado: "fallida", resumen: `Checkov: código ${ck}; Trivy config: código ${tc}` };
    },
  },

  // ---------------------------------------------------------------- Fases 4 y 6
  {
    id: "waf-ataques",
    categoria: "perimetro",
    nombre: "Ataques contra el WAF",
    herramienta: "ModSecurity + OWASP CRS",
    responsable: "Integrante 5",
    requiereLaboratorio: true,
    descripcion: "Lanza SQLi, UNION, XSS, inyección de comandos, path traversal y un escáner automatizado contra la tienda, y muestra qué regla del CRS bloqueó cada uno.",
    esperado: "403 en cada ataque (400 en path traversal) y el ID de la regla que lo detuvo.",
    duracion: "15 s",
    reportes: [],
    async ejecutar(ctx) {
      const form = (v) => ({ method: "POST", body: new URLSearchParams({ nombres: v }), headers: { "content-type": "application/x-www-form-urlencoded" } });
      const casos = [
        ["SQLi booleana        GET /tienda?q=' OR 1=1--", `${WAF}/tienda?q=%27%20OR%201%3D1--`, {}, [403]],
        ["SQLi UNION           POST /registro", `${WAF}/registro`, form("x' UNION SELECT password FROM user--"), [403]],
        ["XSS                  POST /registro <script>", `${WAF}/registro`, form("<script>alert(1)</script>"), [403]],
        ["Comandos             GET /tienda?q=;cat /etc/passwd", `${WAF}/tienda?q=;cat%20/etc/passwd`, {}, [403]],
        ["Escáner              User-Agent: sqlmap/1.8", `${WAF}/`, { headers: { "user-agent": "sqlmap/1.8" } }, [403]],
        ["Path traversal       /api/imagenes/../../etc/passwd", `${WAF}/api/imagenes/..%2F..%2F..%2Fetc%2Fpasswd`, {}, [400, 403, 404]],
      ];
      ctx.log("Código  Ataque");
      let fallos = 0;
      for (const [nombre, url, op, esperados] of casos) {
        const r = await solicitud(ctx, nombre, url, op);
        if (!r || !esperados.includes(r.status)) fallos++;
      }
      ctx.log("");
      ctx.log("== Qué reglas del CRS detuvieron cada ataque (log de auditoría JSON de ModSecurity)");
      await new Promise((r) => setTimeout(r, 1500));
      const log = await ctx.capturar(ctx.docker, ["compose", "logs", "waf", "--since", "1m", "--no-log-prefix"]);
      const reglas = new Set();
      for (const l of log.split("\n")) {
        if (!l.startsWith('{"transaction"')) continue;
        let t;
        try {
          t = JSON.parse(l).transaction;
        } catch {
          continue;
        }
        if (!t.messages?.length) continue;
        ctx.log("");
        ctx.log(`${t.request.method} ${decodeURIComponent(t.request.uri).slice(0, 90)}`);
        for (const m of t.messages) {
          if (["949110", "980170"].includes(m.details?.ruleId)) continue; // puntaje total, no el ataque
          reglas.add(m.details.ruleId);
          ctx.log(`  regla ${m.details.ruleId}  ${m.message}`);
        }
        const traza = /^00-([0-9a-f]{32})-/.exec(t.request.headers?.traceparent ?? "")?.[1];
        if (traza) ctx.log(`  traza en Jaeger: ${JAEGER}/trace/${traza}`);
      }
      if (!reglas.size) ctx.log("(no se encontraron transacciones bloqueadas en el log)");
      return fallos === 0
        ? { resultado: "aprobada", resumen: `Los ${casos.length} ataques fueron bloqueados${reglas.size ? ` (${reglas.size} reglas distintas)` : ""}` }
        : { resultado: "fallida", resumen: `${fallos} ataque(s) no tuvieron la respuesta esperada` };
    },
  },
  {
    id: "waf-fuerza-bruta",
    categoria: "perimetro",
    nombre: "Fuerza bruta en el login",
    herramienta: "nginx limit_req",
    responsable: "Integrante 5",
    requiereLaboratorio: true,
    descripcion: "Envía 20 intentos de login seguidos. El WAF permite una pequeña ráfaga y luego corta con 429 (Too Many Requests). El límite se libera solo en un minuto.",
    esperado: "Unos 6 intentos con 200 y el resto con 429.",
    duracion: "10 s",
    reportes: [],
    async ejecutar(ctx) {
      const codigos = [];
      for (let i = 1; i <= 20; i++) {
        try {
          const r = await fetch(`${WAF}/login`, { method: "POST", body: "x=1", headers: { "content-type": "application/x-www-form-urlencoded" }, redirect: "manual", signal: AbortSignal.timeout(10_000) });
          codigos.push(r.status);
          ctx.log(`Intento ${String(i).padStart(2)}: ${r.status}`);
        } catch (e) {
          ctx.log(`Intento ${i}: error ${e.message}`);
        }
      }
      const limitados = codigos.filter((c) => c === 429).length;
      return limitados > 0
        ? { resultado: "aprobada", resumen: `${codigos.length - limitados} permitidos y ${limitados} cortados con 429` }
        : { resultado: "fallida", resumen: "Ningún intento fue limitado" };
    },
  },
  {
    id: "waf-cabeceras",
    categoria: "perimetro",
    nombre: "Cabeceras de seguridad",
    herramienta: "nginx + Next.js",
    responsable: "Integrante 5",
    requiereLaboratorio: true,
    descripcion: "Revisa las cabeceras que protegen al navegador: CSP con nonce (anti-XSS), HSTS, anti-clickjacking, nosniff, y que no se revele la versión del servidor.",
    esperado: "Una sola CSP con nonce, HSTS, X-Frame-Options DENY, nosniff y sin cabecera Server.",
    duracion: "5 s",
    reportes: [],
    async ejecutar(ctx) {
      const r = await solicitud(ctx, "GET /tienda", `${WAF}/tienda`);
      if (!r) return { resultado: "fallida", resumen: "La tienda no responde" };
      ctx.log("");
      const h = r.headers;
      const csp = h.get("content-security-policy") ?? "";
      const chequeos = [
        ["Content-Security-Policy con nonce", /'nonce-[^']+'/.test(csp) && !csp.includes(", ")],
        ["Strict-Transport-Security", (h.get("strict-transport-security") ?? "").includes("max-age=")],
        ["X-Frame-Options: DENY", h.get("x-frame-options") === "DENY"],
        ["X-Content-Type-Options: nosniff", h.get("x-content-type-options") === "nosniff"],
        ["Referrer-Policy", !!h.get("referrer-policy")],
        ["Sin cabecera Server ni X-Powered-By", !h.get("server") && !h.get("x-powered-by")],
      ];
      for (const [n, ok] of chequeos) ctx.log(`${ok ? "OK   " : "FALLA"} ${n}`);
      ctx.log("");
      ctx.log(`CSP: ${csp.slice(0, 220)}${csp.length > 220 ? "…" : ""}`);
      const fallos = chequeos.filter(([, ok]) => !ok).length;
      return fallos === 0 ? { resultado: "aprobada", resumen: "Todas las cabeceras correctas" } : { resultado: "fallida", resumen: `${fallos} cabecera(s) incorrectas` };
    },
  },
  {
    id: "dast-zap",
    categoria: "perimetro",
    nombre: "DAST: escaneo de caja negra",
    herramienta: "OWASP ZAP",
    responsable: "Integrante 5",
    requiereLaboratorio: true,
    descripcion: "ZAP recorre la tienda como lo haría un atacante externo, sin conocer el código, y analiza cada respuesta. Las advertencias aceptadas están justificadas en security/zap/rules.tsv.",
    esperado: "FAIL-NEW: 0 · WARN-NEW: 6 (aceptadas) · PASS: 64.",
    duracion: "2-4 min",
    reportes: [{ nombre: "Reporte HTML de ZAP", ruta: "zap/zap-baseline.html" }],
    async ejecutar(ctx) {
      asegurarDir("zap");
      copyFileSync(path.join(RAIZ, "security", "zap", "rules.tsv"), rep("zap", "rules.tsv"));
      const c = await ctx.dockerRun(["--add-host=host.docker.internal:host-gateway", "-v", `${rep("zap")}:/zap/wrk:rw`, IMG.zap,
        "zap-baseline.py", "-t", "http://host.docker.internal:8080", "-c", "rules.tsv", "-r", "zap-baseline.html", "-J", "zap-baseline.json", "-a", "-j", "-I"]);
      return porCodigo(c, 0, "Sin fallos (las advertencias están aceptadas)", "ZAP encontró fallos");
    },
  },

  // ---------------------------------------------------------------- Fases 3 y 4
  {
    id: "unitarias",
    categoria: "funcionales",
    nombre: "Pruebas unitarias de seguridad",
    herramienta: "Vitest",
    responsable: "Integrante 4",
    descripcion: "Prueban las funciones críticas de forma aislada: dinero en centavos, validación de entradas, cifrado AES-256-GCM del DPI (incluida la etiqueta truncada), redirecciones seguras y rate limit.",
    esperado: "25 pruebas aprobadas.",
    duracion: "10 s",
    reportes: [],
    async ejecutar(ctx) {
      const c = await ctx.correr(process.execPath, [path.join(RAIZ, "node_modules", "vitest", "vitest.mjs"), "run"]);
      return porCodigo(c, 0, "Todas las pruebas unitarias aprobadas", "Hay pruebas unitarias fallidas");
    },
  },
  {
    id: "e2e-waf",
    categoria: "funcionales",
    nombre: "Pruebas E2E a través del WAF",
    herramienta: "Playwright",
    responsable: "Integrante 4",
    requiereLaboratorio: true,
    descripcion: "Un navegador real recorre la tienda a través del WAF: cabeceras y CSP, rutas privadas, path traversal, IDOR en pedidos, cookie de carrito alterada, acceso de un cliente al panel admin y la doble aprobación simultánea de un pago.",
    esperado: "9 pruebas aprobadas.",
    duracion: "1 min",
    reportes: [],
    async ejecutar(ctx) {
      ctx.log("Reiniciando los contadores de rate limit de la app (las pruebas crean usuarios)…");
      await ctx.correr(ctx.docker, ["exec", "ventas-db", "sh", "-c", 'MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysql -uroot ventas_segura -e "DELETE FROM rate_limit"']);
      const c = await ctx.correr(process.execPath, [path.join(RAIZ, "node_modules", "@playwright", "test", "cli.js"), "test", "e2e/cabeceras.spec.ts", "e2e/compra.spec.ts", "--reporter=line"], {
        env: { E2E_BASE_URL: WAF, E2E_MAILBOX_DIR: rep("correos"), E2E_SKIP_ADMIN: "1" },
      });
      return porCodigo(c, 0, "Todas las pruebas E2E aprobadas", "Hay pruebas E2E fallidas");
    },
  },

  // ---------------------------------------------------------------- Fase 6
  {
    id: "monitoreo",
    categoria: "monitoreo",
    nombre: "Recorrido de solicitudes (OpenTelemetry)",
    herramienta: "Jaeger",
    responsable: "Integrante 5",
    requiereLaboratorio: true,
    enlace: { nombre: "Abrir Jaeger", url: JAEGER },
    descripcion: "Genera tráfico legítimo y ataques, y comprueba en Jaeger el diagrama WAF → app → MySQL. Después abra Jaeger para ver cada traza: un ataque bloqueado termina en el WAF.",
    esperado: "Diagrama con ventas-waf → ventas-app → ventas-db (MySQL).",
    duracion: "20 s",
    reportes: [],
    async ejecutar(ctx) {
      ctx.log("== Tráfico legítimo");
      for (const u of ["/", "/tienda", "/tienda?q=mesa", "/producto/603", "/login"]) await solicitud(ctx, `GET ${u}`, WAF + u);
      ctx.log("");
      ctx.log("== Ataques");
      await solicitud(ctx, "SQLi  /tienda?q=' OR 1=1--", `${WAF}/tienda?q=%27%20OR%201%3D1--`);
      await solicitud(ctx, "XSS   /tienda?q=<script>", `${WAF}/tienda?q=%3Cscript%3Ealert(1)%3C/script%3E`);
      await solicitud(ctx, "sqlmap", `${WAF}/`, { headers: { "user-agent": "sqlmap/1.8" } });
      ctx.log("");
      ctx.log("Esperando a que las trazas lleguen a Jaeger (8 s)…");
      await new Promise((r) => setTimeout(r, 8000));
      let deps = [];
      try {
        const r = await fetch(`${JAEGER}/api/dependencies?endTs=${Date.now()}&lookback=3600000`, { signal: AbortSignal.timeout(10_000) });
        deps = (await r.json()).data ?? [];
      } catch (e) {
        return { resultado: "fallida", resumen: `Jaeger no responde: ${e.message}` };
      }
      ctx.log("");
      ctx.log("== Diagrama de servicios (última hora)");
      for (const d of deps) ctx.log(`  ${d.parent}  →  ${d.child}   (${d.callCount} llamadas)`);
      const tiene = (p, h) => deps.some((d) => d.parent === p && d.child.startsWith(h));
      ctx.log("");
      ctx.log(`Abra ${JAEGER} → System Architecture → DAG, o Search → ventas-waf con Tags http.status_code=403`);
      return tiene("ventas-waf", "ventas-app") && tiene("ventas-app", "ventas-db")
        ? { resultado: "aprobada", resumen: "Recorrido completo WAF → app → MySQL visible en Jaeger" }
        : { resultado: "fallida", resumen: "El diagrama no muestra el recorrido completo" };
    },
  },
  {
    id: "bitacora",
    categoria: "monitoreo",
    nombre: "Integridad de la bitácora de auditoría",
    herramienta: "Cadena HMAC",
    responsable: "Integrante 4",
    requiereLaboratorio: true,
    descripcion: "Cada evento de auditoría está encadenado al anterior con un HMAC. El verificador recalcula toda la cadena: si alguien alteró o borró un registro en la base de datos, lo detecta.",
    esperado: "«OK: N eventos íntegros».",
    duracion: "20 s",
    reportes: [],
    async ejecutar(ctx) {
      const c = await ctx.correr(ctx.docker, ["compose", "--profile", "tareas", "run", "--rm", "tareas", "npx", "tsx", "--conditions=react-server", "scripts/verificar-auditoria.ts"]);
      return porCodigo(c, 0, "La cadena de auditoría está íntegra", "La cadena de auditoría fue alterada o no se pudo verificar");
    },
  },
];

export const PRUEBAS_POR_ID = new Map(PRUEBAS.map((p) => [p.id, p]));
