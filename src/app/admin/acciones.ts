"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { EstadoForm } from "@/components/formulario";
import { db } from "@/db";
import { categorias, configuracion, productoImagenes, productos, user } from "@/db/schema";
import { auditar } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { contextoSolicitud } from "@/lib/request-context";
import { asegurarAdmin, ErrorReautenticacion } from "@/lib/session";
import { borrarImagen, ErrorArchivo, guardarImagen } from "@/lib/uploads";
import { categoriaSchema, configuracionSchema, formAObjeto, idProductoSchema, productoSchema, uuidSchema } from "@/lib/validation";

/**
 * Todas las acciones administrativas:
 * 1) verifican sesión + rol admin + 2FA en el servidor (asegurarAdmin),
 * 2) validan la entrada con Zod (allowlist),
 * 3) usan consultas parametrizadas (Drizzle),
 * 4) quedan registradas en la bitácora encadenada.
 * Son POST (Server Actions) con verificación de Origin -> no hay CSRF por GET como en el legado.
 */
async function actor(opciones: { reciente?: boolean } = {}) {
  const s = await asegurarAdmin(opciones);
  return { s, ctx: await contextoSolicitud() };
}

function errores(e: z.ZodError, fd: FormData): EstadoForm {
  return { ok: false, mensaje: "Revise los campos", errores: z.flattenError(e).fieldErrors, valores: formAObjeto(fd) };
}

/* -------------------------------- Productos -------------------------------- */
export async function guardarProducto(_p: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const { s, ctx } = await actor();
  const modo = fd.get("modo") === "editar" ? "editar" : "crear";
  const r = productoSchema.safeParse(formAObjeto(fd));
  if (!r.success) return errores(r.error, fd);
  const d = r.data;
  const datos = {
    nombre: d.nombre,
    descripcion: d.descripcion,
    detalles: d.detalles,
    precio: d.precio.toFixed(2),
    descuento: d.descuento,
    stock: d.stock,
    categoriaId: d.categoriaId,
    activo: d.activo,
  };
  const [cat] = await db.select({ id: categorias.id }).from(categorias).where(eq(categorias.id, d.categoriaId)).limit(1);
  if (!cat) return { ok: false, mensaje: "Categoría inválida", valores: formAObjeto(fd) };

  if (modo === "crear") {
    const [existe] = await db.select({ id: productos.id }).from(productos).where(eq(productos.id, d.id)).limit(1);
    if (existe) return { ok: false, mensaje: "Ya existe un producto con ese código", valores: formAObjeto(fd) };
    await db.insert(productos).values({ id: d.id, ...datos });
  } else {
    await db.update(productos).set(datos).where(eq(productos.id, d.id));
  }

  // Imágenes opcionales
  const archivos = fd.getAll("imagenes").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 5);
  const yaTieneImagen =
    (await db.select({ id: productoImagenes.id }).from(productoImagenes).where(eq(productoImagenes.productoId, d.id)).limit(1)).length > 0;
  for (const [i, f] of archivos.entries()) {
    try {
      const img = await guardarImagen(f);
      await db.insert(productoImagenes).values({ productoId: d.id, archivo: img.archivo, mime: img.mime, principal: !yaTieneImagen && i === 0 });
    } catch (e) {
      const motivo = e instanceof ErrorArchivo ? e.message : "Error al guardar la imagen";
      await auditar({ accion: "admin.imagen_rechazada", resultado: "denegado", actorId: s.user.id, actorEmail: s.user.email, objetivo: `producto:${d.id}`, ...ctx, detalle: { motivo } });
      return { ok: false, mensaje: `Producto guardado, pero una imagen fue rechazada: ${motivo}` };
    }
  }

  await auditar({
    accion: modo === "crear" ? "admin.producto.crear" : "admin.producto.actualizar",
    resultado: "ok",
    actorId: s.user.id,
    actorEmail: s.user.email,
    objetivo: `producto:${d.id}`,
    ...ctx,
    detalle: { precio: datos.precio, descuento: d.descuento, stock: d.stock, activo: d.activo, imagenes: archivos.length },
  });
  revalidatePath("/admin/productos");
  redirect(`/admin/productos/${d.id}?guardado=1`);
}

export async function desactivarProducto(fd: FormData) {
  const { s, ctx } = await actor();
  const id = idProductoSchema.safeParse(fd.get("id"));
  if (!id.success) return;
  // Borrado lógico: se conserva el historial de órdenes (en el legado: DELETE por GET sin sesión).
  await db.update(productos).set({ activo: false }).where(eq(productos.id, id.data));
  await auditar({ accion: "admin.producto.desactivar", resultado: "ok", actorId: s.user.id, actorEmail: s.user.email, objetivo: `producto:${id.data}`, ...ctx });
  revalidatePath("/admin/productos");
}

export async function eliminarImagen(fd: FormData) {
  const { s, ctx } = await actor();
  const id = z.coerce.number().int().positive().safeParse(fd.get("imagenId"));
  if (!id.success) return;
  const [img] = await db.select().from(productoImagenes).where(eq(productoImagenes.id, id.data)).limit(1);
  if (!img) return;
  await db.delete(productoImagenes).where(eq(productoImagenes.id, img.id));
  await borrarImagen(img.archivo);
  await auditar({ accion: "admin.producto.imagen", resultado: "ok", actorId: s.user.id, actorEmail: s.user.email, objetivo: `producto:${img.productoId}`, ...ctx, detalle: { eliminada: img.archivo } });
  revalidatePath(`/admin/productos/${img.productoId}`);
}

/* -------------------------------- Categorías ------------------------------- */
export async function crearCategoria(_p: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const { s, ctx } = await actor();
  const r = categoriaSchema.safeParse(formAObjeto(fd));
  if (!r.success) return errores(r.error, fd);
  const [res] = await db.insert(categorias).values({ nombre: r.data.nombre.toUpperCase() });
  await auditar({ accion: "admin.categoria.crear", resultado: "ok", actorId: s.user.id, actorEmail: s.user.email, objetivo: `categoria:${res.insertId}`, ...ctx, detalle: { nombre: r.data.nombre } });
  revalidatePath("/admin/categorias");
  return { ok: true, mensaje: "Categoría creada" };
}

export async function actualizarCategoria(fd: FormData) {
  const { s, ctx } = await actor();
  const id = z.coerce.number().int().positive().safeParse(fd.get("id"));
  const r = categoriaSchema.safeParse(formAObjeto(fd));
  if (!id.success || !r.success) return;
  const activo = fd.get("activo") === "on";
  await db.update(categorias).set({ nombre: r.data.nombre.toUpperCase(), activo }).where(eq(categorias.id, id.data));
  await auditar({ accion: "admin.categoria.actualizar", resultado: "ok", actorId: s.user.id, actorEmail: s.user.email, objetivo: `categoria:${id.data}`, ...ctx, detalle: { nombre: r.data.nombre, activo } });
  revalidatePath("/admin/categorias");
}

/* ------------------------------ Configuración ------------------------------ */
export async function guardarConfiguracion(_p: EstadoForm, fd: FormData): Promise<EstadoForm> {
  let a;
  try {
    a = await actor({ reciente: true }); // acción crítica: exige sesión de menos de 10 min
  } catch (e) {
    if (e instanceof ErrorReautenticacion) return { ok: false, mensaje: e.message };
    throw e;
  }
  const { s, ctx } = a;
  const r = configuracionSchema.safeParse(formAObjeto(fd));
  if (!r.success) return errores(r.error, fd);
  await db.transaction(async (tx) => {
    for (const [clave, valor] of Object.entries(r.data)) {
      await tx.insert(configuracion).values({ clave, valor }).onDuplicateKeyUpdate({ set: { valor } });
    }
  });
  await auditar({ accion: "admin.config.actualizar", resultado: "ok", actorId: s.user.id, actorEmail: s.user.email, objetivo: "configuracion", ...ctx, detalle: r.data });
  revalidatePath("/", "layout");
  return { ok: true, mensaje: "Configuración guardada" };
}

/* --------------------------------- Usuarios -------------------------------- */
export async function cambiarRol(fd: FormData) {
  let a;
  try {
    a = await actor({ reciente: true }); // escalamiento de privilegios: exige sesión de menos de 10 min
  } catch (e) {
    if (e instanceof ErrorReautenticacion) redirect("/admin/usuarios?error=reautenticar");
    throw e;
  }
  const { s, ctx } = a;
  const r = z.object({ userId: uuidSchema, rol: z.enum(["admin", "user"]) }).safeParse(formAObjeto(fd));
  if (!r.success || r.data.userId === s.user.id) return; // un admin no puede degradarse/modificarse a sí mismo
  const [u] = await db.select({ id: user.id, email: user.email }).from(user).where(and(eq(user.id, r.data.userId))).limit(1);
  if (!u) return;
  await auth.api.setRole({ body: { userId: u.id, role: r.data.rol }, headers: await headers() });
  // Revocar sesiones del usuario afectado para que el cambio aplique de inmediato.
  await auth.api.revokeUserSessions({ body: { userId: u.id }, headers: await headers() });
  await auditar({ accion: "admin.usuario.rol", resultado: "ok", actorId: s.user.id, actorEmail: s.user.email, objetivo: `usuario:${u.id}`, ...ctx, detalle: { rol: r.data.rol } });
  revalidatePath("/admin/usuarios");
}
