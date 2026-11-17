/**
 * Datos mínimos para un entorno nuevo (Docker / CI / DAST) cuando no se migra el legado.
 * Idempotente: solo inserta si las tablas están vacías.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { categorias, configuracion, productos } from "@/db/schema";

async function main() {
  await db
    .insert(configuracion)
    .values([
      { clave: "tienda_nombre", valor: "Furniture Investment" },
      { clave: "tienda_telefono", valor: "+502 2222-3333" },
      { clave: "moneda_simbolo", valor: "$" },
      { clave: "moneda_codigo", valor: "USD" },
    ])
    .onDuplicateKeyUpdate({ set: { clave: sql`clave` } });

  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(productos);
  if (Number(n) > 0) {
    console.log("Ya existen productos; no se insertan datos de ejemplo.");
    process.exit(0);
  }
  const [cocina] = await db.insert(categorias).values({ nombre: "COCINA" });
  const [dormitorio] = await db.insert(categorias).values({ nombre: "DORMITORIO" });
  await db.insert(categorias).values([{ nombre: "SALA" }, { nombre: "BAÑO" }]);
  await db.insert(productos).values([
    { id: 603, nombre: "Mesa de cocina extensible Gerbera", descripcion: "Mesa extensible para 6 personas.", detalles: "Madera de pino, 160-200 cm.", precio: "176.00", descuento: 0, stock: 6, categoriaId: cocina.insertId },
    { id: 1001, nombre: "Mesita de noche Lundgren", descripcion: "Mesita con cajón.", detalles: "45 x 40 x 55 cm.", precio: "110.00", descuento: 0, stock: 10, categoriaId: dormitorio.insertId },
    { id: 1002, nombre: "Mesita 3 cajones Juno", descripcion: "Mesita de tres cajones.", detalles: "Acabado blanco mate.", precio: "99.00", descuento: 17, stock: 5, categoriaId: dormitorio.insertId },
  ]);
  console.log("Datos de ejemplo insertados.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
