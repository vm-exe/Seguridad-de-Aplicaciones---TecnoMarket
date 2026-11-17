import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { urlImagen } from "@/components/tarjeta-producto";
import { obtenerProducto } from "@/lib/catalogo";
import { leerConfig } from "@/lib/config-tienda";
import { aCentavos, formatoMoneda, precioConDescuento } from "@/lib/precios";
import { idProductoSchema } from "@/lib/validation";
import { agregarAlCarrito } from "../../acciones-carrito";

type Params = { params: Promise<{ id: string }> };

/**
 * El legado exigía ?token=HMAC-SHA1(id, "Tr1f0rc3&") para ver un producto (seguridad por oscuridad).
 * Aquí el id se valida como entero y la consulta es parametrizada; no hace falta "token".
 */
async function cargar(id: string) {
  const r = idProductoSchema.safeParse(id);
  if (!r.success) return null;
  return obtenerProducto(r.data);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const p = await cargar((await params).id);
  return { title: p?.nombre ?? "Producto" };
}

export default async function ProductoPage({ params }: Params) {
  const p = await cargar((await params).id);
  if (!p) notFound();
  const cfg = await leerConfig();
  const final = precioConDescuento(p.precio, p.descuento);
  const imagenes = p.imagenes.length ? p.imagenes : [null];

  return (
    <div className="contenedor grid gap-10 py-10 md:grid-cols-2">
      <div className="space-y-3">
        {imagenes.map((img, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={img?.id ?? i} src={urlImagen(img?.archivo)} alt={`${p.nombre} — imagen ${i + 1}`} className="w-full rounded-2xl bg-crema object-contain" />
        ))}
      </div>
      <div>
        <p className="text-sm uppercase tracking-wide text-gray-500">{p.categoria?.nombre}</p>
        <h1 className="mt-1 text-3xl font-bold">{p.nombre}</h1>
        <div className="mt-4 flex items-baseline gap-3">
          <span className="text-3xl font-bold">{formatoMoneda(final, cfg.moneda_simbolo)}</span>
          {p.descuento > 0 && (
            <>
              <del className="text-gray-400">{formatoMoneda(aCentavos(p.precio), cfg.moneda_simbolo)}</del>
              <span className="text-sm font-semibold text-green-700">{p.descuento}% descuento</span>
            </>
          )}
        </div>
        {/* Texto renderizado como texto (whitespace-pre-line), nunca como HTML. */}
        <p className="mt-6 whitespace-pre-line text-gray-700">{p.descripcion}</p>
        <p className="mt-4 whitespace-pre-line text-sm text-gray-600">{p.detalles}</p>
        <p className="mt-4 text-sm">
          Disponibles: <b>{p.stock}</b>
        </p>

        {p.stock > 0 ? (
          <form action={agregarAlCarrito} className="mt-6 flex items-end gap-3">
            <input type="hidden" name="id" value={p.id} />
            <div>
              <label htmlFor="cantidad" className="etiqueta">Cantidad</label>
              <input id="cantidad" name="cantidad" type="number" min={1} max={Math.min(10, p.stock)} defaultValue={1} className="campo w-24" />
            </div>
            <button className="btn-marca">Agregar al carrito</button>
          </form>
        ) : (
          <p className="mt-6 font-semibold text-red-700">Producto agotado</p>
        )}
      </div>
    </div>
  );
}
