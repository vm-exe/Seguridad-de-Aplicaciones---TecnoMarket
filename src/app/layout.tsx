import type { Metadata } from "next";
import { connection } from "next/server";
import { Encabezado } from "@/components/encabezado";
import { Pie } from "@/components/pie";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Furniture Investment", template: "%s · Furniture Investment" },
  description: "Tienda en línea de muebles — versión segura migrada a Next.js",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Renderizado dinámico obligatorio: la CSP usa un nonce distinto por solicitud.
  await connection();
  return (
    <html lang="es">
      <body className="flex min-h-screen flex-col antialiased">
        <Encabezado />
        <main className="flex-1">{children}</main>
        <Pie />
      </body>
    </html>
  );
}
