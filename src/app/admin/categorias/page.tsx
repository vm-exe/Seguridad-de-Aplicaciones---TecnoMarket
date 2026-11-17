import type { Metadata } from "next";
import { listarCategorias } from "@/lib/catalogo";
import { actualizarCategoria } from "../acciones";
import { FormNuevaCategoria } from "./form";

export const metadata: Metadata = { title: "Categorías" };

export default async function AdminCategorias() {
  const cats = await listarCategorias(false);
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">Categorías</h1>
      <div className="tarjeta mb-6">
        <FormNuevaCategoria />
      </div>
      <table className="tabla">
        <thead>
          <tr><th>ID</th><th>Nombre</th><th>Activa</th><th /></tr>
        </thead>
        <tbody>
          {cats.map((c) => (
            <tr key={c.id}>
              <td className="font-mono">{c.id}</td>
              <td colSpan={3}>
                <form action={actualizarCategoria} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="id" value={c.id} />
                  <input name="nombre" defaultValue={c.nombre} maxLength={50} className="campo max-w-xs" aria-label={`Nombre de la categoría ${c.id}`} />
                  <label className="flex items-center gap-1 text-sm">
                    <input type="checkbox" name="activo" defaultChecked={c.activo} /> Activa
                  </label>
                  <button className="text-sm text-marca underline">Guardar</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
