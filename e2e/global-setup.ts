import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ADMIN_FILE } from "./utilidades";

/**
 * Con E2E_CREAR_ADMIN=1 crea un administrador nuevo (sin 2FA) usando el script oficial
 * `npm run admin:crear`, para que admin.spec.ts pruebe el alta obligatoria de 2FA.
 * Requiere acceso a la BD desde esta máquina (.env.local).
 */
export default function globalSetup() {
  if (process.env.E2E_CREAR_ADMIN !== "1" || process.env.E2E_SKIP_ADMIN === "1") return;
  const email = `admin${Date.now()}@e2e.test`;
  const password = `Adm-${randomBytes(12).toString("base64url")}9`;
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "admin:crear", "--", email, "Admin E2E"], {
    env: { ...process.env, ADMIN_PASSWORD: password },
    stdio: ["ignore", "inherit", "inherit"], // si falla, su error queda en el log (la contraseña no se imprime)
    shell: process.platform === "win32",
  });
  mkdirSync(path.dirname(ADMIN_FILE), { recursive: true });
  writeFileSync(ADMIN_FILE, JSON.stringify({ email, password }));
}
