import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Cifrado de campos sensibles (PII) con AES-256-GCM (cifrado autenticado).
 * Sustituye a admin/clases/cifrado.php del legado, que usaba AES-128-CBC con la
 * clave estática "Tr1f0rc3&" (sin derivación, sin MAC -> vulnerable a padding oracle / bit-flipping).
 *
 * Formato almacenado: v1:<iv b64>:<tag b64>:<ciphertext b64>
 * En la nube, FIELD_ENCRYPTION_KEY se obtiene de Secrets Manager (cifrado con KMS).
 */
const KEY = Buffer.from(env.FIELD_ENCRYPTION_KEY, "base64");
const HMAC_KEY = Buffer.from(env.HMAC_KEY, "base64");

export function cifrarCampo(plano: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([cipher.update(plano, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function descifrarCampo(guardado: string): string {
  const [ver, ivB64, tagB64, ctB64] = guardado.split(":");
  if (ver !== "v1" || !ivB64 || !tagB64 || !ctB64) throw new Error("Formato de cifrado no reconocido");
  // Hallazgo SAST (Semgrep gcm-no-tag-length, CWE-310): sin fijar la longitud, un
  // atacante podría presentar una etiqueta truncada (p. ej. 4 bytes) y falsificarla
  // con mucho menos esfuerzo. Se exige la etiqueta completa de 16 bytes.
  const tag = Buffer.from(tagB64, "base64");
  if (tag.length !== 16) throw new Error("Etiqueta de autenticación inválida");
  const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivB64, "base64"), { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

/** HMAC determinista para búsquedas / unicidad sobre datos cifrados (blind index). */
export function hmacIndice(valor: string): string {
  return createHmac("sha256", HMAC_KEY).update(valor).digest("hex");
}

export function hmac(valor: string): string {
  return createHmac("sha256", HMAC_KEY).update(valor).digest("hex");
}

export function compararSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Enmascara un DPI para mostrarlo: **** **** 1234 */
export function enmascararDpi(dpi: string): string {
  return `•••• ••••• ${dpi.slice(-4)}`;
}
