import "server-only";

/**
 * Logger estructurado JSON (una línea por evento) hacia stdout.
 * En AWS, ECS envía stdout a CloudWatch Logs y desde ahí al SIEM.
 * Nunca registrar contraseñas, tokens, DPI ni datos de tarjeta.
 */
type Nivel = "debug" | "info" | "warn" | "error";
const orden: Record<Nivel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const nivelMin = (process.env.LOG_LEVEL as Nivel) || "info";

const CLAVES_SENSIBLES = /pass(word)?|secret|token|authorization|cookie|dpi|card|cvv/i;

function sanitizar(obj: unknown, prof = 0): unknown {
  if (prof > 4 || obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => sanitizar(v, prof + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = CLAVES_SENSIBLES.test(k) ? "[REDACTADO]" : sanitizar(v, prof + 1);
  }
  return out;
}

function log(nivel: Nivel, msg: string, datos?: Record<string, unknown>) {
  if (orden[nivel] < orden[nivelMin]) return;
  const linea = JSON.stringify({
    ts: new Date().toISOString(),
    level: nivel,
    service: "ventas-online",
    msg,
    ...(datos ? (sanitizar(datos) as object) : {}),
  });
  if (nivel === "error" || nivel === "warn") console.error(linea);
  else console.log(linea);
}

export const logger = {
  debug: (m: string, d?: Record<string, unknown>) => log("debug", m, d),
  info: (m: string, d?: Record<string, unknown>) => log("info", m, d),
  warn: (m: string, d?: Record<string, unknown>) => log("warn", m, d),
  error: (m: string, d?: Record<string, unknown>) => log("error", m, d),
};
