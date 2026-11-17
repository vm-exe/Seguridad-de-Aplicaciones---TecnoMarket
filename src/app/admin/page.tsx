import type { Metadata } from "next";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ordenes, productos, user } from "@/db/schema";
import { contarAuditoria } from "@/lib/audit";
import { leerConfig } from "@/lib/config-tienda";
import { aCentavos, formatoMoneda } from "@/lib/precios";

export const metadata: Metadata = { title: "Administración" };

export default async function AdminInicio() {
  const [[prod], [ord], [usr], eventos, cfg] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(productos).where(eq(productos.activo, true)),
    db
      .select({ n: sql<number>`count(*)`, total: sql<string>`coalesce(sum(${ordenes.total}),0)` })
      .from(ordenes)
      .where(eq(ordenes.estado, "pagada")),
    db.select({ n: sql<number>`count(*)` }).from(user),
    contarAuditoria(),
    leerConfig(),
  ]);
  const tarjetas = [
    ["Productos activos", String(prod.n)],
    ["Órdenes pagadas", String(ord.n)],
    ["Ventas", formatoMoneda(aCentavos(ord.total), cfg.moneda_simbolo)],
    ["Usuarios", String(usr.n)],
    ["Eventos de auditoría", String(eventos)],
  ];
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">Resumen</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tarjetas.map(([t, v]) => (
          <div key={t} className="tarjeta">
            <p className="text-sm text-gray-500">{t}</p>
            <p className="mt-1 text-2xl font-bold">{v}</p>
          </div>
        ))}
      </div>
    </>
  );
}
