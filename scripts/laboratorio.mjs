#!/usr/bin/env node
// =============================================================================
// Comando único del laboratorio:
//
//   npm run laboratorio            prepara y levanta TODO, y abre el panel de pruebas
//   npm run monitor                solo abre el panel (con el laboratorio ya encendido)
//   npm run laboratorio -- estado  muestra los contenedores
//   npm run laboratorio -- apagar  detiene el laboratorio (conserva los datos)
//   npm run laboratorio -- borrar  detiene y BORRA la base de datos y los secretos locales
//
// Es idempotente: si los secretos, los datos o el administrador ya existen, no los toca.
// =============================================================================
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ES_WINDOWS, RAIZ, dockerActivo, ejecutar, encontrarDocker, npmCli } from "../monitor/comun.mjs";

const ENV_DOCKER = path.join(RAIZ, ".env.docker");
const CREDENCIALES = path.join(RAIZ, "reportes", "credenciales-laboratorio.txt");
const PROYECTO = "ventas-online-segura";

const color = (c, t) => (process.stdout.isTTY ? `\x1b[${c}m${t}\x1b[0m` : t);
const paso = (n, total, t) => console.log(`\n${color("1;34", `[${n}/${total}]`)} ${color("1", t)}`);
const ok = (t) => console.log(`  ${color("32", "✔")} ${t}`);
const info = (t) => console.log(`  ${color("90", t)}`);
function fallar(t, ayuda) {
  console.error(`\n  ${color("31", "✘")} ${t}`);
  if (ayuda) console.error(`    ${ayuda}`);
  process.exit(1);
}

/** Ejecuta un comando mostrando su salida con sangría; termina el proceso si falla. */
async function correr(programa, args, { env, silencioso = false, permitirFallo = false } = {}) {
  const { fin } = ejecutar(programa, args, { env, alLinea: (l) => !silencioso && l.trim() && console.log(color("90", `    ${l}`)) });
  const codigo = await fin;
  if (codigo !== 0 && !permitirFallo) fallar(`Falló: ${path.basename(programa)} ${args.slice(0, 4).join(" ")}… (código ${codigo})`);
  return codigo;
}
function capturar(programa, args) {
  const r = spawnSync(programa, args, { cwd: RAIZ, encoding: "utf8", windowsHide: true });
  return { codigo: r.status, salida: (r.stdout ?? "").trim(), error: (r.stderr ?? "").trim() };
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------- requisitos
async function verificarRequisitos() {
  const mayor = Number(process.versions.node.split(".")[0]);
  if (mayor < 22) fallar(`Se requiere Node 22 (tiene ${process.versions.node}).`, "Descárguelo de https://nodejs.org (versión 22 LTS).");
  ok(`Node ${process.versions.node}`);

  const docker = encontrarDocker();
  if (!docker) fallar("No se encontró Docker.", "Instale Docker Desktop: https://www.docker.com/products/docker-desktop/");
  if (!dockerActivo()) {
    const exe = ES_WINDOWS
      ? [path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "Docker Desktop.exe"), path.join(process.env.LOCALAPPDATA ?? "", "Programs", "DockerDesktop", "Docker Desktop.exe")].find(existsSync)
      : null;
    if (!exe) fallar("Docker no está encendido.", "Abra Docker Desktop, espere a que diga «Engine running» y vuelva a ejecutar el comando.");
    info("Docker Desktop está apagado; iniciándolo (puede tardar hasta 2 minutos)…");
    ejecutar(exe, []);
    for (let i = 0; i < 60 && !dockerActivo(); i++) await esperar(3000);
    if (!dockerActivo()) fallar("Docker Desktop no terminó de iniciar.", "Ábralo manualmente y vuelva a ejecutar el comando.");
  }
  ok(`Docker ${capturar(docker, ["info", "--format", "{{.ServerVersion}}"]).salida}`);
  return docker;
}

// ---------------------------------------------------------------------------- secretos
function generarEnvDocker(docker) {
  if (existsSync(ENV_DOCKER)) {
    ok(".env.docker ya existe (se conservan sus secretos)");
    return;
  }
  // Si hay una base de datos de un laboratorio anterior, sus contraseñas no coincidirían.
  const vol = capturar(docker, ["volume", "ls", "-q", "--filter", `name=${PROYECTO}_dbdata`]).salida;
  if (vol) fallar("Existe una base de datos de un laboratorio anterior, pero falta .env.docker con sus contraseñas.", "Ejecute «npm run laboratorio -- borrar» para empezar de cero.");

  const hex = () => randomBytes(24).toString("hex");
  const b64 = () => randomBytes(32).toString("base64");
  const appPw = hex();
  const migPw = hex();
  const valores = {
    MYSQL_ROOT_PASSWORD: hex(),
    APP_DB_PASSWORD: appPw,
    MIGRATOR_DB_PASSWORD: migPw,
    DATABASE_URL: `mysql://ventas_app:${appPw}@db:3306/ventas_segura`,
    MIGRATOR_DATABASE_URL: `mysql://ventas_migrator:${migPw}@db:3306/ventas_segura`,
    BETTER_AUTH_SECRET: b64(),
    FIELD_ENCRYPTION_KEY: b64(),
    HMAC_KEY: b64(),
  };
  const plantilla = readFileSync(path.join(RAIZ, ".env.docker.example"), "utf8");
  const contenido = plantilla
    .split(/\r?\n/)
    .map((l) => {
      const m = /^([A-Z0-9_]+)=/.exec(l);
      return m && valores[m[1]] ? `${m[1]}=${valores[m[1]]}` : l;
    })
    .join("\n");
  writeFileSync(ENV_DOCKER, contenido, { encoding: "utf8", mode: 0o600 });
  ok(".env.docker creado con secretos aleatorios nuevos (no se sube a git)");
}

// ---------------------------------------------------------------------------- base de datos
function consultaSql(docker, sql) {
  const r = capturar(docker, ["exec", "ventas-db", "sh", "-c", `MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysql -uroot -N -B ventas_segura -e "${sql}"`]);
  return r.codigo === 0 ? r.salida : null;
}

async function crearAdminSiFalta(docker) {
  const n = Number(consultaSql(docker, "SELECT COUNT(*) FROM user WHERE role='admin'") ?? "0");
  if (n > 0) {
    ok(`Ya existe un administrador${existsSync(CREDENCIALES) ? " (credenciales en reportes/credenciales-laboratorio.txt)" : ""}`);
    return;
  }
  const correo = "admin@lab.test";
  const clave = `Lab-${randomBytes(9).toString("base64url")}-2026`;
  // La contraseña viaja por variable de entorno (no como argumento visible en la lista de procesos).
  await correr(docker, ["compose", "--profile", "tareas", "run", "--rm", "-e", "ADMIN_PASSWORD", "tareas",
    "npx", "tsx", "--conditions=react-server", "scripts/crear-admin.ts", correo, "Admin Laboratorio"], { env: { ADMIN_PASSWORD: clave } });
  mkdirSync(path.dirname(CREDENCIALES), { recursive: true });
  writeFileSync(CREDENCIALES, [
    "Credenciales del laboratorio LOCAL (archivo ignorado por git; no lo comparta).",
    "",
    `Administrador: ${correo}`,
    `Contraseña:    ${clave}`,
    "",
    "Al primer ingreso en http://localhost:8080/login el sistema exige activar 2FA (TOTP):",
    "escanee el QR con Google Authenticator, Microsoft Authenticator o similar.",
    "",
  ].join("\n"), { encoding: "utf8", mode: 0o600 });
  ok(`Administrador creado: ${correo} (contraseña en reportes/credenciales-laboratorio.txt)`);
}

// ---------------------------------------------------------------------------- comandos
async function iniciar({ conMonitor = true } = {}) {
  const T = 7;
  console.log(color("1", "\n  Laboratorio de Ventas Online Segura"));
  console.log(color("90", `  Carpeta: ${RAIZ}`));

  paso(1, T, "Requisitos");
  const docker = await verificarRequisitos();

  paso(2, T, "Secretos del laboratorio");
  generarEnvDocker(docker);
  mkdirSync(path.join(RAIZ, "reportes", "correos"), { recursive: true });

  paso(3, T, "Dependencias de Node (pruebas y panel)");
  if (!existsSync(path.join(RAIZ, "node_modules", "vitest"))) {
    info("Instalando dependencias exactas del lockfile (npm ci, sin scripts de instalación)…");
    await correr(process.execPath, [npmCli(), "ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
  }
  ok("node_modules listo");
  const pw = capturar(process.execPath, [path.join(RAIZ, "node_modules", "@playwright", "test", "cli.js"), "install", "chromium"]);
  if (pw.codigo === 0) ok("Navegador de pruebas (Chromium) listo");
  else info("No se pudo instalar Chromium para las pruebas E2E (las demás funcionan igual).");

  paso(4, T, "Construcción de imágenes (la primera vez tarda de 3 a 6 minutos)");
  await correr(docker, ["compose", "--profile", "migrate", "--profile", "tareas", "build"]);
  ok("Imágenes construidas: app, WAF, migraciones y tareas");

  paso(5, T, "Base de datos y migraciones");
  await correr(docker, ["compose", "up", "-d", "--wait", "db"]);
  await correr(docker, ["compose", "--profile", "migrate", "run", "--rm", "migrate"]);
  ok("Esquema al día");
  await correr(docker, ["compose", "--profile", "tareas", "run", "--rm", "tareas", "npx", "tsx", "--conditions=react-server", "scripts/seed.ts"]);
  ok("Catálogo de ejemplo cargado");
  await crearAdminSiFalta(docker);

  paso(6, T, "Aplicación, WAF y monitoreo");
  await correr(docker, ["compose", "up", "-d", "--wait", "app", "waf", "otel-collector", "jaeger"]);
  ok("Tienda (solo a través del WAF):  http://localhost:8080");
  ok("Monitoreo de trazas (Jaeger):     http://localhost:16686");

  paso(7, T, "Panel de pruebas");
  if (!conMonitor) return;
  const { iniciarMonitor } = await import("../monitor/servidor.mjs");
  await iniciarMonitor().catch((e) => fallar(e.message));
}

async function soloMonitor() {
  if (!encontrarDocker()) info("Aviso: no se encontró Docker; solo funcionarán las pruebas unitarias.");
  const { iniciarMonitor } = await import("../monitor/servidor.mjs");
  await iniciarMonitor().catch((e) => fallar(e.message));
}

async function apagar() {
  const docker = encontrarDocker() ?? fallar("No se encontró Docker.");
  await correr(docker, ["compose", "--profile", "migrate", "--profile", "tareas", "down"]);
  ok("Laboratorio detenido. Los datos se conservan; vuelva a encenderlo con «npm run laboratorio».");
}

async function borrar() {
  const docker = encontrarDocker() ?? fallar("No se encontró Docker.");
  if (!process.argv.includes("--si")) {
    console.log("\n  Esto BORRA la base de datos del laboratorio, las imágenes subidas, .env.docker y las credenciales locales.");
    console.log("  Para confirmar: npm run laboratorio -- borrar --si\n");
    return;
  }
  await correr(docker, ["compose", "--profile", "migrate", "--profile", "tareas", "down", "-v"]);
  rmSync(ENV_DOCKER, { force: true });
  rmSync(CREDENCIALES, { force: true });
  ok("Laboratorio borrado. «npm run laboratorio» lo crea de nuevo desde cero.");
}

function mostrarEstado() {
  const docker = encontrarDocker() ?? fallar("No se encontró Docker.");
  const r = capturar(docker, ["compose", "ps", "--all", "--format", "table {{.Service}}\t{{.Status}}\t{{.Ports}}"]);
  console.log(r.salida || "  El laboratorio está apagado.");
}

const comando = process.argv[2] ?? "iniciar";
const acciones = { iniciar, monitor: soloMonitor, apagar, borrar, estado: mostrarEstado };
if (!Object.hasOwn(acciones, comando)) fallar(`Comando desconocido: ${comando}`, "Use: iniciar | monitor | estado | apagar | borrar");
await acciones[comando]();
