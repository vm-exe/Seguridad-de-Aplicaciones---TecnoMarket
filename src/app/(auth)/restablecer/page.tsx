import type { Metadata } from "next";
import Link from "next/link";
import { FormRestablecer } from "../formularios";
import { MarcoAuth } from "../marco";

export const metadata: Metadata = { title: "Restablecer contraseña" };

export default async function RestablecerPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  return (
    <MarcoAuth titulo="Restablecer contraseña">
      {!token || error ? (
        <p className="text-sm">
          El enlace es inválido o expiró.{" "}
          <Link className="text-marca underline" href="/recuperar">
            Solicite uno nuevo
          </Link>
          .
        </p>
      ) : (
        <FormRestablecer token={token} />
      )}
    </MarcoAuth>
  );
}
