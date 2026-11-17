import { relations, sql } from "drizzle-orm";
import {
  boolean,
  char,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  smallint,
  text,
  datetime,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

/**
 * Perfil del cliente (datos de negocio separados de la identidad).
 * - dpiCifrado: AES-256-GCM (iv:tag:ciphertext en base64). En el legado se guardaba en texto plano.
 * - dpiHash: HMAC-SHA256 del DPI normalizado; permite detectar duplicados sin descifrar.
 */
export const clientePerfil = mysqlTable(
  "cliente_perfil",
  {
    userId: varchar("user_id", { length: 36 })
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    nombres: varchar("nombres", { length: 80 }).notNull(),
    apellidos: varchar("apellidos", { length: 80 }).notNull(),
    telefono: varchar("telefono", { length: 20 }).notNull(),
    dpiCifrado: varchar("dpi_cifrado", { length: 255 }).notNull(),
    dpiHash: char("dpi_hash", { length: 64 }).notNull(),
    legacyClienteId: int("legacy_cliente_id"),
    createdAt: datetime("created_at", { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`).$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("cliente_perfil_dpi_hash_uq").on(t.dpiHash)],
);

export const categorias = mysqlTable("categorias", {
  id: int("id").autoincrement().primaryKey(),
  nombre: varchar("nombre", { length: 50 }).notNull(),
  activo: boolean("activo").notNull().default(true),
});

export const productos = mysqlTable(
  "productos",
  {
    id: int("id").primaryKey(),
    nombre: varchar("nombre", { length: 200 }).notNull(),
    descripcion: text("descripcion").notNull(),
    detalles: text("detalles").notNull(),
    precio: decimal("precio", { precision: 10, scale: 2 }).notNull(),
    descuento: smallint("descuento").notNull().default(0),
    stock: int("stock").notNull().default(0),
    categoriaId: int("categoria_id")
      .notNull()
      .references(() => categorias.id),
    activo: boolean("activo").notNull().default(true),
    createdAt: datetime("created_at", { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`).$onUpdate(() => new Date()),
  },
  (t) => [index("productos_categoria_idx").on(t.categoriaId)],
);

/** Imágenes: nombre aleatorio (UUID) generado por el servidor, nunca el nombre del cliente. */
export const productoImagenes = mysqlTable(
  "producto_imagenes",
  {
    id: int("id").autoincrement().primaryKey(),
    productoId: int("producto_id")
      .notNull()
      .references(() => productos.id, { onDelete: "cascade" }),
    archivo: varchar("archivo", { length: 64 }).notNull(),
    mime: varchar("mime", { length: 32 }).notNull(),
    principal: boolean("principal").notNull().default(false),
    createdAt: datetime("created_at", { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("producto_imagenes_producto_idx").on(t.productoId)],
);

/**
 * Órdenes. El total SIEMPRE se calcula en el servidor a partir de la BD
 * (en el legado capture.php confiaba en el monto enviado por el navegador).
 */
export const ordenes = mysqlTable(
  "ordenes",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => user.id),
    estado: mysqlEnum("estado", ["pendiente", "procesando", "pagada", "cancelada", "fallida", "reembolsada"]).notNull().default("pendiente"),
    total: decimal("total", { precision: 10, scale: 2 }).notNull(),
    moneda: char("moneda", { length: 3 }).notNull(),
    proveedorPago: mysqlEnum("proveedor_pago", ["paypal", "simulado", "legado"]).notNull(),
    referenciaPago: varchar("referencia_pago", { length: 64 }),
    capturaId: varchar("captura_id", { length: 64 }),
    createdAt: datetime("created_at", { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    pagadaAt: datetime("pagada_at", { fsp: 3 }),
  },
  (t) => [
    index("ordenes_user_idx").on(t.userId),
    uniqueIndex("ordenes_referencia_pago_uq").on(t.referenciaPago),
  ],
);

export const ordenItems = mysqlTable(
  "orden_items",
  {
    id: int("id").autoincrement().primaryKey(),
    ordenId: varchar("orden_id", { length: 36 })
      .notNull()
      .references(() => ordenes.id, { onDelete: "cascade" }),
    productoId: int("producto_id").notNull(),
    nombre: varchar("nombre", { length: 200 }).notNull(),
    precioUnitario: decimal("precio_unitario", { precision: 10, scale: 2 }).notNull(),
    cantidad: int("cantidad").notNull(),
  },
  (t) => [index("orden_items_orden_idx").on(t.ordenId)],
);

/**
 * Configuración NO sensible (nombre de tienda, teléfono, moneda).
 * Los secretos (SMTP, PayPal) ya no se guardan en BD: viven en variables de entorno / Secrets Manager.
 */
export const configuracion = mysqlTable("configuracion", {
  clave: varchar("clave", { length: 50 }).primaryKey(),
  valor: varchar("valor", { length: 255 }).notNull(),
  updatedAt: datetime("updated_at", { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`).$onUpdate(() => new Date()),
});

/**
 * Bitácora de auditoría a prueba de manipulación (cadena de hashes).
 * hash = HMAC-SHA256(HMAC_KEY, prevHash || contenido). Si alguien borra o altera
 * una fila, la verificación de la cadena falla (no repudio - STRIDE "R").
 */
export const auditoria = mysqlTable(
  "auditoria",
  {
    id: int("id").autoincrement().primaryKey(),
    ts: datetime("ts", { fsp: 3 }).notNull(),
    actorId: varchar("actor_id", { length: 36 }),
    actorEmail: varchar("actor_email", { length: 255 }),
    accion: varchar("accion", { length: 64 }).notNull(),
    objetivo: varchar("objetivo", { length: 128 }),
    resultado: mysqlEnum("resultado", ["ok", "denegado", "error"]).notNull(),
    ip: varchar("ip", { length: 45 }),
    userAgent: varchar("user_agent", { length: 255 }),
    detalle: json("detalle"),
    prevHash: char("prev_hash", { length: 64 }).notNull(),
    hash: char("hash", { length: 64 }).notNull(),
  },
  (t) => [index("auditoria_ts_idx").on(t.ts), index("auditoria_accion_idx").on(t.accion)],
);

export const productosRelations = relations(productos, ({ one, many }) => ({
  categoria: one(categorias, { fields: [productos.categoriaId], references: [categorias.id] }),
  imagenes: many(productoImagenes),
}));

export const productoImagenesRelations = relations(productoImagenes, ({ one }) => ({
  producto: one(productos, { fields: [productoImagenes.productoId], references: [productos.id] }),
}));

export const ordenesRelations = relations(ordenes, ({ many, one }) => ({
  items: many(ordenItems),
  usuario: one(user, { fields: [ordenes.userId], references: [user.id] }),
}));

export const ordenItemsRelations = relations(ordenItems, ({ one }) => ({
  orden: one(ordenes, { fields: [ordenItems.ordenId], references: [ordenes.id] }),
}));
