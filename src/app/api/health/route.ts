import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Liveness: GET /api/health          -> 200 si el proceso responde.
 * Readiness: GET /api/health?db=1    -> 200 solo si la BD responde (usado por ALB / compose).
 * No expone versiones, hostnames ni mensajes de error internos.
 */
export async function GET(req: Request) {
  const conDb = new URL(req.url).searchParams.get("db") === "1";
  if (!conDb) return Response.json({ status: "ok" });
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok", db: "ok" });
  } catch {
    return Response.json({ status: "error", db: "unavailable" }, { status: 503 });
  }
}
