import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { categorias, productos } from "@/db/schema";
import { leerConfig } from "@/lib/config-tienda";
import { aCentavos, formatoMoneda } from "@/lib/precios";
import { desactivarProducto } from "../acciones";

export const metadata: Metadata = { title: "Productos" };

export default async function AdminProductos() {
  const [lista, cfg] = await Promise.all([
    db
      .select({
        id: productos.id,
        nombre: productos.nombre,
        precio: productos.precio,
        descuento: productos.descuento,
        stock: productos.stock,
        activo: productos.activo,
        categoria: categorias.nombre,
      })
      .from(productos)
      .leftJoin(categorias, eq(productos.categoriaId, categorias.id))
      .orderBy(asc(productos.id)),
    leerConfig(),
  ]);
  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Productos</h1>
        <Link href="/admin/productos/nuevo" className="btn-marca">Nuevo producto</Link>
      </div>
      <div className="overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr><th>Código</th><th>Nombre</th><th>Categoría</th><th>Precio</th><th>Desc.</th><th>Stock</th><th>Estado</th><th /></tr>
          </thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id} className={p.activo ? "" : "text-gray-400"}>
                <td className="font-mono">{p.id}</td>
                <td>{p.nombre}</td>
                <td>{p.categoria}</td>
                <td>{formatoMoneda(aCentavos(p.precio), cfg.moneda_simbolo)}</td>
                <td>{p.descuento}%</td>
                <td>{p.stock}</td>
                <td>{p.activo ? "Activo" : "Inactivo"}</td>
                <td className="flex gap-3">
                  <Link href={`/admin/productos/${p.id}`} className="text-marca underline">Editar</Link>
                  {p.activo && (
                    <form action={desactivarProducto}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className="text-red-700 underline">Desactivar</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
