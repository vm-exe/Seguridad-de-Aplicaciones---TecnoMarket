import { randomBytes } from "node:crypto";

// Entorno mínimo y aleatorio para pruebas (nunca secretos reales).
process.env.DATABASE_URL ??= "mysql://test:test@127.0.0.1:3306/test";
process.env.APP_URL ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= randomBytes(32).toString("hex");
process.env.FIELD_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.HMAC_KEY ??= randomBytes(32).toString("base64");
