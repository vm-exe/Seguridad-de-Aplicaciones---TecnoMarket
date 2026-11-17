import "server-only";
import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { categorias, productoImagenes, productos } from "@/db/schema";

export const POR_PAGINA = 12;

/** Escapa comodines de LIKE (% _ \) — el legado usaba LIKE con la entrada cruda. */
export function escaparLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listarCategorias(soloActivas = true) {
  return db
    .select()
    .from(categorias)
    .where(soloActivas ? eq(categorias.activo, true) : undefined)
    .orderBy(asc(categorias.nombre));
}

export async function listarProductos(f: { q?: string; categoria?: number; pagina?: number }) {
  const condiciones = [eq(productos.activo, true)];
  if (f.q) condiciones.push(like(productos.nombre, `%${escaparLike(f.q)}%`));
  if (f.categoria) condiciones.push(eq(productos.categoriaId, f.categoria));
  const where = and(...condiciones);
  const pagina = f.pagina ?? 1;

  const [filas, [{ total }]] = await Promise.all([
    db
      .select({
        id: productos.id,
        nombre: productos.nombre,
        precio: productos.precio,
        descuento: productos.descuento,
        stock: productos.stock,
      })
      .from(productos)
      .where(where)
      .orderBy(desc(productos.createdAt), asc(productos.id))
      .limit(POR_PAGINA) // paginación acotada: evita extracción masiva
      .offset((pagina - 1) * POR_PAGINA),
    db.select({ total: sql<number>`count(*)` }).from(productos).where(where),
  ]);
  const imgs = await imagenesPrincipales(filas.map((f) => f.id));
  return {
    productos: filas.map((p) => ({ ...p, imagen: imgs.get(p.id) ?? null })),
    total: Number(total),
    paginas: Math.max(1, Math.ceil(Number(total) / POR_PAGINA)),
  };
}

export async function imagenesPrincipales(ids: number[]) {
  const mapa = new Map<number, string>();
  if (ids.length === 0) return mapa;
  const filas = await db
    .select({ productoId: productoImagenes.productoId, archivo: productoImagenes.archivo, principal: productoImagenes.principal })
    .from(productoImagenes)
    .where(inArray(productoImagenes.productoId, ids))
    .orderBy(desc(productoImagenes.principal), asc(productoImagenes.id));
  for (const f of filas) if (!mapa.has(f.productoId)) mapa.set(f.productoId, f.archivo);
  return mapa;
}

/**
 * Consultas simples (sin la API relacional de Drizzle, que genera LATERAL JOIN
 * no soportado por MariaDB 10.4).
 */
export async function obtenerProducto(id: number, incluirInactivos = false) {
  const [p] = await db
    .select()
    .from(productos)
    .where(incluirInactivos ? eq(productos.id, id) : and(eq(productos.id, id), eq(productos.activo, true)))
    .limit(1);
  if (!p) return null;
  const [[categoria], imagenes] = await Promise.all([
    db.select().from(categorias).where(eq(categorias.id, p.categoriaId)).limit(1),
    db
      .select()
      .from(productoImagenes)
      .where(eq(productoImagenes.productoId, p.id))
      .orderBy(desc(productoImagenes.principal), asc(productoImagenes.id)),
  ]);
  return { ...p, categoria: categoria ?? null, imagenes };
}
