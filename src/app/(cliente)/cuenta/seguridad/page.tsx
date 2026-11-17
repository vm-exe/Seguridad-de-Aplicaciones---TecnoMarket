import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clientePerfil } from "@/db/schema";
import { descifrarCampo, enmascararDpi } from "@/lib/crypto";
import { requerirUsuario } from "@/lib/session";
import { Activar2fa, CambiarPassword, Desactivar2fa } from "./formularios";

export const metadata: Metadata = { title: "Seguridad de la cuenta" };

export default async function SeguridadPage({ searchParams }: { searchParams: Promise<{ requiere2fa?: string; activado?: string }> }) {
  const s = await requerirUsuario("/cuenta/seguridad");
  const { requiere2fa, activado } = await searchParams;
  const [perfil] = await db.select().from(clientePerfil).where(eq(clientePerfil.userId, s.user.id)).limit(1);

  let dpi = "—";
  if (perfil) {
    try {
      dpi = enmascararDpi(descifrarCampo(perfil.dpiCifrado));
    } catch {
      dpi = "No disponible";
    }
  }

  return (
    <div className="contenedor max-w-3xl space-y-6 py-10">
      <h1 className="text-3xl font-bold">Seguridad de la cuenta</h1>
      {activado && (
        <p role="status" className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">Verificación en dos pasos activada.</p>
      )}
      {requiere2fa && (
        <p role="alert" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Para acceder al panel de administración debe activar la verificación en dos pasos.
        </p>
      )}

      <section className="tarjeta">
        <h2 className="mb-3 text-lg font-bold">Perfil</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-gray-500">Nombre</dt>
          <dd>{s.user.name}</dd>
          <dt className="text-gray-500">Correo</dt>
          <dd>{s.user.email}</dd>
          {perfil && (
            <>
              <dt className="text-gray-500">Teléfono</dt>
              <dd>{perfil.telefono}</dd>
              <dt className="text-gray-500">DPI</dt>
              <dd className="font-mono">{dpi}</dd>
            </>
          )}
          <dt className="text-gray-500">Rol</dt>
          <dd>{s.user.role === "admin" ? "Administrador" : "Cliente"}</dd>
        </dl>
      </section>

      <section className="tarjeta">
        <h2 className="mb-1 text-lg font-bold">Verificación en dos pasos (TOTP)</h2>
        <p className="mb-4 text-sm text-gray-600">
          Estado: <b className={s.user.twoFactorEnabled ? "text-green-700" : "text-red-700"}>{s.user.twoFactorEnabled ? "Activa" : "Inactiva"}</b>
        </p>
        {s.user.twoFactorEnabled ? (
          s.user.role === "admin" ? (
            <p className="text-sm text-gray-600">Obligatoria para administradores: no puede desactivarse.</p>
          ) : (
            <Desactivar2fa />
          )
        ) : (
          <Activar2fa />
        )}
      </section>

      <section className="tarjeta">
        <h2 className="mb-4 text-lg font-bold">Cambiar contraseña</h2>
        <CambiarPassword />
      </section>
    </div>
  );
}
