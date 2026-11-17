import Link from "next/link";
import { TarjetaProducto } from "@/components/tarjeta-producto";
import { listarProductos } from "@/lib/catalogo";
import { leerConfig } from "@/lib/config-tienda";

export default async function Inicio() {
  const [{ productos }, cfg] = await Promise.all([listarProductos({ pagina: 1 }), leerConfig()]);
  return (
    <>
      <section className="bg-marca text-white">
        <div className="contenedor grid items-center gap-8 py-14 md:grid-cols-2">
          <div>
            <h1 className="text-4xl font-bold leading-tight md:text-5xl">Muebles modernos para su hogar</h1>
            <p className="mt-4 text-white/75">
              {cfg.tienda_nombre}: diseño, calidad y compras seguras en línea.
            </p>
            <div className="mt-8 flex gap-3">
              <Link href="/tienda" className="btn-acento">Comprar ahora</Link>
              <Link href="/registro" className="btn border border-white/60 text-white hover:bg-white/10">Crear cuenta</Link>
            </div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/couch.png" alt="Sofá moderno" className="mx-auto w-full max-w-md" />
        </div>
      </section>
      <section className="contenedor py-14">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="text-2xl font-bold">Productos destacados</h2>
          <Link href="/tienda" className="text-sm text-marca underline">Ver todo</Link>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {productos.slice(0, 8).map((p) => (
            <TarjetaProducto key={p.id} p={p} simbolo={cfg.moneda_simbolo} />
          ))}
        </div>
      </section>
    </>
  );
}
