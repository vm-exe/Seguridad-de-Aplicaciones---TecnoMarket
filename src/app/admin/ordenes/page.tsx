import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ordenes, user } from "@/db/schema";
import { leerConfig } from "@/lib/config-tienda";
import { aCentavos, formatoMoneda } from "@/lib/precios";

export const metadata: Metadata = { title: "Órdenes" };

export default async function AdminOrdenes() {
  const [lista, cfg] = await Promise.all([
    db
      .select({
        id: ordenes.id,
        estado: ordenes.estado,
        total: ordenes.total,
        proveedor: ordenes.proveedorPago,
        captura: ordenes.capturaId,
        createdAt: ordenes.createdAt,
        email: user.email,
      })
      .from(ordenes)
      .leftJoin(user, eq(ordenes.userId, user.id))
      .orderBy(desc(ordenes.createdAt))
      .limit(200),
    leerConfig(),
  ]);
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">Órdenes (últimas 200)</h1>
      <div className="overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr><th>Fecha</th><th>Orden</th><th>Cliente</th><th>Proveedor</th><th>Transacción</th><th>Estado</th><th className="text-right">Total</th></tr>
          </thead>
          <tbody>
            {lista.map((o) => (
              <tr key={o.id}>
                <td>{o.createdAt.toLocaleString("es-GT", { timeZone: "America/Guatemala" })}</td>
                <td className="font-mono">{o.id.slice(0, 8)}</td>
                <td>{o.email}</td>
                <td>{o.proveedor}</td>
                <td className="font-mono text-xs">{o.captura ?? "—"}</td>
                <td className="capitalize">{o.estado}</td>
                <td className="text-right">{formatoMoneda(aCentavos(o.total), cfg.moneda_simbolo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
