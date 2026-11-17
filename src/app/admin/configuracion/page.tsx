import type { Metadata } from "next";
import { leerConfig } from "@/lib/config-tienda";
import { FormConfiguracion } from "./form";

export const metadata: Metadata = { title: "Configuración" };

export default async function AdminConfiguracion() {
  const cfg = await leerConfig();
  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">Configuración de la tienda</h1>
      <p className="mb-6 text-sm text-gray-600">
        Las credenciales de SMTP y PayPal ya no se administran desde aquí: se gestionan como secretos (variables de entorno / AWS Secrets
        Manager) y nunca se almacenan en la base de datos.
      </p>
      <div className="tarjeta max-w-xl">
        <FormConfiguracion valores={cfg} />
      </div>
    </>
  );
}
