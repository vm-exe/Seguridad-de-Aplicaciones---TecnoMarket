import { z } from "zod";

/**
 * Esquemas de validación (allowlist) para TODA entrada del usuario.
 * En el legado los parámetros $_GET/$_POST se concatenaban directo en SQL y HTML.
 */

const textoPlano = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "Requerido")
    .max(max, `Máximo ${max} caracteres`)
    // Rechaza caracteres de control (excepto saltos de línea) — evita inyección en logs/correos.
    .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v), "Contiene caracteres no permitidos");

const nombrePersona = z
  .string()
  .trim()
  .min(2, "Mínimo 2 caracteres")
  .max(80)
  .regex(/^[\p{L}\p{M}' .-]+$/u, "Solo letras, espacios, apóstrofes y guiones");

// Contraseñas comunes rechazadas (lista mínima; en producción usar HIBP k-anonymity).
const COMUNES = new Set(["123456789012", "contraseña123", "password1234", "qwertyuiop12", "admin1234567", "tr1f0rc3&"]);

export const passwordSchema = z
  .string()
  .min(12, "La contraseña debe tener al menos 12 caracteres")
  .max(128, "Máximo 128 caracteres")
  .refine((v) => !COMUNES.has(v.toLowerCase()), "Esa contraseña es demasiado común")
  .refine((v) => /[a-z]/i.test(v) && /\d/.test(v), "Use letras y números (se recomienda una frase larga)");

/** DPI guatemalteco: 13 dígitos (CUI). */
export const dpiSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^\d{13}$/, "El DPI debe tener 13 dígitos"));

export const registroSchema = z
  .object({
    nombres: nombrePersona,
    apellidos: nombrePersona,
    email: z.email("Correo inválido").trim().toLowerCase().max(255),
    telefono: z.string().trim().regex(/^\+?[0-9 -]{8,20}$/, "Teléfono inválido"),
    dpi: dpiSchema,
    password: passwordSchema,
    repassword: z.string(),
  })
  .refine((d) => d.password === d.repassword, { path: ["repassword"], error: "Las contraseñas no coinciden" });

export const loginSchema = z.object({
  email: z.email("Correo inválido").trim().toLowerCase().max(255),
  password: z.string().min(1, "Requerido").max(128),
});

export const idProductoSchema = z.coerce.number().int().positive().max(2_147_483_647);
export const cantidadSchema = z.coerce.number().int().min(1).max(10);
export const uuidSchema = z.uuid();

export const productoSchema = z.object({
  id: idProductoSchema,
  nombre: textoPlano(200),
  descripcion: textoPlano(5000),
  detalles: textoPlano(5000),
  precio: z.coerce
    .number()
    .positive("Debe ser mayor que 0")
    .max(99_999_999.99)
    // Máximo 2 decimales (tolerancia por representación binaria de los flotantes).
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Máximo 2 decimales"),
  descuento: z.coerce.number().int().min(0).max(90),
  stock: z.coerce.number().int().min(0).max(1_000_000),
  categoriaId: z.coerce.number().int().positive(),
  activo: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
});

export const categoriaSchema = z.object({
  nombre: textoPlano(50),
});

export const configuracionSchema = z.object({
  tienda_nombre: textoPlano(100),
  tienda_telefono: z.string().trim().regex(/^\+?[0-9 -]{8,20}$/, "Teléfono inválido"),
  moneda_simbolo: z.string().trim().min(1).max(4),
  moneda_codigo: z.enum(["USD", "GTQ"]),
});

export const busquedaSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  categoria: z.coerce.number().int().positive().optional().catch(undefined),
  pagina: z.coerce.number().int().min(1).max(1000).optional().catch(1),
});

/** Convierte FormData a objeto plano para validarlo con Zod. */
export function formAObjeto(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v;
  return out;
}

export type ErroresCampo = Record<string, string[] | undefined>;
