"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { z } from "zod";
import type { EstadoForm } from "@/components/formulario";
import { auditar } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { clasificarError, codigoError, MSG_SERVICIO } from "@/lib/errores";
import { permitir } from "@/lib/rate-limit";
import { contextoSolicitud } from "@/lib/request-context";
import { requerirUsuario } from "@/lib/session";
import { formAObjeto, passwordSchema } from "@/lib/validation";

export type Estado2fa = EstadoForm & { qr?: string; clave?: string; respaldo?: string[]; paso?: "verificar" | "listo" };

const passSchema = z.object({ password: z.string().min(1, "Requerido").max(128) });

export async function iniciar2fa(_p: Estado2fa, fd: FormData): Promise<Estado2fa> {
  const s = await requerirUsuario("/cuenta/seguridad");
  const r = passSchema.safeParse(formAObjeto(fd));
  if (!r.success) return { ok: false, errores: z.flattenError(r.error).fieldErrors };
  if (!(await permitir(`2fa-alta:${s.user.id}`, 5, 900))) return { ok: false, mensaje: "Demasiados intentos" };
  try {
    const res = await auth.api.enableTwoFactor({ body: { password: r.data.password }, headers: await headers() });
    if (res.method !== "totp") return { ok: false, mensaje: "Método de 2FA no soportado" };
    const qr = await QRCode.toDataURL(res.totpURI, { margin: 1, width: 220 });
    const clave = new URL(res.totpURI).searchParams.get("secret") ?? undefined;
    return { ok: true, paso: "verificar", qr, clave, respaldo: res.backupCodes };
  } catch (e) {
    if (!clasificarError(e, "activar 2FA")) return { ok: false, mensaje: MSG_SERVICIO };
    return { ok: false, mensaje: "Contraseña incorrecta" };
  }
}

export async function confirmar2fa(_p: Estado2fa, fd: FormData): Promise<Estado2fa> {
  const s = await requerirUsuario("/cuenta/seguridad");
  const r = z.object({ codigo: z.string().trim().regex(/^\d{6}$/, "Código de 6 dígitos") }).safeParse(formAObjeto(fd));
  if (!r.success) return { ok: false, paso: "verificar", errores: z.flattenError(r.error).fieldErrors };
  try {
    await auth.api.verifyTOTP({ body: { code: r.data.codigo }, headers: await headers() });
  } catch (e) {
    if (!clasificarError(e, "confirmar 2FA")) return { ok: false, paso: "verificar", mensaje: MSG_SERVICIO };
    return { ok: false, paso: "verificar", mensaje: "Código incorrecto. Verifique la hora de su dispositivo." };
  }
  await auditar({ accion: "auth.2fa_activado", resultado: "ok", actorId: s.user.id, actorEmail: s.user.email, ...(await contextoSolicitud()) });
  // verifyTOTP renueva la cookie de sesión (Next refresca la ruta), por eso se redirige explícitamente.
  redirect(s.user.role === "admin" ? "/admin" : "/cuenta/seguridad?activado=1");
}

export async function desactivar2fa(_p: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const s = await requerirUsuario("/cuenta/seguridad");
  const r = passSchema.safeParse(formAObjeto(fd));
  if (!r.success) return { ok: false, errores: z.flattenError(r.error).fieldErrors };
  if (s.user.role === "admin") return { ok: false, mensaje: "Los administradores no pueden desactivar el 2FA." };
  try {
    await auth.api.disableTwoFactor({ body: { password: r.data.password }, headers: await headers() });
  } catch (e) {
    if (!clasificarError(e, "desactivar 2FA")) return { ok: false, mensaje: MSG_SERVICIO };
    await auditar({ accion: "auth.2fa_desactivado", resultado: "denegado", actorId: s.user.id, actorEmail: s.user.email, ...(await contextoSolicitud()) });
    return { ok: false, mensaje: "Contraseña incorrecta" };
  }
  await auditar({ accion: "auth.2fa_desactivado", resultado: "ok", actorId: s.user.id, actorEmail: s.user.email, ...(await contextoSolicitud()) });
  revalidatePath("/cuenta/seguridad");
  return { ok: true, mensaje: "2FA desactivado." };
}

export async function cambiarPassword(_p: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const s = await requerirUsuario("/cuenta/seguridad");
  const r = z
    .object({ actual: z.string().min(1).max(128), password: passwordSchema, repassword: z.string() })
    .refine((d) => d.password === d.repassword, { path: ["repassword"], error: "Las contraseñas no coinciden" })
    .safeParse(formAObjeto(fd));
  if (!r.success) return { ok: false, errores: z.flattenError(r.error).fieldErrors };
  if (!(await permitir(`cambio-pass:${s.user.id}`, 5, 900))) return { ok: false, mensaje: "Demasiados intentos" };
  try {
    await auth.api.changePassword({
      body: { currentPassword: r.data.actual, newPassword: r.data.password, revokeOtherSessions: true },
      headers: await headers(),
    });
  } catch (e) {
    if (!clasificarError(e, "cambiar contraseña")) return { ok: false, mensaje: MSG_SERVICIO };
    if (codigoError(e) === "PASSWORD_COMPROMISED") return { ok: false, errores: { password: ["Esta contraseña aparece en filtraciones públicas. Elija otra."] } };
    await auditar({ accion: "auth.password_cambiado", resultado: "denegado", actorId: s.user.id, actorEmail: s.user.email, ...(await contextoSolicitud()) });
    return { ok: false, mensaje: "La contraseña actual es incorrecta" };
  }
  await auditar({ accion: "auth.password_cambiado", resultado: "ok", actorId: s.user.id, actorEmail: s.user.email, ...(await contextoSolicitud()) });
  return { ok: true, mensaje: "Contraseña actualizada. Se cerraron sus otras sesiones." };
}
