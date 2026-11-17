import "server-only";
import { z } from "zod";

/**
 * Validación de variables de entorno al arrancar (fail-fast).
 * Reemplaza las constantes hardcodeadas del sistema legado
 * (KEY_TOKEN / KEY_CIFRADO "Tr1f0rc3&", root sin contraseña, etc.).
 * En la nube estos valores vienen de AWS Secrets Manager.
 */
const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, {
    error: "Debe ser una clave de 32 bytes codificada en base64",
  });

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().startsWith("mysql://"),
  /** Ruta al ca.pem de la BD gestionada (Aiven/RDS). Si se define, la conexión exige TLS verificado. */
  DATABASE_CA_CERT: z.string().optional(),
  APP_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  FIELD_ENCRYPTION_KEY: base64Key32,
  HMAC_KEY: base64Key32,
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("Ventas Online <no-reply@localhost>"),
  PAYMENT_MODE: z.enum(["paypal", "simulado"]).default("simulado"),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_API_BASE: z.url().optional(),
  UPLOAD_DIR: z.string().default("./uploads"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Verificación de contraseñas filtradas (HIBP, k-anonimato). Desactivar solo sin salida a internet (CI). */
  PASSWORD_BREACH_CHECK: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /**
   * SOLO laboratorio/pruebas E2E: guarda los correos como archivos JSON en este directorio
   * en lugar de enviarlos. Rechazado si hay SMTP real configurado.
   */
  MAIL_CAPTURE_DIR: z.string().optional(),
});

/**
 * Durante `next build` (Docker/CI) no existen secretos: se usan valores de relleno
 * que NUNCA llegan a ejecución (en runtime el proceso vuelve a cargar y validar el entorno).
 */
const EN_BUILD = process.env.NEXT_PHASE === "phase-production-build";
const RELLENO_BUILD = {
  DATABASE_URL: "mysql://build:build@127.0.0.1:3306/build",
  APP_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "build-placeholder-build-placeholder-000",
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  HMAC_KEY: Buffer.alloc(32).toString("base64"),
};

function load() {
  const parsed = schema.safeParse(EN_BUILD ? { ...RELLENO_BUILD, ...process.env } : process.env);
  if (!parsed.success) {
    // Solo se listan los nombres de variables, nunca sus valores.
    const campos = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configuración inválida. Revise las variables: ${campos}`);
  }
  const env = parsed.data;
  if (EN_BUILD) return { ...env, PAYPAL_API_BASE: env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com" };
  if (env.NODE_ENV === "production" && env.PAYMENT_MODE === "simulado" && process.env.ALLOW_SIMULATED_PAYMENTS !== "true") {
    throw new Error("PAYMENT_MODE=simulado no está permitido en producción");
  }
  if (env.PAYMENT_MODE === "paypal" && (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET)) {
    throw new Error("PAYMENT_MODE=paypal requiere PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET");
  }
  if (env.NODE_ENV === "production") {
    // Sin proxy de confianza todas las IP se ven iguales: el rate limit por IP se apagaría
    // y el de Better Auth compartiría un único contador (DoS de login para todos).
    if (!env.TRUST_PROXY) throw new Error("En producción TRUST_PROXY debe ser true (la app debe estar detrás del WAF/ALB)");
    // Evita apuntar por descuido al sandbox (o a un host arbitrario) en producción.
    if (env.PAYMENT_MODE === "paypal" && !env.PAYPAL_API_BASE) throw new Error("En producción PAYPAL_API_BASE debe definirse explícitamente");
  }
  if (env.MAIL_CAPTURE_DIR && env.SMTP_HOST) throw new Error("MAIL_CAPTURE_DIR no puede usarse junto con SMTP real");
  return { ...env, PAYPAL_API_BASE: env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com" };
}

export const env = load();
