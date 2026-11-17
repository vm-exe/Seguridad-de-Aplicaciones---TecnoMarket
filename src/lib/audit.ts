import "server-only";
import { asc, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditoria } from "@/db/schema";
import { hmac } from "./crypto";
import { logger } from "./logger";

const GENESIS = "0".repeat(64);

export type EventoAuditoria = {
  accion: string;
  resultado: "ok" | "denegado" | "error";
  actorId?: string | null;
  actorEmail?: string | null;
  objetivo?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  detalle?: Record<string, unknown>;
};

/** JSON canónico (claves ordenadas): MySQL reordena las claves de columnas JSON. */
function canonico(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(canonico);
  return Object.fromEntries(
    Object.keys(v as object)
      .sort()
      .map((k) => [k, canonico((v as Record<string, unknown>)[k])]),
  );
}

function contenido(ts: Date, e: EventoAuditoria) {
  return JSON.stringify([
    ts.toISOString(),
    e.actorId ?? null,
    e.actorEmail ?? null,
    e.accion,
    e.objetivo ?? null,
    e.resultado,
    e.ip ?? null,
    e.userAgent ?? null,
    canonico(e.detalle ?? null),
  ]);
}

/**
 * Nombre normalizado del evento para el SIEM (coincide con los metric filters de
 * infra/terraform/aws/cloudwatch.tf y las consultas de docs/DEVSECOPS.md §4).
 */
const EVENTO_SIEM: Record<string, string> = {
  "auth.login": "auth.login.success",
  "auth.login_fallido": "auth.login.failed",
  "auth.login_bloqueado": "auth.login.failed",
  "auth.logout": "auth.logout",
  "auth.2fa_fallido": "auth.2fa.failed",
  "auth.2fa_activado": "auth.2fa.enabled",
  "auth.2fa_desactivado": "auth.2fa.disabled",
  "auth.registro": "auth.register",
  "auth.registro_duplicado": "auth.register.rejected",
  "auth.registro_rechazado": "auth.register.rejected",
  "auth.recuperacion_solicitada": "auth.password.reset_requested",
  "auth.password_reset": "auth.password.reset",
  "auth.password_cambiado": "auth.password.changed",
  "acceso.pedido_ajeno": "authz.denied",
  "acceso.admin_denegado": "authz.denied",
  "pago.confirmacion_denegada": "authz.denied",
  "pago.iniciado": "order.created",
  "pago.completado": "payment.captured",
  "pago.manipulacion_detectada": "payment.amount_mismatch",
  "pago.requiere_reembolso": "payment.refund_required",
  "pago.reembolsado": "payment.refunded",
  "pago.conciliado": "payment.reconciled",
  "admin.reautenticacion_requerida": "authz.denied",
  "admin.producto.crear": "admin.product.create",
  "admin.producto.actualizar": "admin.product.update",
  "admin.producto.desactivar": "admin.product.delete",
  "admin.producto.imagen": "admin.product.update",
  "admin.categoria.crear": "admin.category.create",
  "admin.categoria.actualizar": "admin.category.update",
  "admin.config.actualizar": "admin.config.update",
  "admin.usuario.rol": "admin.user.role_change",
  "admin.imagen_rechazada": "upload.rejected",
};

// Serializa escrituras dentro del proceso; FOR UPDATE protege entre instancias.
let cola: Promise<unknown> = Promise.resolve();

/**
 * Registra un evento en la bitácora encadenada y lo emite al log (SIEM).
 * Nunca lanza: una falla de auditoría no debe tumbar la operación, pero sí se reporta.
 */
export function auditar(e: EventoAuditoria): Promise<void> {
  const ts = new Date();
  logger.info("audit", {
    type: "audit",
    event: EVENTO_SIEM[e.accion] ?? e.accion,
    time: ts.toISOString(),
    accion: e.accion,
    outcome: e.resultado,
    actor: e.actorId ?? null,
    // Se registra un hash del correo (no el correo) para correlacionar sin exponer PII en el SIEM.
    email_hash: e.actorEmail ? hmac(e.actorEmail.toLowerCase()).slice(0, 16) : null,
    resource: e.objetivo ?? null,
    ip: e.ip ?? null,
    ua: e.userAgent ?? null,
    ...(e.detalle ?? {}),
  });
  const tarea = cola.then(() =>
    db.transaction(async (tx) => {
      const [ultimo] = await tx
        .select({ hash: auditoria.hash })
        .from(auditoria)
        .orderBy(desc(auditoria.id))
        .limit(1)
        .for("update");
      const prevHash = ultimo?.hash ?? GENESIS;
      const hash = hmac(prevHash + contenido(ts, e));
      await tx.insert(auditoria).values({
        ts,
        actorId: e.actorId ?? null,
        actorEmail: e.actorEmail ?? null,
        accion: e.accion,
        objetivo: e.objetivo ?? null,
        resultado: e.resultado,
        ip: e.ip ?? null,
        userAgent: e.userAgent ?? null,
        detalle: e.detalle ?? null,
        prevHash,
        hash,
      });
    }),
  );
  cola = tarea.catch(() => undefined);
  return tarea.catch((err) => {
    logger.error("No se pudo escribir la auditoría", { accion: e.accion, error: String(err) });
  });
}

/** Recorre la cadena y devuelve el primer registro alterado (o null si está íntegra). */
export async function verificarCadena(): Promise<{ ok: boolean; total: number; rotoEn?: number }> {
  const filas = await db.select().from(auditoria).orderBy(asc(auditoria.id));
  let prev = GENESIS;
  for (const f of filas) {
    const esperado = hmac(
      prev +
        contenido(f.ts, {
          accion: f.accion,
          resultado: f.resultado,
          actorId: f.actorId,
          actorEmail: f.actorEmail,
          objetivo: f.objetivo,
          ip: f.ip,
          userAgent: f.userAgent,
          // MariaDB guarda JSON como LONGTEXT: el driver puede devolver un string.
          detalle: (typeof f.detalle === "string" ? JSON.parse(f.detalle) : (f.detalle as Record<string, unknown> | null)) ?? undefined,
        }),
    );
    if (f.prevHash !== prev || f.hash !== esperado) return { ok: false, total: filas.length, rotoEn: f.id };
    prev = f.hash;
  }
  return { ok: true, total: filas.length };
}

export async function contarAuditoria() {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(auditoria);
  return Number(r?.n ?? 0);
}
