/**
 * Datos mínimos para un entorno nuevo (Docker / CI / DAST) cuando no se migra el legado.
 * Idempotente: inserta productos solo si la tabla está vacía, y fotos solo a los productos
 * que todavía no tienen ninguna.
 *
 * Las fotos vienen de scripts/datos-ejemplo/productos/<id>/ (las del sistema PHP original) y
 * se guardan con guardarImagen(): la MISMA validación que una carga desde el panel admin
 * (magic bytes, 2 MB, nombre UUID, fuera de /public).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categorias, configuracion, productoImagenes, productos } from "@/db/schema";
import { ErrorArchivo, guardarImagen } from "@/lib/uploads";

const DIR_FOTOS = path.resolve("scripts", "datos-ejemplo", "productos");

async function insertarProductos() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(productos);
  if (Number(n) > 0) {
    console.log("Ya existen productos; no se insertan datos de ejemplo.");
    return;
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
}

async function cargarFotos() {
  const carpetas = await readdir(DIR_FOTOS).catch(() => [] as string[]);
  let cargadas = 0;
  for (const carpeta of carpetas) {
    const id = Number(carpeta);
    if (!Number.isInteger(id)) continue;
    const [producto] = await db.select({ id: productos.id }).from(productos).where(eq(productos.id, id)).limit(1);
    if (!producto) continue;
    const ya = await db.select({ id: productoImagenes.id }).from(productoImagenes).where(eq(productoImagenes.productoId, id)).limit(1);
    if (ya.length) continue;

    const archivos = (await readdir(path.join(DIR_FOTOS, carpeta))).sort((a, b) =>
      a.startsWith("principal") ? -1 : b.startsWith("principal") ? 1 : a.localeCompare(b),
    );
    for (const [i, nombre] of archivos.entries()) {
      try {
        const buf = await readFile(path.join(DIR_FOTOS, carpeta, nombre));
        const img = await guardarImagen(new File([new Uint8Array(buf)], nombre));
        await db.insert(productoImagenes).values({ productoId: id, archivo: img.archivo, mime: img.mime, principal: i === 0 });
        cargadas++;
      } catch (e) {
        if (e instanceof ErrorArchivo) console.warn(`Foto rechazada (${carpeta}/${nombre}): ${e.message}`);
        else throw e;
      }
    }
  }
  console.log(cargadas ? `Fotos de ejemplo cargadas: ${cargadas}.` : "Los productos ya tienen fotos.");
}

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
  await insertarProductos();
  await cargarFotos();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
