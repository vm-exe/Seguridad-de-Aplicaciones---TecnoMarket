import "server-only";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Pool de conexiones con un usuario de mínimo privilegio (solo DML).
 * - multipleStatements: false  -> impide "stacked queries" en caso de inyección.
 * - Todas las consultas pasan por Drizzle (parametrizadas).
 */
const globalForDb = globalThis as unknown as { pool?: mysql.Pool };

/**
 * TLS hacia BD gestionadas (Aiven, Amazon RDS): si DATABASE_CA_CERT apunta al certificado
 * de la CA (ca.pem), se exige TLS y se valida el certificado del servidor (evita MITM).
 */
function opcionesTls(): mysql.PoolOptions["ssl"] {
  if (!env.DATABASE_CA_CERT) return undefined;
  return { ca: readFileSync(env.DATABASE_CA_CERT, "utf8"), rejectUnauthorized: true, minVersion: "TLSv1.2" };
}

const pool =
  globalForDb.pool ??
  mysql.createPool({
    uri: env.DATABASE_URL,
    connectionLimit: 10,
    multipleStatements: false,
    timezone: "Z",
    dateStrings: false,
    ssl: opcionesTls(),
  });

if (env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema, mode: "default" });
export type DB = typeof db;
