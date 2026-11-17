import type { Metadata } from "next";
import Link from "next/link";
import { leerCarrito, resolverCarrito } from "@/lib/carrito";
import { leerConfig } from "@/lib/config-tienda";
import { formatoMoneda } from "@/lib/precios";
import { obtenerSesion } from "@/lib/session";
import { actualizarCantidad, quitarDelCarrito } from "../acciones-carrito";

export const metadata: Metadata = { title: "Carrito" };

export default async function CarritoPage() {
  const [{ lineas, total }, cfg, sesion] = await Promise.all([resolverCarrito(await leerCarrito()), leerConfig(), obtenerSesion()]);
  const m = (c: number) => formatoMoneda(c, cfg.moneda_simbolo);

  return (
    <div className="contenedor py-10">
      <h1 className="mb-6 text-3xl font-bold">Carrito</h1>
      {lineas.length === 0 ? (
        <p>
          Su carrito está vacío. <Link href="/tienda" className="text-marca underline">Ir a la tienda</Link>
        </p>
      ) : (
        <div className="grid gap-8 md:grid-cols-3">
          <div className="overflow-x-auto md:col-span-2">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Precio</th>
                  <th>Cantidad</th>
                  <th>Subtotal</th>
                  <th><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => (
                  <tr key={l.id}>
                    <td><Link href={`/producto/${l.id}`} className="hover:underline">{l.nombre}</Link></td>
                    <td>{m(l.precioUnitario)}</td>
                    <td>
                      <form action={actualizarCantidad} className="flex gap-2">
                        <input type="hidden" name="id" value={l.id} />
                        <input name="cantidad" type="number" min={1} max={Math.min(10, l.stock)} defaultValue={l.cantidad} className="campo w-20" aria-label={`Cantidad de ${l.nombre}`} />
                        <button className="text-xs text-marca underline">Actualizar</button>
                      </form>
                    </td>
                    <td className="font-semibold">{m(l.subtotal)}</td>
                    <td>
                      <form action={quitarDelCarrito}>
                        <input type="hidden" name="id" value={l.id} />
                        <button className="text-xs text-red-700 underline">Quitar</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <aside className="tarjeta h-fit">
            <h2 className="mb-4 text-lg font-bold">Resumen</h2>
            <div className="flex justify-between text-lg">
              <span>Total</span>
              <b>{m(total)}</b>
            </div>
            <p className="mt-2 text-xs text-gray-500">Los precios se recalculan en el servidor al pagar.</p>
            <Link href={sesion ? "/checkout" : "/login?next=/checkout"} className="btn-primario mt-6 w-full">
              Proceder al pago
            </Link>
            <Link href="/tienda" className="btn-borde mt-3 w-full">Seguir comprando</Link>
          </aside>
        </div>
      )}
    </div>
  );
}
