import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { haveIBeenPwned } from "better-auth/plugins/haveibeenpwned";
import { twoFactor } from "better-auth/plugins/two-factor";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { auditar } from "./audit";
import { env } from "./env";
import { enviarCorreo, plantillaEnlace } from "./mail";
import { ipDesdeHeaders } from "./request-context";

/**
 * Autenticación con Better Auth (librería mantenida, en lugar de código casero).
 * Corrige los hallazgos del legado:
 * - Tokens predecibles md5(uniqid(mt_rand())) y sin expiración -> tokens aleatorios con expiración.
 * - Búsquedas con LIKE (comodines % _) en usuario/token -> comparaciones exactas.
 * - Sin bloqueo de fuerza bruta -> rate limiting persistente por IP y ruta.
 * - Sin regeneración de sesión / cookies sin flags -> sesión nueva por login, cookies HttpOnly+Secure+SameSite.
 * - Sin MFA para administradores -> TOTP (twoFactor) obligatorio para rol admin.
 */
export const auth = betterAuth({
  appName: "Ventas Online Segura",
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],
  database: drizzleAdapter(db, { provider: "mysql", schema }),
  telemetry: { enabled: false },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    autoSignIn: false,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 60 * 30, // 30 minutos
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await enviarCorreo(
        user.email,
        "Restablecer contraseña - Ventas Online",
        plantillaEnlace("Restablecer contraseña", "Recibimos una solicitud para cambiar su contraseña.", url, "Cambiar contraseña"),
        `Enlace para restablecer: ${url}`,
      );
    },
    onPasswordReset: async ({ user }) => {
      await auditar({ accion: "auth.password_reset", resultado: "ok", actorId: user.id, actorEmail: user.email });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24, // 24 horas
    sendVerificationEmail: async ({ user, url }) => {
      await enviarCorreo(
        user.email,
        "Active su cuenta - Ventas Online",
        plantillaEnlace("Bienvenido", "Para activar su cuenta confirme su correo electrónico.", url, "Activar cuenta"),
        `Enlace de activación: ${url}`,
      );
    },
  },

  session: {
    expiresIn: 60 * 60 * 24, // 1 día
    updateAge: 60 * 60, // renovar cada hora de actividad
    freshAge: 60 * 10, // acciones sensibles requieren login reciente (10 min)
  },

  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 600, max: 5 },
      "/request-password-reset": { window: 600, max: 3 },
      "/send-verification-email": { window: 600, max: 3 },
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 60, max: 3 },
    },
  },

  advanced: {
    useSecureCookies: env.APP_URL.startsWith("https://"),
    cookiePrefix: "vos",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    ipAddress: { ipAddressHeaders: env.TRUST_PROXY ? ["x-real-ip", "x-forwarded-for"] : [] },
    database: { generateId: "uuid" },
  },

  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await auditar({ accion: "auth.registro", resultado: "ok", actorId: user.id, actorEmail: user.email });
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          await auditar({
            accion: "auth.login",
            resultado: "ok",
            actorId: session.userId,
            ip: session.ipAddress,
            userAgent: session.userAgent,
          });
        },
      },
    },
  },

  hooks: {
    // Registrar intentos fallidos para detección de fuerza bruta en el SIEM.
    // Solo solicitudes HTTP directas a /api/auth/*; las Server Actions auditan por su cuenta.
    after: createAuthMiddleware(async (ctx) => {
      if (!ctx.request) return;
      const r = ctx.context.returned as { statusCode?: number; status?: string | number } | undefined;
      const fallo = r instanceof Error || (r && typeof r === "object" && "statusCode" in r && (r.statusCode ?? 200) >= 400);
      if (!fallo) return;
      if (ctx.path === "/sign-in/email" || ctx.path.startsWith("/two-factor/verify")) {
        const email = typeof ctx.body?.email === "string" ? ctx.body.email.slice(0, 255) : null;
        await auditar({
          accion: ctx.path === "/sign-in/email" ? "auth.login_fallido" : "auth.2fa_fallido",
          resultado: "denegado",
          actorEmail: email,
          ip: ipDesdeHeaders(ctx.request.headers), // respeta TRUST_PROXY (no se confía en X-Real-IP del cliente)
          userAgent: ctx.request?.headers.get("user-agent")?.slice(0, 255) ?? null,
        });
      }
    }),
  },

  plugins: [
    admin({ defaultRole: "user", adminRoles: ["admin"] }),
    twoFactor({
      issuer: "Ventas Online Segura",
      skipVerificationOnEnable: false,
      // Bloqueo POR CUENTA (no por IP): 5 códigos fallidos bloquean el 2FA 15 minutos,
      // aunque el atacante rote IPs o no exista proxy de confianza.
      accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 },
    }),
    // Rechaza contraseñas presentes en filtraciones públicas (HIBP, k-anonimato: solo se envían
    // los 5 primeros caracteres del SHA-1). Se aplica en registro, cambio y restablecimiento.
    haveIBeenPwned({
      enabled: env.PASSWORD_BREACH_CHECK,
      customPasswordCompromisedMessage: "Esta contraseña aparece en filtraciones públicas. Elija otra.",
    }),
    nextCookies(), // debe ir al final
  ],
});

export type Sesion = typeof auth.$Infer.Session;
