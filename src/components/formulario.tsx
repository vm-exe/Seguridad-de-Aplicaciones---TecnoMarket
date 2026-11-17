"use client";

import { useFormStatus } from "react-dom";

export type EstadoForm = {
  ok?: boolean;
  mensaje?: string;
  errores?: Record<string, string[] | undefined>;
  valores?: Record<string, string>;
};

export function BotonEnviar({ children, className = "btn-primario w-full" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? "Procesando…" : children}
    </button>
  );
}

export function Alerta({ estado }: { estado?: EstadoForm }) {
  if (!estado?.mensaje) return null;
  return (
    <div
      role={estado.ok ? "status" : "alert"}
      className={`rounded-lg px-4 py-3 text-sm ${estado.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
    >
      {estado.mensaje}
    </div>
  );
}

export function Campo({
  nombre,
  etiqueta,
  estado,
  tipo = "text",
  ...resto
}: {
  nombre: string;
  etiqueta: string;
  estado?: EstadoForm;
  tipo?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "type">) {
  const errores = estado?.errores?.[nombre];
  const id = `f-${nombre}`;
  return (
    <div>
      <label htmlFor={id} className="etiqueta">{etiqueta}</label>
      <input
        id={id}
        name={nombre}
        type={tipo}
        className="campo"
        aria-invalid={!!errores}
        aria-describedby={errores ? `${id}-err` : undefined}
        defaultValue={tipo === "password" ? undefined : estado?.valores?.[nombre]}
        {...resto}
      />
      {errores && <p id={`${id}-err`} className="mt-1 text-xs text-red-700">{errores[0]}</p>}
    </div>
  );
}
