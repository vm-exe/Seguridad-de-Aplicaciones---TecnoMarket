"use client";

import { useActionState } from "react";
import { Alerta, BotonEnviar, Campo, type EstadoForm } from "@/components/formulario";
import { cambiarPassword, confirmar2fa, desactivar2fa, iniciar2fa, type Estado2fa } from "./acciones";

export function Activar2fa() {
  const [estadoAlta, alta] = useActionState(iniciar2fa, {} as Estado2fa);
  const [estadoConf, confirmar] = useActionState(confirmar2fa, {} as Estado2fa);

  if (estadoAlta.paso === "verificar") {
    return (
      <div className="space-y-4">
        <p className="text-sm">1. Escanee el código con Google Authenticator, Microsoft Authenticator o similar.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={estadoAlta.qr} alt="Código QR para la app autenticadora" width={220} height={220} className="rounded-lg border" />
        {estadoAlta.clave && (
          <p className="text-xs text-gray-600">
            ¿No puede escanear? Ingrese esta clave manualmente: <code data-testid="clave-totp" className="break-all font-mono">{estadoAlta.clave}</code>
          </p>
        )}
        <div>
          <p className="text-sm font-semibold">2. Guarde estos códigos de respaldo en un lugar seguro (se muestran una sola vez):</p>
          <ul className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-crema p-3 font-mono text-sm">
            {estadoAlta.respaldo?.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
        <form action={confirmar} className="space-y-3">
          <Alerta estado={estadoConf} />
          <Campo nombre="codigo" etiqueta="3. Ingrese el código de 6 dígitos" inputMode="numeric" maxLength={6} autoComplete="one-time-code" required estado={estadoConf} />
          <BotonEnviar className="btn-marca">Confirmar y activar</BotonEnviar>
        </form>
      </div>
    );
  }

  return (
    <form action={alta} className="space-y-3">
      <Alerta estado={estadoAlta} />
      <Campo nombre="password" etiqueta="Confirme su contraseña" tipo="password" autoComplete="current-password" required estado={estadoAlta} />
      <BotonEnviar className="btn-marca">Activar verificación en dos pasos</BotonEnviar>
    </form>
  );
}

export function Desactivar2fa() {
  const [estado, accion] = useActionState(desactivar2fa, {} as EstadoForm);
  return (
    <form action={accion} className="space-y-3">
      <Alerta estado={estado} />
      <Campo nombre="password" etiqueta="Contraseña" tipo="password" autoComplete="current-password" required estado={estado} />
      <BotonEnviar className="btn-peligro">Desactivar 2FA</BotonEnviar>
    </form>
  );
}

export function CambiarPassword() {
  const [estado, accion] = useActionState(cambiarPassword, {} as EstadoForm);
  return (
    <form action={accion} className="space-y-3">
      <Alerta estado={estado} />
      <Campo nombre="actual" etiqueta="Contraseña actual" tipo="password" autoComplete="current-password" required estado={estado} />
      <Campo nombre="password" etiqueta="Nueva contraseña (mín. 12)" tipo="password" autoComplete="new-password" required estado={estado} />
      <Campo nombre="repassword" etiqueta="Confirmar nueva contraseña" tipo="password" autoComplete="new-password" required estado={estado} />
      <BotonEnviar className="btn-primario">Cambiar contraseña</BotonEnviar>
    </form>
  );
}
