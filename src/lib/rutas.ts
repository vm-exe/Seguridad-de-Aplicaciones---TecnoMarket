/**
 * Solo se aceptan rutas internas en ?next= (evita Open Redirect, CWE-601).
 * Módulo puro (sin dependencias de servidor) para poder probarlo con Vitest.
 */
export function rutaSegura(next: string | null | undefined, porDefecto = "/") {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return porDefecto;
  if (/[\u0000-\u001F\u007F]/.test(next)) return porDefecto; // CR/LF y caracteres de control
  return next;
}
