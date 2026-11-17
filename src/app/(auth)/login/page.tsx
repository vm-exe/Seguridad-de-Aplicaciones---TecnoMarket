import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { obtenerSesion, rutaSegura } from "@/lib/session";
import { FormLogin } from "../formularios";
import { MarcoAuth } from "../marco";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = rutaSegura(sp.next, "/");
  if (await obtenerSesion()) redirect(next);
  return (
    <MarcoAuth titulo="Iniciar sesión">
      {sp.verificado && (
        <p className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">Correo verificado. Ya puede ingresar.</p>
      )}
      {sp.restablecido && (
        <p className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">Contraseña actualizada. Ingrese con su nueva contraseña.</p>
      )}
      <FormLogin next={next} />
    </MarcoAuth>
  );
}
