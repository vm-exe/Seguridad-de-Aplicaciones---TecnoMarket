import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rateLimit } from "@/db/schema";

/**
 * Limitador de ventana fija persistido en BD (compartido entre instancias ECS).
 * Se aplica a las Server Actions sensibles (login, registro, recuperación, 2FA).
 * Capa adicional al rate limit del WAF (nginx limit_req / AWS WAF rate-based rule).
 */
/**
 * Límite por IP. Si la IP no es confiable (TRUST_PROXY=false, típico en desarrollo),
 * NO se aplica: con una IP compartida "desconocida", un atacante podría bloquear el
 * acceso de todos los usuarios (DoS). En producción la IP la fija el WAF/ALB.
 */
export async function permitirIp(prefijo: string, ip: string, max: number, ventanaSeg: number): Promise<boolean> {
  if (!ip || ip === "desconocida") return true;
  return permitir(`${prefijo}:ip:${ip}`, max, ventanaSeg);
}

export async function permitir(clave: string, max: number, ventanaSeg: number): Promise<boolean> {
  const key = `app:${clave}`.slice(0, 255);
  const ahora = Date.now();
  return db.transaction(async (tx) => {
    const [fila] = await tx.select().from(rateLimit).where(eq(rateLimit.key, key)).limit(1).for("update");
    if (!fila) {
      await tx.insert(rateLimit).values({ id: randomUUID(), key, count: 1, lastRequest: ahora });
      return true;
    }
    if (ahora - fila.lastRequest > ventanaSeg * 1000) {
      await tx.update(rateLimit).set({ count: 1, lastRequest: ahora }).where(eq(rateLimit.id, fila.id));
      return true;
    }
    if (fila.count >= max) return false;
    await tx.update(rateLimit).set({ count: fila.count + 1 }).where(eq(rateLimit.id, fila.id));
    return true;
  });
}
