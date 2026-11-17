import Link from "next/link";
import { formatoMoneda, precioConDescuento, aCentavos } from "@/lib/precios";

export function urlImagen(archivo: string | null | undefined) {
  return archivo ? `/api/imagenes/${archivo}` : "/img/no-photo.jpg";
}

type Props = {
  p: { id: number; nombre: string; precio: string; descuento: number; stock: number; imagen: string | null };
  simbolo: string;
};

/** React escapa automáticamente el texto: los nombres de producto no pueden inyectar HTML (XSS almacenado en el legado). */
export function TarjetaProducto({ p, simbolo }: Props) {
  const final = precioConDescuento(p.precio, p.descuento);
  return (
    <Link href={`/producto/${p.id}`} className="group flex flex-col rounded-2xl p-4 transition hover:bg-crema">
      <div className="aspect-square overflow-hidden rounded-xl bg-crema">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={urlImagen(p.imagen)} alt={p.nombre} className="h-full w-full object-contain transition group-hover:scale-105" loading="lazy" />
      </div>
      <h3 className="mt-3 line-clamp-2 font-semibold">{p.nombre}</h3>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-lg font-bold">{formatoMoneda(final, simbolo)}</span>
        {p.descuento > 0 && (
          <>
            <del className="text-sm text-gray-400">{formatoMoneda(aCentavos(p.precio), simbolo)}</del>
            <span className="text-xs font-semibold text-green-700">-{p.descuento}%</span>
          </>
        )}
      </div>
      {p.stock < 1 && <span className="mt-1 text-xs font-semibold text-red-700">Agotado</span>}
    </Link>
  );
}
