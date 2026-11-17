import type { Metadata } from "next";
import Link from "next/link";
import { FormRegistro } from "../formularios";
import { MarcoAuth } from "../marco";

export const metadata: Metadata = { title: "Crear cuenta" };

export default function RegistroPage() {
  return (
    <MarcoAuth titulo="Crear cuenta" ancho="max-w-2xl">
      <FormRegistro />
      <p className="mt-6 text-sm">
        ¿Ya tiene cuenta?{" "}
        <Link href="/login" className="text-marca underline">
          Inicie sesión
        </Link>
      </p>
    </MarcoAuth>
  );
}
