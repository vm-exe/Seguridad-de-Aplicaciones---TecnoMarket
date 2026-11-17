"use client";

import { useActionState } from "react";
import { Alerta, BotonEnviar, Campo, type EstadoForm } from "@/components/formulario";
import { crearCategoria } from "../acciones";

export function FormNuevaCategoria() {
  const [estado, accion] = useActionState(crearCategoria, {} as EstadoForm);
  return (
    <form action={accion} className="flex flex-wrap items-end gap-3">
      <div className="w-full"><Alerta estado={estado} /></div>
      <div className="min-w-60 flex-1">
        <Campo nombre="nombre" etiqueta="Nueva categoría" maxLength={50} required estado={estado} />
      </div>
      <BotonEnviar className="btn-marca">Agregar</BotonEnviar>
    </form>
  );
}
