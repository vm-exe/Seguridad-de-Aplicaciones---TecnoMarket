/**
 * Conciliación de pagos (control correctivo/detectivo). Ejecutar periódicamente
 * (cron / tarea programada de ECS cada 15 min):  npm run pagos:conciliar
 *
 * Cubre los casos que la confirmación síncrona no resuelve:
 * - PayPal capturó, pero la respuesta se perdió (timeout/caída) y el cliente no volvió:
 *   se finaliza la orden (o se reembolsa si no hay stock / el monto no coincide).
 * - Órdenes abandonadas o rechazadas: se cancelan pasado un tiempo.
 * - Captura PENDING (revisión de PayPal): se deja pendiente y se reintenta en la siguiente corrida.
 */
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { ordenes } from "@/db/schema";
import { auditar } from "@/lib/audit";
import { env } from "@/lib/env";
import { finalizarCaptura } from "@/lib/ordenes";
import { consultarOrdenPaypal } from "@/lib/paypal";

const MIN_ANTIGUEDAD_MS = 15 * 60 * 1000;
const CANCELAR_TRAS_MS = 3 * 60 * 60 * 1000;

async function main() {
  const limite = new Date(Date.now() - MIN_ANTIGUEDAD_MS);
  const candidatas = await db
    .select()
    .from(ordenes)
    .where(and(inArray(ordenes.estado, ["pendiente", "procesando"]), lt(ordenes.createdAt, limite)));
  const resumen: Record<string, number> = {};
  const contar = (k: string) => (resumen[k] = (resumen[k] ?? 0) + 1);

  for (const o of candidatas) {
    const vieja = Date.now() - o.createdAt.getTime() > CANCELAR_TRAS_MS;
    const cancelar = async (motivo: string) => {
      await db.update(ordenes).set({ estado: "cancelada" }).where(and(eq(ordenes.id, o.id), inArray(ordenes.estado, ["pendiente", "procesando"])));
      await auditar({ accion: "pago.conciliado", resultado: "ok", actorEmail: "conciliacion", objetivo: o.id, detalle: { resultado: "cancelada", motivo } });
      contar("canceladas");
    };

    if (o.proveedorPago !== "paypal" || env.PAYMENT_MODE !== "paypal" || !o.referenciaPago) {
      if (vieja) await cancelar("abandonada");
      continue;
    }
    try {
      const pp = await consultarOrdenPaypal(o.referenciaPago);
      if (pp.estado === "COMPLETED" && pp.captura?.estadoCaptura === "COMPLETED") {
        // Reclamo atómico, igual que en la confirmación del cliente.
        const [r] = await db
          .update(ordenes)
          .set({ estado: "procesando" })
          .where(and(eq(ordenes.id, o.id), inArray(ordenes.estado, ["pendiente", "procesando"])));
        if (r.affectedRows !== 1) continue;
        try {
          await finalizarCaptura({ ...o, estado: "procesando" }, pp.captura, null, null);
          contar("finalizadas");
        } catch {
          contar("reembolsadas_o_fallidas"); // finalizarCaptura ya reembolsó y auditó
        }
        await auditar({ accion: "pago.conciliado", resultado: "ok", actorEmail: "conciliacion", objetivo: o.id, detalle: { resultado: "capturada_en_paypal" } });
      } else if (pp.captura?.estadoCaptura === "PENDING") {
        contar("captura_pendiente_en_paypal");
      } else if (vieja) {
        await cancelar(`estado_paypal_${pp.estado}`);
      } else {
        contar("en_espera");
      }
    } catch (e) {
      contar("errores");
      console.error(`Orden ${o.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`Conciliación: ${candidatas.length} órdenes revisadas`, resumen);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
