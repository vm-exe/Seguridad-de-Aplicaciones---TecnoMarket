import "server-only";
import { headers } from "next/headers";
import { env } from "./env";

/**
 * IP del cliente. Solo se confía en X-Forwarded-For cuando la app está detrás
 * de un proxy conocido (WAF/ALB) — de lo contrario un atacante podría falsificarla
 * para evadir el rate limiting o contaminar la bitácora.
 */
export function ipDesdeHeaders(h: Headers): string {
  if (env.TRUST_PROXY) {
    const xff = h.get("x-forwarded-for");
    if (xff) {
      // El último salto lo agrega nuestro proxy de confianza.
      const partes = xff.split(",").map((s) => s.trim()).filter(Boolean);
      const ip = partes[partes.length - 1];
      if (ip) return ip.slice(0, 45);
    }
    const real = h.get("x-real-ip");
    if (real) return real.slice(0, 45);
  }
  return "desconocida";
}

export async function contextoSolicitud() {
  const h = await headers();
  return {
    ip: ipDesdeHeaders(h),
    userAgent: (h.get("user-agent") ?? "").slice(0, 255),
  };
}
