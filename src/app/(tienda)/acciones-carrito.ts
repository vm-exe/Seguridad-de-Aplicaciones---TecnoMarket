"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { productos } from "@/db/schema";
import { guardarCarrito, leerCarrito } from "@/lib/carrito";
import { cantidadSchema, idProductoSchema } from "@/lib/validation";

/**
 * Acciones del carrito. Las Server Actions de Next.js validan el encabezado Origin
 * contra Host (protección CSRF integrada); además todo dato se valida con Zod.
 * En el legado, clases/carrito.php aceptaba cualquier POST y usaba HMAC-SHA1 con clave fija.
 */
async function productoDisponible(id: number) {
  const [p] = await db
    .select({ stock: productos.stock })
    .from(productos)
    .where(and(eq(productos.id, id), eq(productos.activo, true)))
    .limit(1);
  return p ?? null;
}

export async function agregarAlCarrito(fd: FormData) {
  const id = idProductoSchema.safeParse(fd.get("id"));
  const cant = cantidadSchema.safeParse(fd.get("cantidad") ?? 1);
  if (!id.success || !cant.success) return;
  const p = await productoDisponible(id.data);
  if (!p || p.stock < 1) return;
  const c = await leerCarrito();
  c[String(id.data)] = Math.min((c[String(id.data)] ?? 0) + cant.data, 10, p.stock);
  await guardarCarrito(c);
  redirect("/carrito");
}

export async function actualizarCantidad(fd: FormData) {
  const id = idProductoSchema.safeParse(fd.get("id"));
  const cant = cantidadSchema.safeParse(fd.get("cantidad"));
  if (!id.success || !cant.success) return;
  const c = await leerCarrito();
  if (!(String(id.data) in c)) return;
  c[String(id.data)] = cant.data;
  await guardarCarrito(c);
  revalidatePath("/carrito");
}

export async function quitarDelCarrito(fd: FormData) {
  const id = idProductoSchema.safeParse(fd.get("id"));
  if (!id.success) return;
  const c = await leerCarrito();
  delete c[String(id.data)];
  await guardarCarrito(c);
  revalidatePath("/carrito");
}
