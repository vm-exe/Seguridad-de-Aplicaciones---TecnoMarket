import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { env } from "./env";
import { logger } from "./logger";

/**
 * Envío de correo. Las credenciales SMTP vienen del entorno (Secrets Manager),
 * ya no de la tabla `configuracion` como en el legado.
 * Sin SMTP configurado (solo desarrollo), el enlace se imprime en la consola del servidor.
 */
const transporter =
  env.SMTP_HOST && env.SMTP_USER
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        requireTLS: env.SMTP_PORT !== 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
        tls: { minVersion: "TLSv1.2" },
      })
    : null;

/** Escapa texto para insertarlo en el HTML del correo. */
export function escaparHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Buzón de archivos para pruebas E2E (ver MAIL_CAPTURE_DIR en env.ts). */
async function capturarCorreo(para: string, asunto: string, html: string, texto?: string) {
  const dir = env.MAIL_CAPTURE_DIR!;
  await mkdir(dir, { recursive: true });
  const enlaces = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  const nombre = `${Date.now()}-${randomBytes(4).toString("hex")}.json`;
  await writeFile(path.join(dir, nombre), JSON.stringify({ para, asunto, enlaces, texto, ts: new Date().toISOString() }));
}

export async function enviarCorreo(para: string, asunto: string, html: string, textoDev?: string) {
  if (env.MAIL_CAPTURE_DIR) {
    await capturarCorreo(para, asunto, html, textoDev);
    return;
  }
  if (!transporter) {
    if (env.NODE_ENV === "production") {
      logger.error("SMTP no configurado en producción");
      return;
    }
    // Solo en desarrollo: mostrar en consola para poder probar los flujos.
    console.log(`\n[CORREO DEV] Para: ${para}\nAsunto: ${asunto}\n${textoDev ?? html}\n`);
    return;
  }
  try {
    await transporter.sendMail({ from: env.SMTP_FROM, to: para, subject: asunto, html });
  } catch (err) {
    logger.error("Fallo al enviar correo", { asunto, error: String(err) });
  }
}

export function plantillaEnlace(titulo: string, texto: string, url: string, accion: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:520px">
  <h2>${escaparHtml(titulo)}</h2>
  <p>${escaparHtml(texto)}</p>
  <p><a href="${escaparHtml(url)}" style="background:#3b5d50;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${escaparHtml(accion)}</a></p>
  <p style="color:#666;font-size:12px">Si usted no solicitó esta acción, ignore este mensaje. El enlace expira automáticamente.</p>
</div>`;
}
