import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export const BUZON = process.env.E2E_MAILBOX_DIR;
export const ADMIN_FILE = path.join(__dirname, ".auth", "admin.json");
export const PASS = "Frase-segura-de-prueba-2026";

export function sufijo() {
  return String(1_000_000 + (Date.now() % 8_999_999));
}

/** TOTP RFC 6238 (SHA-1, 30 s, 6 dígitos) para automatizar el 2FA. */
export function totp(secreto: string, desfase = 0) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secreto.replace(/=+$/, "").toUpperCase()) bits += a.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + desfase));
  const h = createHmac("sha1", Buffer.from(bytes)).update(c).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** Último enlace enviado a `para` cuyo texto/asunto coincide (buzón de archivos MAIL_CAPTURE_DIR). */
export async function enlaceDeCorreo(para: string, asunto: RegExp): Promise<string> {
  if (!BUZON) throw new Error("Defina E2E_MAILBOX_DIR");
  for (let i = 0; i < 20; i++) {
    const archivos = readdirSync(BUZON).filter((f) => f.endsWith(".json")).sort().reverse();
    for (const f of archivos) {
      const c = JSON.parse(readFileSync(path.join(BUZON, f), "utf8")) as { para: string; asunto: string; enlaces: string[] };
      if (c.para === para && asunto.test(c.asunto) && c.enlaces[0]) return c.enlaces[0];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No llegó correo para ${para}`);
}

/** Registra un cliente nuevo, verifica el correo e inicia sesión. */
export async function clienteVerificado(page: Page) {
  const s = sufijo();
  const email = `cliente${s}@e2e.test`;
  await page.goto("/registro");
  await page.getByLabel("Nombres").fill("Ana");
  await page.getByLabel("Apellidos").fill("Pérez");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Teléfono").fill("+502 5555-1234");
  await page.getByLabel(/DPI/).fill(`29${s}0101`.slice(0, 13).padEnd(13, "7"));
  await page.getByLabel(/^Contraseña/).fill(PASS);
  await page.getByLabel("Confirmar contraseña").fill(PASS);
  await page.getByRole("button", { name: "Registrarme" }).click();
  await expect(page.getByText("Si los datos son válidos")).toBeVisible();
  await page.goto(await enlaceDeCorreo(email, /Active su cuenta/));
  if (!(await page.getByRole("button", { name: "Salir" }).isVisible())) await iniciarSesion(page, email, PASS);
  await expect(page.getByRole("button", { name: "Salir" })).toBeVisible();
  return { email };
}

export async function iniciarSesion(page: Page, email: string, pass: string, next = "/") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(pass);
  await page.getByRole("button", { name: "Ingresar" }).click();
}
