"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Alerta, BotonEnviar, Campo, type EstadoForm } from "@/components/formulario";
import { iniciarSesion, registrar, restablecerPassword, solicitarRecuperacion, verificarSegundoFactor } from "./acciones";

const inicial: EstadoForm = {};

export function FormLogin({ next }: { next: string }) {
  const [estado, accion] = useActionState(iniciarSesion, inicial);
  return (
    <form action={accion} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Alerta estado={estado} />
      <Campo nombre="email" etiqueta="Correo electrónico" tipo="email" autoComplete="username" required estado={estado} />
      <Campo nombre="password" etiqueta="Contraseña" tipo="password" autoComplete="current-password" required estado={estado} />
      <BotonEnviar>Ingresar</BotonEnviar>
      <div className="flex justify-between text-sm">
        <Link href="/recuperar" className="text-marca underline">¿Olvidó su contraseña?</Link>
        <Link href="/registro" className="text-marca underline">Crear cuenta</Link>
      </div>
    </form>
  );
}

export function FormSegundoFactor({ next }: { next: string }) {
  const [estado, accion] = useActionState(verificarSegundoFactor, inicial);
  const [respaldo, setRespaldo] = useState(false);
  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="tipo" value={respaldo ? "respaldo" : "totp"} />
      <Alerta estado={estado} />
      {respaldo ? (
        <Campo nombre="codigo" etiqueta="Código de respaldo" autoComplete="off" required estado={estado} />
      ) : (
        <Campo
          nombre="codigo"
          etiqueta="Código de su app autenticadora"
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          required
          autoFocus
          estado={estado}
        />
      )}
      <BotonEnviar>Verificar</BotonEnviar>
      <button type="button" className="text-sm text-marca underline" onClick={() => setRespaldo(!respaldo)}>
        {respaldo ? "Usar código de la app" : "Usar un código de respaldo"}
      </button>
    </form>
  );
}

export function FormRegistro() {
  const [estado, accion] = useActionState(registrar, inicial);
  if (estado.ok) return <Alerta estado={estado} />;
  return (
    <form action={accion} className="grid gap-4 md:grid-cols-2" noValidate>
      <div className="md:col-span-2">
        <Alerta estado={estado} />
      </div>
      <Campo nombre="nombres" etiqueta="Nombres" autoComplete="given-name" required estado={estado} />
      <Campo nombre="apellidos" etiqueta="Apellidos" autoComplete="family-name" required estado={estado} />
      <Campo nombre="email" etiqueta="Correo electrónico" tipo="email" autoComplete="email" required estado={estado} />
      <Campo nombre="telefono" etiqueta="Teléfono" tipo="tel" autoComplete="tel" required estado={estado} />
      <Campo nombre="dpi" etiqueta="DPI (13 dígitos)" inputMode="numeric" autoComplete="off" required estado={estado} />
      <div className="hidden md:block" />
      <Campo nombre="password" etiqueta="Contraseña (mínimo 12 caracteres)" tipo="password" autoComplete="new-password" required estado={estado} />
      <Campo nombre="repassword" etiqueta="Confirmar contraseña" tipo="password" autoComplete="new-password" required estado={estado} />
      <p className="text-xs text-gray-500 md:col-span-2">
        Su DPI se almacena cifrado (AES-256-GCM) y solo se usa para verificar su identidad. Use una frase de contraseña larga y única.
      </p>
      <div className="md:col-span-2">
        <BotonEnviar>Registrarme</BotonEnviar>
      </div>
    </form>
  );
}

export function FormRecuperar() {
  const [estado, accion] = useActionState(solicitarRecuperacion, inicial);
  return (
    <form action={accion} className="space-y-4">
      <Alerta estado={estado} />
      <Campo nombre="email" etiqueta="Correo electrónico" tipo="email" autoComplete="email" required estado={estado} />
      <BotonEnviar>Enviar enlace</BotonEnviar>
    </form>
  );
}

export function FormRestablecer({ token }: { token: string }) {
  const [estado, accion] = useActionState(restablecerPassword, inicial);
  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Alerta estado={estado} />
      <Campo nombre="password" etiqueta="Nueva contraseña" tipo="password" autoComplete="new-password" required estado={estado} />
      <Campo nombre="repassword" etiqueta="Confirmar contraseña" tipo="password" autoComplete="new-password" required estado={estado} />
      <BotonEnviar>Cambiar contraseña</BotonEnviar>
    </form>
  );
}
