// Configuración espejo SOLO para `npx auth generate` (el CLI no puede importar módulos "server-only").
// Debe mantener los mismos plugins/opciones de base de datos que src/lib/auth.ts.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins/admin";
import { twoFactor } from "better-auth/plugins/two-factor";

export const auth = betterAuth({
  database: drizzleAdapter({} as never, { provider: "mysql" }),
  emailAndPassword: { enabled: true },
  rateLimit: { enabled: true, storage: "database" },
  advanced: { database: { generateId: "uuid" } },
  plugins: [admin(), twoFactor()],
});
