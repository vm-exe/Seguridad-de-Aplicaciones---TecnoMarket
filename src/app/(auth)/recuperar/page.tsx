import type { Metadata } from "next";
import { FormRecuperar } from "../formularios";
import { MarcoAuth } from "../marco";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default function RecuperarPage() {
  return (
    <MarcoAuth titulo="Recuperar contraseña">
      <FormRecuperar />
    </MarcoAuth>
  );
}
