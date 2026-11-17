import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { urlImagen } from "@/components/tarjeta-producto";
import { listarCategorias, obtenerProducto } from "@/lib/catalogo";
import { idProductoSchema } from "@/lib/validation";
import { eliminarImagen } from "../../acciones";
import { FormProducto } from "../form-producto";

export const metadata: Metadata = { title: "Editar producto" };

export default async function EditarProducto({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ guardado?: string }> }) {
  const r = idProductoSchema.safeParse((await params).id);
  if (!r.success) notFound();
  const [p, cats] = await Promise.all([obtenerProducto(r.data, true), listarCategorias(false)]);
  if (!p) notFound();
  const { guardado } = await searchParams;

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">Editar producto #{p.id}</h1>
      {guardado && <p role="status" className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">Cambios guardados.</p>}
      <div className="tarjeta">
        <FormProducto producto={p} categorias={cats} />
      </div>
      {p.imagenes.length > 0 && (
        <div className="tarjeta mt-6">
          <h2 className="mb-4 font-bold">Imágenes</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {p.imagenes.map((img) => (
              <div key={img.id} className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={urlImagen(img.archivo)} alt="" className="aspect-square w-full rounded-lg bg-crema object-contain" />
                {img.principal && <p className="text-xs font-semibold">Principal</p>}
                <form action={eliminarImagen}>
                  <input type="hidden" name="imagenId" value={img.id} />
                  <button className="text-xs text-red-700 underline">Eliminar</button>
                </form>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
