import type { Metadata } from "next";
import { rutaSegura } from "@/lib/session";
import { FormSegundoFactor } from "../../formularios";
import { MarcoAuth } from "../../marco";

export const metadata: Metadata = { title: "Verificación en dos pasos" };

export default async function SegundoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <MarcoAuth titulo="Verificación en dos pasos">
      <p className="mb-4 text-sm text-gray-600">Ingrese el código de 6 dígitos de su aplicación autenticadora.</p>
      <FormSegundoFactor next={rutaSegura(next, "/")} />
    </MarcoAuth>
  );
}
