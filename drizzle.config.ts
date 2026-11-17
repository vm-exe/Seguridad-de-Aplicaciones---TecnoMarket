import { readFileSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// Las migraciones usan un usuario con permisos DDL (ventas_migrator),
// distinto del usuario de la aplicación (ventas_app, solo DML).
// Con DATABASE_CA_CERT (Aiven/RDS) la conexión exige TLS con verificación del certificado.
const url = new URL(process.env.MIGRATOR_DATABASE_URL ?? process.env.DATABASE_URL ?? "mysql://localhost/x");
const ca = process.env.DATABASE_CA_CERT;

export default defineConfig({
  dialect: "mysql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    ...(ca ? { ssl: { ca: readFileSync(ca, "utf8"), rejectUnauthorized: true } } : {}),
  },
  strict: true,
  verbose: true,
});
