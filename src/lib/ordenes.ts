import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { ordenes, ordenItems, productos, user } from "@/db/schema";
import { auditar } from "./audit";
import { guardarCarrito, leerCarrito, resolverCarrito } from "./carrito";
import { leerConfig } from "./config-tienda";
import { env } from "./env";
import { escaparHtml, enviarCorreo } from "./mail";
import { capturarOrdenPaypal, crearOrdenPaypal, reembolsarCaptura } from "./paypal";
import { aCentavos, centavosADecimal, formatoMoneda } from "./precios";

export class ErrorNegocio extends Error {}

/**
 * Paso 1: crea la orden en estado "pendiente" con precios congelados desde la BD.
 * Devuelve la URL a la que se debe redirigir al cliente (PayPal o pago simulado).
 */
export async function iniciarPago(usuario: { id: string; email: string }, ctx: { ip: string; userAgent: string }) {
  const { lineas, total } = await resolverCarrito(await leerCarrito());
  if (lineas.length === 0 || total <= 0) throw new ErrorNegocio("El carrito está vacío o los productos no tienen stock");
  const cfg = await leerConfig();
  const ordenId = randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(ordenes).values({
      id: ordenId,
      userId: usuario.id,
      estado: "pendiente",
      total: centavosADecimal(total),
      moneda: cfg.moneda_codigo,
      proveedorPago: env.PAYMENT_MODE,
    });
    await tx.insert(ordenItems).values(
      lineas.map((l) => ({
        ordenId,
        productoId: l.id,
        nombre: l.nombre,
        precioUnitario: centavosADecimal(l.precioUnitario),
        cantidad: l.cantidad,
      })),
    );
  });

  await auditar({
    accion: "pago.iniciado",
    resultado: "ok",
    actorId: usuario.id,
    actorEmail: usuario.email,
    objetivo: ordenId,
    ...ctx,
    detalle: { total: centavosADecimal(total), moneda: cfg.moneda_codigo, items: lineas.length },
  });

  if (env.PAYMENT_MODE === "simulado") return `/checkout/simulado?orden=${ordenId}`;

  const pp = await crearOrdenPaypal({
    ordenId,
    total: centavosADecimal(total),
    moneda: cfg.moneda_codigo,
    returnUrl: `${env.APP_URL}/checkout/retorno`,
    cancelUrl: `${env.APP_URL}/checkout/cancelado`,
  });
  await db.update(ordenes).set({ referenciaPago: pp.id }).where(eq(ordenes.id, ordenId));
  return pp.aprobarUrl;
}

type Orden = typeof ordenes.$inferSelect;
type Ctx = { ip: string; userAgent: string };
type Actor = { id: string; email: string } | null;

/**
 * Paso 2: confirma el pago. Verifica dueño de la orden, monto, moneda y custom_id
 * contra lo almacenado; descuenta stock de forma atómica.
 *
 * Concurrencia: la orden se "reclama" con un UPDATE condicional
 * (pendiente -> procesando) y solo la petición que logra affectedRows = 1 continúa.
 * Así dos confirmaciones simultáneas (doble clic, recarga del retorno de PayPal)
 * no pueden descontar stock dos veces ni marcar como fallida una orden ya pagada.
 */
export async function confirmarPago(p: { ordenId?: string; paypalId?: string }, usuario: { id: string; email: string }, ctx: Ctx) {
  const filtro = p.paypalId ? eq(ordenes.referenciaPago, p.paypalId) : eq(ordenes.id, p.ordenId ?? "");
  // Control de acceso a nivel de objeto: la orden debe pertenecer al usuario de la sesión.
  const [orden] = await db
    .select()
    .from(ordenes)
    .where(and(filtro, eq(ordenes.userId, usuario.id)))
    .limit(1);
  if (!orden) {
    await auditar({ accion: "pago.confirmacion_denegada", resultado: "denegado", actorId: usuario.id, objetivo: p.paypalId ?? p.ordenId, ...ctx });
    throw new ErrorNegocio("Orden no encontrada");
  }
  if (orden.estado === "pagada") return orden.id;

  const [reclamo] = await db
    .update(ordenes)
    .set({ estado: "procesando" })
    .where(and(eq(ordenes.id, orden.id), eq(ordenes.estado, "pendiente")));
  if (reclamo.affectedRows !== 1) {
    // Otra petición la está procesando o ya terminó: no se repite el trabajo.
    const [actual] = await db.select({ estado: ordenes.estado }).from(ordenes).where(eq(ordenes.id, orden.id)).limit(1);
    if (actual?.estado === "pagada" || actual?.estado === "procesando") return orden.id;
    throw new ErrorNegocio("La orden no está pendiente");
  }

  let captura: { capturaId: string; valor: string; moneda: string; customId: string };
  if (orden.proveedorPago === "paypal") {
    try {
      captura = await capturarOrdenPaypal(orden.referenciaPago ?? "", orden.id);
    } catch (e) {
      // Captura no completada (o resultado incierto): se devuelve a pendiente y la conciliación decidirá.
      await db.update(ordenes).set({ estado: "pendiente" }).where(and(eq(ordenes.id, orden.id), eq(ordenes.estado, "procesando")));
      throw e;
    }
  } else {
    captura = { capturaId: `SIM-${randomUUID().slice(0, 8).toUpperCase()}`, valor: orden.total, moneda: orden.moneda, customId: orden.id };
  }

  const items = await finalizarCaptura({ ...orden, estado: "procesando" }, captura, usuario, ctx);
  await guardarCarrito({});
  await enviarConfirmacion(usuario.email, orden, items);
  return orden.id;
}

/**
 * Verifica la captura contra la orden y la marca como pagada descontando stock.
 * Si el monto no coincide o no hay stock, REEMBOLSA automáticamente (control correctivo).
 * Compartida por la confirmación del cliente y por la conciliación (scripts/conciliar-pagos.ts).
 */
export async function finalizarCaptura(
  orden: Orden,
  cap: { capturaId: string; valor: string; moneda: string; customId: string },
  usuario: Actor,
  ctx: Ctx | null,
) {
  const base = { actorId: usuario?.id ?? null, actorEmail: usuario?.email ?? null, objetivo: orden.id, ...(ctx ?? {}) };
  const montoOk = aCentavos(cap.valor) === aCentavos(orden.total) && cap.moneda === orden.moneda && cap.customId === orden.id;
  if (!montoOk) {
    await auditar({ accion: "pago.manipulacion_detectada", resultado: "denegado", ...base, detalle: { esperado: orden.total, recibido: cap.valor, moneda: cap.moneda } });
    await reembolsar(orden, cap.capturaId, "monto_no_coincide", base);
    throw new ErrorNegocio("El monto del pago no coincide con la orden. Se emitió el reembolso.");
  }

  const items = await db.select().from(ordenItems).where(eq(ordenItems.ordenId, orden.id));
  try {
    await db.transaction(async (tx) => {
      for (const it of items) {
        // UPDATE condicional: evita stock negativo ante compras concurrentes.
        const [res] = await tx
          .update(productos)
          .set({ stock: sql`${productos.stock} - ${it.cantidad}` })
          .where(and(eq(productos.id, it.productoId), gte(productos.stock, it.cantidad)));
        if (res.affectedRows !== 1) throw new ErrorNegocio(`Stock insuficiente para ${it.nombre}`);
      }
      const [res] = await tx
        .update(ordenes)
        .set({ estado: "pagada", capturaId: cap.capturaId, pagadaAt: new Date() })
        .where(and(eq(ordenes.id, orden.id), eq(ordenes.estado, "procesando")));
      if (res.affectedRows !== 1) throw new Error("La orden cambió de estado durante el pago");
    });
  } catch (e) {
    await reembolsar(orden, cap.capturaId, String(e instanceof Error ? e.message : e), base);
    throw new ErrorNegocio("No hay stock suficiente. Su pago fue reembolsado.");
  }

  await auditar({ accion: "pago.completado", resultado: "ok", ...base, detalle: { total: orden.total, capturaId: cap.capturaId } });
  return items;
}

async function reembolsar(orden: Orden, capturaId: string, motivo: string, base: Record<string, unknown>) {
  const soloProcesando = and(eq(ordenes.id, orden.id), eq(ordenes.estado, "procesando"));
  if (orden.proveedorPago !== "paypal") {
    await db.update(ordenes).set({ estado: "reembolsada", capturaId }).where(soloProcesando);
    await auditar({ accion: "pago.reembolsado", resultado: "ok", ...base, detalle: { capturaId, motivo, simulado: true } });
    return;
  }
  try {
    const r = await reembolsarCaptura(capturaId, orden.id);
    await db.update(ordenes).set({ estado: "reembolsada", capturaId }).where(soloProcesando);
    await auditar({ accion: "pago.reembolsado", resultado: "ok", ...base, detalle: { capturaId, reembolsoId: r.id, estado: r.estado, motivo } });
  } catch (e) {
    // El reembolso falló: queda registrado para atención manual (alerta en el SIEM).
    await db.update(ordenes).set({ estado: "fallida", capturaId }).where(soloProcesando);
    await auditar({ accion: "pago.requiere_reembolso", resultado: "error", ...base, detalle: { capturaId, motivo, error: String(e) } });
  }
}

async function enviarConfirmacion(email: string, orden: Orden, items: (typeof ordenItems.$inferSelect)[]) {
  const cfg = await leerConfig();
  const filas = items
    .map((i) => `<li>${escaparHtml(i.nombre)} × ${i.cantidad} — ${formatoMoneda(aCentavos(i.precioUnitario) * i.cantidad, cfg.moneda_simbolo)}</li>`)
    .join("");
  await enviarCorreo(
    email,
    "Detalle de su pedido",
    `<h3>Gracias por su compra</h3><p>Pedido <b>${escaparHtml(orden.id)}</b></p><ul>${filas}</ul><p>Total: <b>${formatoMoneda(aCentavos(orden.total), cfg.moneda_simbolo)}</b></p>`,
    `Pedido ${orden.id} confirmado. Total ${orden.total}`,
  );
}

export async function cancelarOrdenPendiente(paypalId: string, userId: string) {
  await db
    .update(ordenes)
    .set({ estado: "cancelada" })
    .where(and(eq(ordenes.referenciaPago, paypalId), eq(ordenes.userId, userId), eq(ordenes.estado, "pendiente")));
}

/** Correo del usuario (para vistas de admin). */
export async function emailDeUsuario(id: string) {
  const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, id)).limit(1);
  return u?.email ?? "";
}
