import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { productos } from "@/db/schema";
import { compararSeguro, hmac } from "./crypto";
import { precioConDescuento } from "./precios";

/**
 * Carrito en cookie HttpOnly firmada con HMAC.
 * - Solo guarda {idProducto: cantidad}; los precios se leen SIEMPRE de la BD.
 * - La firma impide que el cliente altere la cookie (integridad).
 * En el legado, la cantidad de la sesión se interpolaba directo en SQL
 * ("SELECT ..., $cantidad AS cantidad ...") en checkout.php, pago.php y capture.php.
 */
const COOKIE = "vos.carrito";
const MAX_ITEMS = 20;

const carritoSchema = z.record(z.string().regex(/^\d{1,10}$/), z.number().int().min(1).max(10));
export type Carrito = z.infer<typeof carritoSchema>;

export async function leerCarrito(): Promise<Carrito> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return {};
  const [datos, firma] = raw.split(".");
  if (!datos || !firma || !compararSeguro(hmac(datos), firma)) return {};
  try {
    const parsed = carritoSchema.safeParse(JSON.parse(Buffer.from(datos, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export async function guardarCarrito(c: Carrito) {
  const store = await cookies();
  const entradas = Object.entries(c).slice(0, MAX_ITEMS);
  if (entradas.length === 0) {
    store.delete(COOKIE);
    return;
  }
  const datos = Buffer.from(JSON.stringify(Object.fromEntries(entradas))).toString("base64url");
  store.set(COOKIE, `${datos}.${hmac(datos)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.APP_URL?.startsWith("https://") ?? false,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export type LineaCarrito = {
  id: number;
  nombre: string;
  cantidad: number;
  stock: number;
  precioUnitario: number; // centavos con descuento aplicado
  subtotal: number; // centavos
};

/** Resuelve el carrito contra la BD: descarta productos inactivos y ajusta al stock. */
export async function resolverCarrito(c: Carrito): Promise<{ lineas: LineaCarrito[]; total: number }> {
  const ids = Object.keys(c).map(Number);
  if (ids.length === 0) return { lineas: [], total: 0 };
  const filas = await db
    .select({
      id: productos.id,
      nombre: productos.nombre,
      precio: productos.precio,
      descuento: productos.descuento,
      stock: productos.stock,
    })
    .from(productos)
    .where(and(inArray(productos.id, ids), eq(productos.activo, true)));

  const lineas: LineaCarrito[] = filas.map((p) => {
    const cantidad = Math.min(c[String(p.id)] ?? 0, p.stock, 10);
    const precioUnitario = precioConDescuento(p.precio, p.descuento);
    return { id: p.id, nombre: p.nombre, cantidad, stock: p.stock, precioUnitario, subtotal: precioUnitario * cantidad };
  });
  const validas = lineas.filter((l) => l.cantidad > 0);
  return { lineas: validas, total: validas.reduce((s, l) => s + l.subtotal, 0) };
}

export async function contarCarrito(): Promise<number> {
  return Object.keys(await leerCarrito()).length;
}
