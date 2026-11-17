import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ordenes } from "@/db/schema";
import { leerConfig } from "@/lib/config-tienda";
import { aCentavos, formatoMoneda } from "@/lib/precios";
import { requerirUsuario } from "@/lib/session";

export const metadata: Metadata = { title: "Mis compras" };

export default async function CuentaPage() {
  const s = await requerirUsuario("/cuenta");
  const [lista, cfg] = await Promise.all([
    db
      .select({ id: ordenes.id, estado: ordenes.estado, total: ordenes.total, createdAt: ordenes.createdAt })
      .from(ordenes)
      .where(eq(ordenes.userId, s.user.id))
      .orderBy(desc(ordenes.createdAt))
      .limit(100),
    leerConfig(),
  ]);

  return (
    <div className="contenedor py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-bold">Mis compras</h1>
        <Link href="/cuenta/seguridad" className="btn-borde">Seguridad de la cuenta</Link>
      </div>
      {lista.length === 0 ? (
        <p>Aún no tiene compras.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr><th>Fecha</th><th>Pedido</th><th>Estado</th><th className="text-right">Total</th></tr>
            </thead>
            <tbody>
              {lista.map((o) => (
                <tr key={o.id}>
                  <td>{o.createdAt.toLocaleDateString("es-GT", { timeZone: "America/Guatemala" })}</td>
                  <td><Link className="font-mono text-marca underline" href={`/pedido/${o.id}`}>{o.id.slice(0, 8)}</Link></td>
                  <td className="capitalize">{o.estado}</td>
                  <td className="text-right">{formatoMoneda(aCentavos(o.total), cfg.moneda_simbolo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
