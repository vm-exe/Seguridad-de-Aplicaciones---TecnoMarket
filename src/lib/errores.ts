import "server-only";
import { APIError } from "better-auth/api";
import { logger } from "./logger";

/**
 * Distingue errores esperados del usuario (4xx de Better Auth: contraseña o código
 * incorrecto) de fallas del sistema (BD caída, red, 5xx). Las fallas del sistema se
 * registran y se muestran como "servicio no disponible" en lugar de un mensaje
 * engañoso como "contraseña incorrecta".
 */
export function esErrorDeUsuario(e: unknown): e is APIError {
  return e instanceof APIError && Number(e.statusCode) >= 400 && Number(e.statusCode) < 500;
}

export function codigoError(e: unknown): string | undefined {
  return e instanceof APIError ? String((e.body as { code?: string } | undefined)?.code ?? e.status) : undefined;
}

export const MSG_SERVICIO = "El servicio no está disponible en este momento. Intente más tarde.";

/** Registra la falla inesperada y devuelve true si era un error del usuario. */
export function clasificarError(e: unknown, operacion: string): boolean {
  if (esErrorDeUsuario(e)) return true;
  logger.error(`Falla inesperada en ${operacion}`, { error: e instanceof Error ? e.message : String(e) });
  return false;
}
