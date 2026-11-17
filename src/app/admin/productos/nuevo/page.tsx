import type { Metadata } from "next";
import { listarCategorias } from "@/lib/catalogo";
import { FormProducto } from "../form-producto";

export const metadata: Metadata = { title: "Nuevo producto" };

export default async function NuevoProducto() {
  const cats = await listarCategorias(false);
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">Nuevo producto</h1>
      <div className="tarjeta">
        <FormProducto categorias={cats} />
      </div>
    </>
  );
}
