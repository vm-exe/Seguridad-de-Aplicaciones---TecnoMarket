// Panel de pruebas de seguridad: ejecuta los laboratorios con un clic y muestra la salida en vivo.
//
// Controles de seguridad del propio panel (también son material para la exposición):
//  - Escucha SOLO en 127.0.0.1: nadie más en la red puede abrirlo.
//  - Token aleatorio por arranque (como Jupyter); se canjea por una cookie HttpOnly SameSite=Strict.
//  - Cabecera Host validada (anti DNS rebinding) y Origin + cabecera propia en cada POST (anti CSRF).
//  - El navegador solo envía el ID de una prueba del catálogo: no existe ningún campo de comando,
//    y los programas se ejecutan sin shell, con argumentos fijos (sin inyección posible).
//  - Una prueba a la vez, con tiempo máximo; los contenedores se pueden cancelar.
//  - Los secretos de .env.docker se reemplazan por [oculto] en la salida y en el historial.
//  - CSP estricta en el panel; los reportes HTML (ZAP) se sirven aislados con CSP sandbox.
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CATEGORIAS, PRUEBAS, PRUEBAS_POR_ID } from "./catalogo.mjs";
import { RAIZ, abrirNavegador, ejecutar, encontrarDocker, ocultarSecretos, secretosConocidos, terminarArbol } from "./comun.mjs";

const PUERTO = Number(process.env.MONITOR_PORT ?? 4000);
const HOSTS_VALIDOS = new Set([`127.0.0.1:${PUERTO}`, `localhost:${PUERTO}`]);
const ORIGENES_VALIDOS = new Set([`http://127.0.0.1:${PUERTO}`, `http://localhost:${PUERTO}`]);
const DIR_PUBLICO = path.join(RAIZ, "monitor", "public");
const DIR_HISTORIAL = path.join(RAIZ, "reportes", "monitor");
const ARCHIVO_HISTORIAL = path.join(DIR_HISTORIAL, "historial.jsonl");
const TIEMPO_MAXIMO_MS = 10 * 60_000;

const ESTATICOS = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/estilos.css": ["estilos.css", "text/css; charset=utf-8"],
};
const CABECERAS_BASE = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};
const CSP_PANEL = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const CSP_REPORTE = "sandbox allow-scripts allow-popups; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";

const token = randomBytes(24).toString("base64url");
const sesiones = new Set();
const ejecuciones = new Map(); // id -> { id, prueba, lineas[], clientes:Set, estado, ... }
let enCurso = null;

function iguales(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function leerCookie(req, nombre) {
  for (const parte of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nombre) return v.join("=");
  }
  return null;
}

function responder(res, estado, cuerpo, cabeceras = {}) {
  res.writeHead(estado, { ...CABECERAS_BASE, ...cabeceras });
  res.end(cuerpo);
}
const json = (res, estado, datos) => responder(res, estado, JSON.stringify(datos), { "Content-Type": "application/json; charset=utf-8" });

// ---------------------------------------------------------------------------- historial
function leerHistorial(limite = 100) {
  if (!existsSync(ARCHIVO_HISTORIAL)) return [];
  return readFileSync(ARCHIVO_HISTORIAL, "utf8").split("\n").filter(Boolean).slice(-limite).map((l) => JSON.parse(l)).reverse();
}
function ultimoResultadoPorPrueba() {
  const ultimo = {};
  for (const h of leerHistorial(500)) if (!ultimo[h.prueba]) ultimo[h.prueba] = { resultado: h.resultado, fin: h.fin };
  return ultimo;
}

// ---------------------------------------------------------------------------- ejecución
async function laboratorioArriba() {
  try {
    const r = await fetch("http://localhost:8080/healthz", { headers: { "user-agent": "healthcheck" }, signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

function emitir(ej, tipo, datos) {
  const carga = `event: ${tipo}\ndata: ${JSON.stringify(datos)}\n\n`;
  for (const c of ej.clientes) c.write(carga);
}

async function iniciarEjecucion(prueba) {
  const id = `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
  const secretos = secretosConocidos();
  const docker = encontrarDocker();
  const ej = { id, prueba: prueba.id, inicio: new Date().toISOString(), lineas: [], clientes: new Set(), estado: "en-curso", hijos: new Set(), cancelada: false };
  ejecuciones.set(id, ej);
  enCurso = ej;

  const log = (linea) => {
    const l = ocultarSecretos(String(linea), secretos);
    ej.lineas.push(l);
    if (ej.lineas.length > 20_000) ej.lineas.splice(0, 1000);
    emitir(ej, "linea", l);
  };
  const correr = async (programa, args, { env, alSalida } = {}) => {
    if (ej.cancelada) return 130;
    const { hijo, fin } = ejecutar(programa, args, { env, alLinea: (l) => { log(l); alSalida?.(l); } });
    ej.hijos.add(hijo);
    const codigo = await fin;
    ej.hijos.delete(hijo);
    return codigo;
  };
  const capturar = async (programa, args) => {
    let salida = "";
    const { fin } = ejecutar(programa, args, { alLinea: (l) => (salida += l + "\n") });
    await fin;
    return ocultarSecretos(salida, secretos);
  };
  // Cada contenedor de herramienta lleva una etiqueta con el id de la ejecución para poder cancelarlo.
  const dockerRun = (args, opciones) =>
    correr(docker, ["run", "--rm", "--label", `monitor.ejecucion=${id}`, ...args], opciones);

  const ctx = { log, correr, capturar, dockerRun, docker, get cancelada() { return ej.cancelada; } };
  const temporizador = setTimeout(() => cancelar(ej, "Tiempo máximo alcanzado (10 min)"), TIEMPO_MAXIMO_MS);

  log(`▶ ${prueba.nombre} · ${prueba.herramienta}`);
  log(`  Esperado: ${prueba.esperado}`);
  log("");
  let veredicto;
  try {
    if (!docker && prueba.id !== "unitarias") throw new Error("No se encontró Docker. Abra Docker Desktop.");
    if (prueba.requiereLaboratorio && !(await laboratorioArriba())) {
      throw new Error("El laboratorio no está encendido (http://localhost:8080 no responde). Ejecute «npm run laboratorio».");
    }
    veredicto = await prueba.ejecutar(ctx);
  } catch (e) {
    log(`Error: ${e.message}`);
    veredicto = { resultado: "error", resumen: e.message };
  }
  clearTimeout(temporizador);
  if (ej.cancelada) veredicto = { resultado: "cancelada", resumen: ej.motivo ?? "Cancelada por el usuario" };

  ej.estado = "terminada";
  ej.fin = new Date().toISOString();
  ej.resultado = veredicto.resultado;
  ej.resumen = veredicto.resumen;
  const registro = {
    id, prueba: prueba.id, nombre: prueba.nombre, herramienta: prueba.herramienta,
    inicio: ej.inicio, fin: ej.fin, duracionMs: Date.parse(ej.fin) - Date.parse(ej.inicio),
    resultado: veredicto.resultado, resumen: veredicto.resumen,
    ejecutadaPor: `${os.userInfo().username}@${os.hostname()}`,
  };
  mkdirSync(path.join(DIR_HISTORIAL, "logs"), { recursive: true });
  writeFileSync(path.join(DIR_HISTORIAL, "logs", `${id}.log`), ej.lineas.join("\n"), "utf8");
  appendFileSync(ARCHIVO_HISTORIAL, JSON.stringify(registro) + "\n", "utf8");
  log("");
  log(`■ ${veredicto.resultado.toUpperCase()}: ${veredicto.resumen}`);
  emitir(ej, "fin", registro);
  for (const c of ej.clientes) c.end();
  ej.clientes.clear();
  enCurso = null;
}

function cancelar(ej, motivo) {
  if (ej.estado !== "en-curso") return;
  ej.cancelada = true;
  ej.motivo = motivo;
  for (const h of ej.hijos) terminarArbol(h);
  const docker = encontrarDocker();
  if (docker) {
    // Detiene los contenedores de esta ejecución (docker run --rm los elimina al detenerse).
    ejecutar(docker, ["ps", "-q", "--filter", `label=monitor.ejecucion=${ej.id}`], {
      alLinea: (cid) => cid.trim() && ejecutar(docker, ["rm", "-f", cid.trim()]),
    });
  }
}

// ---------------------------------------------------------------------------- estado del laboratorio
async function estadoLaboratorio() {
  const docker = encontrarDocker();
  if (!docker) return { docker: false, servicios: [] };
  let salida = "";
  const { fin } = ejecutar(docker, ["compose", "ps", "--all", "--format", "json"], { alLinea: (l) => (salida += l + "\n") });
  const codigo = await fin;
  if (codigo !== 0) return { docker: false, servicios: [] };
  const servicios = salida.split("\n").filter((l) => l.trim().startsWith("{")).map((l) => {
    const s = JSON.parse(l);
    return { servicio: s.Service, estado: s.State, salud: s.Health || "", puertos: s.Publishers?.filter((p) => p.PublishedPort).map((p) => `${p.URL}:${p.PublishedPort}`) ?? [] };
  });
  return { docker: true, servicios };
}

// ---------------------------------------------------------------------------- servidor HTTP
const servidor = createServer(async (req, res) => {
  try {
    if (!HOSTS_VALIDOS.has(req.headers.host ?? "")) return responder(res, 421, "Host no permitido");
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Canje del token de arranque por una cookie de sesión.
    if (url.pathname === "/" && url.searchParams.has("token")) {
      if (!iguales(url.searchParams.get("token"), token)) return responder(res, 403, "Token inválido");
      const sesion = randomBytes(24).toString("base64url");
      sesiones.add(sesion);
      return responder(res, 303, "", { Location: "/", "Set-Cookie": `monitor_sesion=${sesion}; HttpOnly; SameSite=Strict; Path=/` });
    }
    const autenticado = sesiones.has(leerCookie(req, "monitor_sesion") ?? "");
    if (!autenticado) {
      return responder(res, 401, "Acceso no autorizado. Abra el enlace con token que imprimió «npm run monitor» en la terminal.", { "Content-Type": "text/plain; charset=utf-8" });
    }

    if (req.method === "GET" && ESTATICOS[url.pathname]) {
      const [archivo, tipo] = ESTATICOS[url.pathname];
      return responder(res, 200, readFileSync(path.join(DIR_PUBLICO, archivo)), { "Content-Type": tipo, "Content-Security-Policy": CSP_PANEL });
    }

    if (req.method === "GET" && url.pathname === "/api/catalogo") {
      const ultimo = ultimoResultadoPorPrueba();
      return json(res, 200, {
        categorias: CATEGORIAS,
        // Al navegador solo viaja la descripción; la función ejecutar() nunca sale del servidor.
        pruebas: PRUEBAS.map((p) => ({ ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== "ejecutar")), ultimo: ultimo[p.id] ?? null, reportes: p.reportes.map((r) => ({ ...r, existe: existsSync(path.join(RAIZ, "reportes", r.ruta)) })) })),
        enCurso: enCurso ? { id: enCurso.id, prueba: enCurso.prueba } : null,
      });
    }
    if (req.method === "GET" && url.pathname === "/api/historial") return json(res, 200, leerHistorial());
    if (req.method === "GET" && url.pathname === "/api/laboratorio") return json(res, 200, await estadoLaboratorio());

    let m = /^\/api\/ejecuciones\/([\w-]+)\/eventos$/.exec(url.pathname);
    if (req.method === "GET" && m) {
      const ej = ejecuciones.get(m[1]);
      if (!ej) return json(res, 404, { error: "Ejecución no encontrada" });
      res.writeHead(200, { ...CABECERAS_BASE, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
      for (const l of ej.lineas) res.write(`event: linea\ndata: ${JSON.stringify(l)}\n\n`);
      if (ej.estado !== "en-curso") {
        res.write(`event: fin\ndata: ${JSON.stringify({ resultado: ej.resultado, resumen: ej.resumen })}\n\n`);
        return res.end();
      }
      ej.clientes.add(res);
      req.on("close", () => ej.clientes.delete(res));
      return;
    }

    m = /^\/api\/ejecuciones\/([\w-]+)\/log$/.exec(url.pathname);
    if (req.method === "GET" && m) {
      const archivo = path.join(DIR_HISTORIAL, "logs", `${m[1]}.log`);
      if (!existsSync(archivo)) return responder(res, 404, "No existe");
      return responder(res, 200, readFileSync(archivo), { "Content-Type": "text/plain; charset=utf-8", "Content-Security-Policy": "default-src 'none'" });
    }

    m = /^\/reportes\/([\w-]+)\/(\d+)$/.exec(url.pathname);
    if (req.method === "GET" && m) {
      // Solo se sirven los reportes declarados en el catálogo (no hay rutas arbitrarias).
      const reporte = PRUEBAS_POR_ID.get(m[1])?.reportes[Number(m[2])];
      const archivo = reporte && path.join(RAIZ, "reportes", reporte.ruta);
      if (!archivo || !existsSync(archivo)) return responder(res, 404, "Reporte no generado todavía");
      const tipo = archivo.endsWith(".html") ? "text/html; charset=utf-8" : archivo.endsWith(".json") || archivo.endsWith(".sarif") ? "application/json; charset=utf-8" : "text/plain; charset=utf-8";
      return responder(res, 200, readFileSync(archivo), { "Content-Type": tipo, "Content-Security-Policy": CSP_REPORTE });
    }

    // ---- Acciones (POST): Origin válido + cabecera propia (un formulario de otro sitio no puede enviarla).
    if (req.method === "POST") {
      if (!ORIGENES_VALIDOS.has(req.headers.origin ?? "") || req.headers["x-monitor"] !== "1") return json(res, 403, { error: "Origen no permitido" });

      m = /^\/api\/pruebas\/([\w-]+)\/ejecutar$/.exec(url.pathname);
      if (m) {
        const prueba = PRUEBAS_POR_ID.get(m[1]);
        if (!prueba) return json(res, 404, { error: "Prueba desconocida" });
        if (enCurso) return json(res, 409, { error: "Ya hay una prueba en curso", id: enCurso.id });
        iniciarEjecucion(prueba);
        return json(res, 202, { id: enCurso.id });
      }
      m = /^\/api\/ejecuciones\/([\w-]+)\/cancelar$/.exec(url.pathname);
      if (m) {
        const ej = ejecuciones.get(m[1]);
        if (!ej) return json(res, 404, { error: "Ejecución no encontrada" });
        cancelar(ej, "Cancelada por el usuario");
        return json(res, 202, { ok: true });
      }
    }
    return responder(res, 404, "No encontrado");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) responder(res, 500, "Error interno");
  }
});

export function iniciarMonitor({ abrir = true } = {}) {
  return new Promise((resolve, reject) => {
    servidor.once("error", (e) => {
      if (e.code === "EADDRINUSE") reject(new Error(`El puerto ${PUERTO} está ocupado (¿ya hay un panel abierto?). Use MONITOR_PORT para cambiarlo.`));
      else reject(e);
    });
    servidor.listen(PUERTO, "127.0.0.1", () => {
      const enlace = `http://127.0.0.1:${PUERTO}/?token=${token}`;
      console.log("");
      console.log("  Panel de pruebas de seguridad");
      console.log(`  ${enlace}`);
      console.log("  (enlace personal: el token cambia cada vez que inicia el panel)");
      console.log("  Ctrl+C para cerrar el panel. El laboratorio sigue encendido.");
      console.log("");
      if (abrir && process.env.MONITOR_SIN_NAVEGADOR !== "1") abrirNavegador(enlace);
      resolve(enlace);
    });
  });
}
