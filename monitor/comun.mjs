// Utilidades compartidas por el comando "npm run laboratorio" y el panel de pruebas.
// Sin dependencias externas: solo módulos de Node 22.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ES_WINDOWS = process.platform === "win32";
// En Windows la letra de unidad se normaliza a mayúscula: con "e:\" Vitest carga dos veces el
// mismo módulo y ninguna prueba se registra («Cannot read properties of undefined (reading 'config')»).
export const RAIZ = path
  .resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  .replace(/^[a-z]:/, (u) => u.toUpperCase());

/** true cuando el panel corre dentro de su contenedor (servicio "monitor" de docker-compose). */
export const EN_CONTENEDOR = process.env.MONITOR_EN_CONTENEDOR === "1";

/**
 * Las herramientas de análisis corren en contenedores propios, y Docker monta rutas del EQUIPO
 * ANFITRIÓN, no del contenedor del panel. PROYECTO_HOST es la carpeta del proyecto vista desde el
 * anfitrión (Windows: "E:\...", Linux/macOS: "/home/..."); fuera de un contenedor coincide con RAIZ.
 */
export const PROYECTO_HOST = process.env.PROYECTO_HOST || RAIZ;
const rutasHost = /^[A-Za-z]:\\/.test(PROYECTO_HOST) ? path.win32 : path.posix;
export const rutaHost = (...partes) => rutasHost.join(PROYECTO_HOST, ...partes);

/** Montaje bind con --mount (a diferencia de -v, no se confunde con los ":" de "E:\"). */
export const montaje = (origen, destino, soloLectura = false) => [
  "--mount",
  `type=bind,source=${origen},target=${destino}${soloLectura ? ",readonly" : ""}`,
];

/** Ruta del CLI de npm (npm la expone al ejecutar "npm run"); permite invocarlo sin shell. */
export function npmCli() {
  const candidatos = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const cli = candidatos.find((c) => c && c.endsWith(".js") && existsSync(c));
  if (!cli) throw new Error("No se encontró npm. Ejecute el comando con «npm run laboratorio».");
  return cli;
}

let dockerCache;
/**
 * Localiza el CLI de Docker. En Windows, Docker Desktop no siempre queda en el PATH de las
 * terminales abiertas antes de instalarlo, así que también se prueban sus rutas habituales.
 */
export function encontrarDocker() {
  if (dockerCache) return dockerCache;
  const candidatos = ["docker"];
  if (ES_WINDOWS) {
    candidatos.push(
      path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "resources", "bin", "docker.exe"),
      path.join(process.env.LOCALAPPDATA ?? "", "Programs", "DockerDesktop", "resources", "bin", "docker.exe"),
    );
  }
  for (const c of candidatos) {
    const r = spawnSync(c, ["--version"], { encoding: "utf8", windowsHide: true });
    if (r.status === 0) {
      dockerCache = c;
      // docker compose y los helpers de credenciales se buscan en el PATH: se agrega su carpeta.
      if (c !== "docker") process.env.PATH = `${path.dirname(c)}${path.delimiter}${process.env.PATH}`;
      return c;
    }
  }
  return null;
}

export function dockerActivo() {
  const d = encontrarDocker();
  return !!d && spawnSync(d, ["info", "--format", "{{.ServerVersion}}"], { windowsHide: true }).status === 0;
}

/** Lee .env.docker como objeto (sin interpretar comillas ni variables). */
export function leerEnvDocker() {
  const archivo = path.join(RAIZ, ".env.docker");
  if (!existsSync(archivo)) return {};
  const env = {};
  for (const linea of readFileSync(archivo, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linea);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

/** Valores secretos de .env.docker que nunca deben aparecer en pantalla ni en el historial. */
export function secretosConocidos() {
  return Object.entries(leerEnvDocker())
    .filter(([k, v]) => /PASSWORD|SECRET|KEY|DATABASE_URL/.test(k) && v.length >= 8 && !v.startsWith("CAMBIAR"))
    .map(([, v]) => v);
}

export function ocultarSecretos(texto, secretos) {
  let t = texto;
  for (const s of secretos) t = t.split(s).join("[oculto]");
  return t;
}

/**
 * Ejecuta un programa SIN shell (los argumentos van como arreglo: no hay inyección posible)
 * y entrega su salida línea por línea. Devuelve { hijo, fin } donde fin es una promesa
 * con el código de salida.
 */
export function ejecutar(programa, args, { alLinea = () => {}, env = {}, cwd = RAIZ } = {}) {
  const hijo = spawn(programa, args, {
    cwd,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...env },
    windowsHide: true,
  });
  const partir = (flujo) => {
    let resto = "";
    flujo.setEncoding("utf8");
    flujo.on("data", (trozo) => {
      const lineas = (resto + trozo).split(/\r?\n|\r/);
      resto = lineas.pop() ?? "";
      for (const l of lineas) alLinea(l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""));
    });
    flujo.on("end", () => resto && alLinea(resto.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")));
  };
  partir(hijo.stdout);
  partir(hijo.stderr);
  const fin = new Promise((resolve) => {
    hijo.on("error", (e) => {
      alLinea(`No se pudo ejecutar ${programa}: ${e.message}`);
      resolve(127);
    });
    hijo.on("close", (codigo) => resolve(codigo ?? 1));
  });
  return { hijo, fin };
}

/** Termina un proceso y sus hijos (en Windows, kill() no alcanza a los nietos). */
export function terminarArbol(hijo) {
  if (!hijo || hijo.exitCode !== null) return;
  if (ES_WINDOWS) spawnSync("taskkill", ["/PID", String(hijo.pid), "/T", "/F"], { windowsHide: true });
  else hijo.kill("SIGTERM");
}

export function abrirNavegador(url) {
  const [prog, args] = ES_WINDOWS ? ["explorer.exe", [url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    const hijo = spawn(prog, args, { detached: true, stdio: "ignore", windowsHide: true });
    hijo.on("error", () => {}); // sin navegador (p. ej. en un contenedor): la URL ya se imprimió
    hijo.unref();
  } catch {
    /* sin navegador: la URL ya se imprimió en la consola */
  }
}
