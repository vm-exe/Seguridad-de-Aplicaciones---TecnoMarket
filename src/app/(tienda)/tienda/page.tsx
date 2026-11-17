import type { Metadata } from "next";
import Link from "next/link";
import { TarjetaProducto } from "@/components/tarjeta-producto";
import { listarCategorias, listarProductos } from "@/lib/catalogo";
import { leerConfig } from "@/lib/config-tienda";
import { busquedaSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Tienda" };

export default async function TiendaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = busquedaSchema.parse(await searchParams);
  const [res, cats, cfg] = await Promise.all([listarProductos(f), listarCategorias(), leerConfig()]);

  const enlace = (pagina: number) => {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.categoria) p.set("categoria", String(f.categoria));
    p.set("pagina", String(pagina));
    return `/tienda?${p}`;
  };

  return (
    <div className="contenedor py-10">
      <h1 className="mb-6 text-3xl font-bold">Tienda</h1>
      <form className="mb-8 flex flex-wrap gap-3" role="search">
        <input name="q" defaultValue={f.q} placeholder="Buscar productos…" className="campo max-w-xs" maxLength={100} aria-label="Buscar" />
        <select name="categoria" defaultValue={f.categoria ?? ""} className="campo max-w-xs" aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
        <button className="btn-primario">Filtrar</button>
      </form>

      {res.productos.length === 0 ? (
        <p className="text-gray-600">No se encontraron productos{f.q ? <> para «{f.q}»</> : null}.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {res.productos.map((p) => (
            <TarjetaProducto key={p.id} p={p} simbolo={cfg.moneda_simbolo} />
          ))}
        </div>
      )}

      {res.paginas > 1 && (
        <nav className="mt-8 flex justify-center gap-2" aria-label="Paginación">
          {Array.from({ length: res.paginas }, (_, i) => i + 1).map((n) => (
            <Link
              key={n}
              href={enlace(n)}
              aria-current={n === (f.pagina ?? 1) ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-sm ${n === (f.pagina ?? 1) ? "bg-tinta text-white" : "bg-crema"}`}
            >
              {n}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
