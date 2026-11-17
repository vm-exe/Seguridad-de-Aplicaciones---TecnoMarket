/**
 * Migración de datos del sistema PHP legado (BD `fornitureinvestment`) al nuevo esquema.
 *
 *   LEGACY_DATABASE_URL=mysql://usuario_lectura@localhost:3306/fornitureinvestment
 *   LEGACY_IMAGES_DIR="C:/xampp/htdocs/Desarrollo Web/Sistemas de ventas en linea/images/productos"
 *   npm run db:migrar-legado
 *
 * Decisiones de seguridad:
 * - Conexión al legado de SOLO LECTURA (solo SELECT).
 * - DPI: se cifra con AES-256-GCM y se indexa con HMAC (en el legado estaba en claro).
 * - Contraseñas: los hashes bcrypt del legado NO se migran; los clientes deben usar
 *   "¿Olvidó su contraseña?" (verifica la posesión del correo y fuerza una contraseña ≥ 12).
 *   Los tokens MD5 de activación/recuperación se descartan.
 * - La tabla `admin` NO se migra: el administrador se crea de nuevo con `npm run admin:crear` y 2FA.
 * - Secretos de `configuracion` (SMTP, PayPal) NO se migran: pasan a variables de entorno / Secrets Manager.
 * - Imágenes: se revalidan por "magic bytes" y se renombran con UUID.
 * Idempotente: puede ejecutarse varias veces.
 */
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { db } from "@/db";
import { categorias, clientePerfil, configuracion, ordenes, ordenItems, productoImagenes, productos, user } from "@/db/schema";
import { auditar } from "@/lib/audit";
import { cifrarCampo, hmacIndice } from "@/lib/crypto";
import { ErrorArchivo, guardarImagen } from "@/lib/uploads";

const url = process.env.LEGACY_DATABASE_URL;
const dirImgs = process.env.LEGACY_IMAGES_DIR;
if (!url) {
  console.error("Defina LEGACY_DATABASE_URL (ej. mysql://root@localhost:3306/fornitureinvestment)");
  process.exit(1);
}

const resumen: Record<string, number> = {};
const contar = (k: string) => (resumen[k] = (resumen[k] ?? 0) + 1);

async function main() {
  const legado = await mysql.createConnection({ uri: url, multipleStatements: false, dateStrings: true });
  const q = async <T>(s: string, params: unknown[] = []) => (await legado.query<RowDataPacket[]>(s, params))[0] as T[];

  // ---- Configuración no sensible ----
  const conf = await q<{ nombre: string; valor: string }>("SELECT nombre, valor FROM configuracion");
  const c = Object.fromEntries(conf.map((x) => [x.nombre, x.valor]));
  const mapeo: [string, string | undefined][] = [
    ["tienda_nombre", c.general_nombre || c.tienda_nombre],
    ["tienda_telefono", c.general_telefono],
    ["moneda_simbolo", c.general_moneda],
    ["moneda_codigo", c.moneda_paypal === "GTQ" ? "GTQ" : "USD"],
  ];
  for (const [clave, valor] of mapeo) {
    if (!valor) continue;
    await db.insert(configuracion).values({ clave, valor: valor.slice(0, 255) }).onDuplicateKeyUpdate({ set: { valor: valor.slice(0, 255) } });
    contar("configuracion");
  }

  // ---- Categorías (se conservan los IDs) ----
  for (const cat of await q<{ id: number; nombre: string; activo: number }>("SELECT id, nombre, activo FROM categorias")) {
    await db.insert(categorias).values({ id: cat.id, nombre: cat.nombre.slice(0, 50), activo: cat.activo === 1 }).onDuplicateKeyUpdate({ set: { nombre: cat.nombre.slice(0, 50) } });
    contar("categorias");
  }
  const idsCat = new Set((await db.select({ id: categorias.id }).from(categorias)).map((x) => x.id));
  let sinCategoria: number | undefined;

  // ---- Productos ----
  const prods = await q<{ id: number; nombre: string; descripcion: string; detalles: string; precio: string; descuento: number; stock: number; id_categoria: number; activo: number }>(
    "SELECT id, nombre, descripcion, detalles, precio, descuento, stock, id_categoria, activo FROM productos",
  );
  for (const p of prods) {
    let catId = p.id_categoria;
    if (!idsCat.has(catId)) {
      // Integridad referencial: el legado tenía productos apuntando a categorías inexistentes.
      if (!sinCategoria) {
        const [r] = await db.insert(categorias).values({ nombre: "SIN CATEGORÍA", activo: true });
        sinCategoria = r.insertId;
        idsCat.add(sinCategoria);
      }
      catId = sinCategoria;
      contar("productos_categoria_reasignada");
    }
    await db
      .insert(productos)
      .values({
        id: p.id,
        nombre: p.nombre,
        descripcion: p.descripcion || "—",
        detalles: p.detalles || "—",
        precio: p.precio,
        descuento: Math.max(0, Math.min(90, p.descuento)),
        stock: Math.max(0, p.stock),
        categoriaId: catId,
        activo: p.activo === 1,
      })
      .onDuplicateKeyUpdate({ set: { nombre: p.nombre } });
    contar("productos");

    // Imágenes
    if (dirImgs) {
      const ya = await db.select({ id: productoImagenes.id }).from(productoImagenes).where(eq(productoImagenes.productoId, p.id)).limit(1);
      if (ya.length) continue;
      const dir = path.join(dirImgs, String(p.id));
      const archivos = await readdir(dir).catch(() => [] as string[]);
      archivos.sort((a, b) => (a.startsWith("principal") ? -1 : b.startsWith("principal") ? 1 : a.localeCompare(b)));
      for (const [i, nombre] of archivos.entries()) {
        try {
          const buf = await readFile(path.join(dir, nombre));
          const img = await guardarImagen(new File([new Uint8Array(buf)], nombre));
          await db.insert(productoImagenes).values({ productoId: p.id, archivo: img.archivo, mime: img.mime, principal: i === 0 });
          contar("imagenes");
        } catch (e) {
          if (e instanceof ErrorArchivo) contar("imagenes_rechazadas");
          else throw e;
        }
      }
    }
  }

  // ---- Clientes + usuarios ----
  const clientes = await q<{ id: number; nombres: string; apellidos: string; email: string; telefono: string; dpi: string; fecha_alta: string; activacion: number | null }>(
    `SELECT c.id, c.nombres, c.apellidos, c.email, c.telefono, c.dpi, c.fecha_alta, u.activacion
       FROM clientes c LEFT JOIN usuarios u ON u.id_cliente = c.id`,
  );
  const mapaClientes = new Map<number, string>(); // id legado -> user.id nuevo
  for (const cl of clientes) {
    const email = cl.email.trim().toLowerCase();
    const [prev] = await db.select({ userId: clientePerfil.userId }).from(clientePerfil).where(eq(clientePerfil.legacyClienteId, cl.id)).limit(1);
    if (prev) {
      mapaClientes.set(cl.id, prev.userId);
      continue;
    }
    const [porEmail] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
    if (porEmail) {
      contar("clientes_email_duplicado");
      mapaClientes.set(cl.id, porEmail.id);
      continue;
    }
    const dpiNorm = cl.dpi.replace(/[\s-]/g, "");
    const dpiHash = hmacIndice(`dpi:${dpiNorm}`);
    const [dupDpi] = await db.select({ id: clientePerfil.userId }).from(clientePerfil).where(eq(clientePerfil.dpiHash, dpiHash)).limit(1);

    const id = randomUUID();
    await db.transaction(async (tx) => {
      // Sin registro en `account`: el cliente debe restablecer su contraseña por correo.
      await tx.insert(user).values({
        id,
        name: `${cl.nombres} ${cl.apellidos}`.slice(0, 255),
        email,
        emailVerified: cl.activacion === 1,
        role: "user",
        createdAt: new Date(`${cl.fecha_alta}Z`),
      });
      await tx.insert(clientePerfil).values({
        userId: id,
        nombres: cl.nombres.slice(0, 80),
        apellidos: cl.apellidos.slice(0, 80),
        telefono: cl.telefono.slice(0, 20),
        dpiCifrado: cifrarCampo(dpiNorm),
        // Si el DPI ya existe (datos sucios del legado) se usa un hash único y se reporta.
        dpiHash: dupDpi ? hmacIndice(`dpi-dup:${cl.id}:${dpiNorm}`) : dpiHash,
        legacyClienteId: cl.id,
      });
    });
    if (dupDpi) contar("clientes_dpi_duplicado");
    mapaClientes.set(cl.id, id);
    contar("clientes");
  }

  // ---- Compras -> órdenes ----
  const compras = await q<{ id: number; id_transaccion: string; fecha: string; status: string; id_cliente: string; total: string }>(
    "SELECT id, id_transaccion, fecha, status, id_cliente, total FROM compra",
  );
  for (const co of compras) {
    const userId = mapaClientes.get(Number(co.id_cliente));
    if (!userId) {
      contar("compras_sin_cliente");
      continue;
    }
    const [ya] = await db.select({ id: ordenes.id }).from(ordenes).where(eq(ordenes.referenciaPago, co.id_transaccion)).limit(1);
    if (ya) continue;
    const ordenId = randomUUID();
    const fecha = new Date(`${co.fecha}Z`);
    const items = await q<{ id_producto: number; nombre: string; precio: string; cantidad: number }>(
      "SELECT id_producto, nombre, precio, cantidad FROM detalle_compra WHERE id_compra = ?",
      [co.id],
    );
    await db.transaction(async (tx) => {
      await tx.insert(ordenes).values({
        id: ordenId,
        userId,
        estado: co.status === "COMPLETED" ? "pagada" : "fallida",
        total: co.total,
        moneda: "USD",
        proveedorPago: "legado",
        referenciaPago: co.id_transaccion.slice(0, 64),
        capturaId: co.id_transaccion.slice(0, 64),
        createdAt: fecha,
        pagadaAt: co.status === "COMPLETED" ? fecha : null,
      });
      if (items.length)
        await tx.insert(ordenItems).values(
          items.map((it) => ({ ordenId, productoId: it.id_producto, nombre: it.nombre.slice(0, 200), precioUnitario: it.precio, cantidad: it.cantidad })),
        );
    });
    contar("ordenes");
  }

  await legado.end();
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(user).where(and(eq(user.role, "user")));
  await auditar({ accion: "sistema.migracion_legado", resultado: "ok", actorEmail: "cli", detalle: resumen });
  console.log("Migración completada:", resumen, `| usuarios cliente totales: ${n}`);
  console.log("Recuerde: los clientes migrados deben usar '¿Olvidó su contraseña?' para definir una nueva.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
