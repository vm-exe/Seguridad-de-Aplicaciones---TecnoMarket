import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { ordenes, ordenItems } from "@/db/schema";
import { auditar } from "@/lib/audit";
import { leerConfig } from "@/lib/config-tienda";
import { aCentavos, formatoMoneda } from "@/lib/precios";
import { contextoSolicitud } from "@/lib/request-context";
import { requerirUsuario } from "@/lib/session";
import { uuidSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Detalle del pedido" };

const ESTADOS: Record<string, string> = { pendiente: "Pendiente", pagada: "Pagada", cancelada: "Cancelada", fallida: "Fallida" };

/**
 * Corrige el IDOR del legado (compra_detalle.php buscaba por id_transaccion sin filtrar por cliente):
 * la consulta exige que la orden pertenezca al usuario de la sesión. Los admins usan /admin/ordenes.
 */
export default async function PedidoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string }> }) {
  const { id } = await params;
  const s = await requerirUsuario(`/pedido/${id}`);
  const r = uuidSchema.safeParse(id);
  if (!r.success) notFound();

  const [orden] = await db
    .select()
    .from(ordenes)
    .where(and(eq(ordenes.id, r.data), eq(ordenes.userId, s.user.id)))
    .limit(1);
  if (!orden) {
    await auditar({ accion: "acceso.pedido_ajeno", resultado: "denegado", actorId: s.user.id, objetivo: r.data, ...(await contextoSolicitud()) });
    notFound(); // 404 y no 403: no confirmar la existencia del recurso
  }
  const [items, cfg] = await Promise.all([db.select().from(ordenItems).where(eq(ordenItems.ordenId, orden.id)), leerConfig()]);
  const m = (c: number) => formatoMoneda(c, cfg.moneda_simbolo);
  const ok = (await searchParams).ok;

  return (
    <div className="contenedor max-w-3xl py-10">
      {ok && orden.estado === "pagada" && (
        <p role="status" className="mb-6 rounded-lg bg-green-50 px-4 py-3 text-green-800">¡Gracias por su compra! Le enviamos el detalle por correo.</p>
      )}
      <h1 className="text-2xl font-bold">Pedido</h1>
      <p className="mt-1 break-all font-mono text-sm text-gray-500">{orden.id}</p>
      <div className="tarjeta mt-6">
        <dl className="mb-4 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-gray-500">Fecha</dt>
          <dd>{orden.createdAt.toLocaleString("es-GT", { timeZone: "America/Guatemala" })}</dd>
          <dt className="text-gray-500">Estado</dt>
          <dd className="font-semibold">{ESTADOS[orden.estado]}</dd>
          {orden.capturaId && (
            <>
              <dt className="text-gray-500">Transacción</dt>
              <dd className="font-mono">{orden.capturaId}</dd>
            </>
          )}
        </dl>
        <table className="tabla">
          <thead>
            <tr><th>Producto</th><th>Precio</th><th>Cant.</th><th className="text-right">Subtotal</th></tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>{i.nombre}</td>
                <td>{m(aCentavos(i.precioUnitario))}</td>
                <td>{i.cantidad}</td>
                <td className="text-right">{m(aCentavos(i.precioUnitario) * i.cantidad)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} className="font-bold">Total</td>
              <td className="text-right font-bold">{m(aCentavos(orden.total))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Link href="/cuenta" className="btn-borde mt-6">Volver a mis compras</Link>
    </div>
  );
}
