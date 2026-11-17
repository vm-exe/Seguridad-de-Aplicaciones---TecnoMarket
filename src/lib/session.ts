import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auditar } from "./audit";
import { auth } from "./auth";
import { contextoSolicitud } from "./request-context";
export { rutaSegura } from "./rutas";

/**
 * Control de acceso del lado del servidor. Cada página/acción protegida llama a
 * estas funciones (no se confía en ocultar enlaces ni en el proxy).
 * En el legado, admin/productos/borrar.php ni siquiera validaba la sesión.
 */
export const obtenerSesion = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/** Antigüedad máxima de la sesión para acciones administrativas críticas (igual a freshAge). */
export const SESION_RECIENTE_MS = 10 * 60 * 1000;

type SesionActual = NonNullable<Awaited<ReturnType<typeof obtenerSesion>>>;

async function auditarDenegado(s: SesionActual | null, motivo: string) {
  await auditar({
    accion: "acceso.admin_denegado",
    resultado: "denegado",
    actorId: s?.user.id ?? null,
    actorEmail: s?.user.email ?? null,
    objetivo: "/admin",
    ...(await contextoSolicitud()),
    detalle: { motivo },
  });
}

export async function requerirUsuario(destino = "/") {
  const s = await obtenerSesion();
  if (!s) redirect(`/login?next=${encodeURIComponent(destino)}`);
  return s;
}

/** Admin = rol "admin" + no bloqueado + 2FA activo. Los intentos denegados se auditan (control detectivo). */
export async function requerirAdmin() {
  const s = await obtenerSesion();
  if (!s) redirect("/login?next=/admin");
  if (s.user.role !== "admin" || s.user.banned) {
    await auditarDenegado(s, "rol");
    redirect("/");
  }
  if (!s.user.twoFactorEnabled) redirect("/cuenta/seguridad?requiere2fa=1");
  return s;
}

/**
 * Variante para Server Actions: lanza en lugar de redirigir.
 * `reciente: true` exige que la sesión tenga menos de 10 minutos (re-autenticación
 * para acciones críticas como cambiar roles o la configuración).
 */
export async function asegurarAdmin(opciones: { reciente?: boolean } = {}) {
  const s = await obtenerSesion();
  if (!s || s.user.role !== "admin" || s.user.banned || !s.user.twoFactorEnabled) {
    await auditarDenegado(s, !s ? "sin_sesion" : "rol_o_2fa");
    throw new Error("No autorizado");
  }
  if (opciones.reciente && Date.now() - new Date(s.session.createdAt).getTime() > SESION_RECIENTE_MS) {
    await auditar({ accion: "admin.reautenticacion_requerida", resultado: "denegado", actorId: s.user.id, actorEmail: s.user.email, ...(await contextoSolicitud()) });
    throw new ErrorReautenticacion();
  }
  return s;
}

export class ErrorReautenticacion extends Error {
  constructor() {
    super("Por seguridad, vuelva a iniciar sesión para realizar esta acción");
  }
}
