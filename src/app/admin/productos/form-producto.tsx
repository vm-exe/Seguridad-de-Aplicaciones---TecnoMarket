"use client";

import { useActionState } from "react";
import { Alerta, BotonEnviar, Campo, type EstadoForm } from "@/components/formulario";
import { guardarProducto } from "../acciones";

type Producto = {
  id: number;
  nombre: string;
  descripcion: string;
  detalles: string;
  precio: string;
  descuento: number;
  stock: number;
  categoriaId: number;
  activo: boolean;
};

export function FormProducto({ producto, categorias }: { producto?: Producto; categorias: { id: number; nombre: string }[] }) {
  const inicial: EstadoForm = producto
    ? {
        valores: {
          id: String(producto.id),
          nombre: producto.nombre,
          precio: producto.precio,
          descuento: String(producto.descuento),
          stock: String(producto.stock),
        },
      }
    : {};
  const [estado, accion] = useActionState(guardarProducto, inicial);
  const v = estado.valores ?? {};
  const err = (k: string) => estado.errores?.[k]?.[0];

  return (
    <form action={accion} className="grid gap-4 md:grid-cols-2" noValidate>
      <input type="hidden" name="modo" value={producto ? "editar" : "crear"} />
      <div className="md:col-span-2"><Alerta estado={estado} /></div>
      {producto ? (
        <input type="hidden" name="id" value={producto.id} />
      ) : (
        <Campo nombre="id" etiqueta="Código (numérico)" inputMode="numeric" required estado={estado} />
      )}
      <Campo nombre="nombre" etiqueta="Nombre" maxLength={200} required estado={estado} />
      <div className="md:col-span-2">
        <label className="etiqueta" htmlFor="descripcion">Descripción</label>
        <textarea id="descripcion" name="descripcion" rows={4} maxLength={5000} className="campo" defaultValue={v.descripcion ?? producto?.descripcion} required />
        {err("descripcion") && <p className="mt-1 text-xs text-red-700">{err("descripcion")}</p>}
      </div>
      <div className="md:col-span-2">
        <label className="etiqueta" htmlFor="detalles">Detalles</label>
        <textarea id="detalles" name="detalles" rows={3} maxLength={5000} className="campo" defaultValue={v.detalles ?? producto?.detalles} required />
        {err("detalles") && <p className="mt-1 text-xs text-red-700">{err("detalles")}</p>}
      </div>
      <Campo nombre="precio" etiqueta="Precio" inputMode="decimal" required estado={estado} />
      <Campo nombre="descuento" etiqueta="Descuento (%)" inputMode="numeric" defaultValue={v.descuento ?? "0"} required estado={estado} />
      <Campo nombre="stock" etiqueta="Stock" inputMode="numeric" required estado={estado} />
      <div>
        <label className="etiqueta" htmlFor="categoriaId">Categoría</label>
        <select id="categoriaId" name="categoriaId" className="campo" defaultValue={v.categoriaId ?? producto?.categoriaId ?? ""} required>
          <option value="">Seleccionar…</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
        {err("categoriaId") && <p className="mt-1 text-xs text-red-700">{err("categoriaId")}</p>}
      </div>
      <div>
        <label className="etiqueta" htmlFor="imagenes">Imágenes (JPG, PNG o WebP, máx. 2 MB c/u)</label>
        <input id="imagenes" name="imagenes" type="file" accept="image/jpeg,image/png,image/webp" multiple className="campo" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="activo" defaultChecked={producto?.activo ?? true} /> Producto activo (visible en tienda)
      </label>
      <div className="md:col-span-2"><BotonEnviar className="btn-marca">Guardar</BotonEnviar></div>
    </form>
  );
}
