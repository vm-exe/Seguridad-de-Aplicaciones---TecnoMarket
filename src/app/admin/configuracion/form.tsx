"use client";

import { useActionState } from "react";
import { Alerta, BotonEnviar, Campo, type EstadoForm } from "@/components/formulario";
import { guardarConfiguracion } from "../acciones";

export function FormConfiguracion({ valores }: { valores: Record<string, string> }) {
  const [estado, accion] = useActionState(guardarConfiguracion, { valores } as EstadoForm);
  return (
    <form action={accion} className="space-y-4">
      <Alerta estado={estado} />
      <Campo nombre="tienda_nombre" etiqueta="Nombre de la tienda" maxLength={100} required estado={estado} />
      <Campo nombre="tienda_telefono" etiqueta="Teléfono" required estado={estado} />
      <Campo nombre="moneda_simbolo" etiqueta="Símbolo de moneda" maxLength={4} required estado={estado} />
      <div>
        <label className="etiqueta" htmlFor="moneda_codigo">Moneda (ISO 4217)</label>
        <select id="moneda_codigo" name="moneda_codigo" className="campo" defaultValue={estado.valores?.moneda_codigo ?? valores.moneda_codigo}>
          <option value="USD">USD</option>
          <option value="GTQ">GTQ</option>
        </select>
      </div>
      <BotonEnviar className="btn-marca">Guardar</BotonEnviar>
    </form>
  );
}
