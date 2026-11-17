"use server";

import { eq } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { EstadoForm } from "@/components/formulario";
import { db } from "@/db";
import { clientePerfil, user } from "@/db/schema";
import { auditar } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { cifrarCampo, hmacIndice } from "@/lib/crypto";
import { clasificarError, codigoError, MSG_SERVICIO } from "@/lib/errores";
import { logger } from "@/lib/logger";
import { permitir, permitirIp } from "@/lib/rate-limit";
import { contextoSolicitud } from "@/lib/request-context";
import { rutaSegura } from "@/lib/session";
import { formAObjeto, loginSchema, passwordSchema, registroSchema } from "@/lib/validation";

const DEMASIADOS: EstadoForm = { ok: false, mensaje: "Demasiados intentos. Espere unos minutos e intente de nuevo." };

/* ---------------------------------- Login --------------------------------- */
export async function iniciarSesion(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const ctx = await contextoSolicitud();
  const datos = formAObjeto(fd);
  const r = loginSchema.safeParse(datos);
  if (!r.success) return { ok: false, mensaje: "Revise los campos", errores: z.flattenError(r.error).fieldErrors, valores: { email: datos.email ?? "" } };

  // Doble llave: por IP y por cuenta (evita fuerza bruta distribuida y "password spraying").
  const okIp = await permitirIp("login", ctx.ip, 10, 300);
  const okCuenta = await permitir(`login:cuenta:${hmacIndice(r.data.email)}`, 5, 900);
  if (!okIp || !okCuenta) {
    await auditar({ accion: "auth.login_bloqueado", resultado: "denegado", actorEmail: r.data.email, ...ctx });
    return DEMASIADOS;
  }

  let dosFactores = false;
  try {
    const res = await auth.api.signInEmail({
      body: { email: r.data.email, password: r.data.password, callbackURL: "/login?verificado=1" },
      headers: await headers(),
    });
    dosFactores = "twoFactorRedirect" in res && !!res.twoFactorRedirect;
  } catch (e) {
    if (!clasificarError(e, "login")) return { ok: false, mensaje: MSG_SERVICIO, valores: { email: r.data.email } };
    await auditar({
      accion: "auth.login_fallido",
      resultado: "denegado",
      actorEmail: r.data.email,
      ...ctx,
      detalle: { codigo: e instanceof APIError ? String(e.body?.code ?? e.status) : "error" },
    });
    // Mensaje genérico: no revela si el correo existe ni si la cuenta está sin verificar.
    return { ok: false, mensaje: "Credenciales inválidas o cuenta no activada. Si acaba de registrarse, revise su correo.", valores: { email: r.data.email } };
  }

  const next = rutaSegura(fd.get("next")?.toString(), "/");
  if (dosFactores) redirect(`/login/2fa?next=${encodeURIComponent(next)}`);
  redirect(next);
}

/* ------------------------------ Segundo factor ----------------------------- */
const codigoSchema = z.object({ codigo: z.string().trim().regex(/^\d{6}$/, "Código de 6 dígitos") });
const respaldoSchema = z.object({ codigo: z.string().trim().min(8).max(20) });

export async function verificarSegundoFactor(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const ctx = await contextoSolicitud();
  const respaldo = fd.get("tipo") === "respaldo";
  const r = (respaldo ? respaldoSchema : codigoSchema).safeParse(formAObjeto(fd));
  if (!r.success) return { ok: false, errores: z.flattenError(r.error).fieldErrors };
  if (!(await permitirIp("2fa", ctx.ip, 5, 300))) return DEMASIADOS;
  try {
    if (respaldo) await auth.api.verifyBackupCode({ body: { code: r.data.codigo }, headers: await headers() });
    else await auth.api.verifyTOTP({ body: { code: r.data.codigo }, headers: await headers() });
  } catch (e) {
    if (!clasificarError(e, "verificación 2FA")) return { ok: false, mensaje: MSG_SERVICIO };
    const codigo = codigoError(e);
    await auditar({ accion: "auth.2fa_fallido", resultado: "denegado", ...ctx, detalle: { codigo } });
    // Better Auth bloquea la cuenta tras 5 códigos fallidos (accountLockout en lib/auth.ts).
    if (codigo && /LOCK/i.test(codigo)) return { ok: false, mensaje: "Demasiados códigos incorrectos. La verificación está bloqueada 15 minutos." };
    return { ok: false, mensaje: "Código incorrecto o expirado" };
  }
  redirect(rutaSegura(fd.get("next")?.toString(), "/"));
}

/* -------------------------------- Registro --------------------------------- */
const MSG_REGISTRO =
  "Si los datos son válidos, recibirá un correo con el enlace para activar su cuenta. Revise también la carpeta de spam.";

export async function registrar(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const ctx = await contextoSolicitud();
  const datos = formAObjeto(fd);
  const valores = { nombres: datos.nombres, apellidos: datos.apellidos, email: datos.email, telefono: datos.telefono };
  const r = registroSchema.safeParse(datos);
  if (!r.success) return { ok: false, mensaje: "Revise los campos marcados", errores: z.flattenError(r.error).fieldErrors, valores };
  if (!(await permitirIp("registro", ctx.ip, 5, 3600))) return DEMASIADOS;
  // Límite por correo además de por IP (no depende de que exista un proxy de confianza).
  if (!(await permitir(`registro:cuenta:${hmacIndice(r.data.email)}`, 3, 3600))) return DEMASIADOS;

  const d = r.data;
  const dpiHash = hmacIndice(`dpi:${d.dpi}`);
  const [dup] = await db.select({ id: clientePerfil.userId }).from(clientePerfil).where(eq(clientePerfil.dpiHash, dpiHash)).limit(1);
  if (dup) {
    // Respuesta idéntica al caso exitoso: evita enumeración de DPI / correos (en el legado: clienteAjax.php).
    await auditar({ accion: "auth.registro_duplicado", resultado: "denegado", ...ctx, detalle: { motivo: "dpi" } });
    return { ok: true, mensaje: MSG_REGISTRO };
  }

  let userId: string;
  try {
    const res = await auth.api.signUpEmail({
      body: { name: `${d.nombres} ${d.apellidos}`, email: d.email, password: d.password, callbackURL: "/login?verificado=1" },
      headers: await headers(),
    });
    userId = res.user.id;
  } catch (e) {
    if (codigoError(e) === "PASSWORD_COMPROMISED") {
      return { ok: false, mensaje: "Revise los campos marcados", errores: { password: ["Esta contraseña aparece en filtraciones públicas. Elija otra."] }, valores };
    }
    if (e instanceof APIError && Number(e.statusCode) < 500) {
      await auditar({ accion: "auth.registro_rechazado", resultado: "denegado", actorEmail: d.email, ...ctx, detalle: { codigo: String(e.body?.code ?? e.status) } });
      return { ok: true, mensaje: MSG_REGISTRO };
    }
    logger.error("Error en registro", { error: String(e) });
    return { ok: false, mensaje: "No fue posible completar el registro. Intente más tarde." };
  }

  try {
    await db.insert(clientePerfil).values({
      userId,
      nombres: d.nombres,
      apellidos: d.apellidos,
      telefono: d.telefono,
      dpiCifrado: cifrarCampo(d.dpi),
      dpiHash,
    });
  } catch (e) {
    // Compensación: no dejar usuarios sin perfil.
    await db.delete(user).where(eq(user.id, userId));
    logger.error("Error guardando perfil", { error: String(e) });
    return { ok: false, mensaje: "No fue posible completar el registro. Intente más tarde." };
  }
  return { ok: true, mensaje: MSG_REGISTRO };
}

/* ------------------------------ Cerrar sesión ------------------------------ */
export async function cerrarSesion() {
  const h = await headers();
  const s = await auth.api.getSession({ headers: h });
  await auth.api.signOut({ headers: h });
  if (s) await auditar({ accion: "auth.logout", resultado: "ok", actorId: s.user.id, actorEmail: s.user.email, ...(await contextoSolicitud()) });
  redirect("/");
}

/* --------------------------- Recuperar contraseña -------------------------- */
const MSG_RECUPERA = "Si el correo está registrado, recibirá un enlace para restablecer la contraseña (válido 30 minutos).";

export async function solicitarRecuperacion(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const ctx = await contextoSolicitud();
  const r = z.object({ email: z.email().trim().toLowerCase().max(255) }).safeParse(formAObjeto(fd));
  if (!r.success) return { ok: false, mensaje: "Correo inválido" };
  if (!(await permitirIp("recupera", ctx.ip, 5, 3600))) return DEMASIADOS;
  // Evita usar el formulario para inundar de correos a una víctima (abuso de SMTP).
  if (!(await permitir(`recupera:cuenta:${hmacIndice(r.data.email)}`, 3, 3600))) return DEMASIADOS;
  try {
    await auth.api.requestPasswordReset({ body: { email: r.data.email, redirectTo: "/restablecer" }, headers: await headers() });
  } catch (e) {
    logger.warn("Fallo al solicitar el enlace de recuperación", { error: String(e) });
  }
  await auditar({ accion: "auth.recuperacion_solicitada", resultado: "ok", actorEmail: r.data.email, ...ctx });
  return { ok: true, mensaje: MSG_RECUPERA };
}

export async function restablecerPassword(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const ctx = await contextoSolicitud();
  const r = z
    .object({ token: z.string().min(10).max(255), password: passwordSchema, repassword: z.string() })
    .refine((d) => d.password === d.repassword, { path: ["repassword"], error: "Las contraseñas no coinciden" })
    .safeParse(formAObjeto(fd));
  if (!r.success) return { ok: false, mensaje: "Revise los campos", errores: z.flattenError(r.error).fieldErrors };
  if (!(await permitirIp("restablece", ctx.ip, 10, 3600))) return DEMASIADOS;
  try {
    await auth.api.resetPassword({ body: { token: r.data.token, newPassword: r.data.password }, headers: await headers() });
  } catch (e) {
    if (!clasificarError(e, "restablecer contraseña")) return { ok: false, mensaje: MSG_SERVICIO };
    if (codigoError(e) === "PASSWORD_COMPROMISED") return { ok: false, errores: { password: ["Esta contraseña aparece en filtraciones públicas. Elija otra."] } };
    return { ok: false, mensaje: "El enlace es inválido o expiró. Solicite uno nuevo." };
  }
  redirect("/login?restablecido=1");
}
