/**
 * Crea (o promueve) un administrador.
 *   npm run admin:crear -- correo@dominio.com "Nombre Apellido"
 * La contraseña se pide por consola (no queda en el historial del shell).
 * Al primer ingreso el sistema obliga a activar 2FA antes de entrar a /admin.
 * Reemplaza el INSERT comentado en admin/index.php del legado (admin/admin hardcodeado).
 */
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { account, user } from "@/db/schema";
import { auditar } from "@/lib/audit";
import { passwordSchema } from "@/lib/validation";

async function main() {
  const [email, ...nombre] = process.argv.slice(2);
  if (!email || !email.includes("@")) {
    console.error('Uso: npm run admin:crear -- correo@dominio.com "Nombre Apellido"');
    process.exit(1);
  }
  const correo = email.trim().toLowerCase();
  const [existente] = await db.select().from(user).where(eq(user.email, correo)).limit(1);

  if (existente) {
    await db.update(user).set({ role: "admin" }).where(eq(user.id, existente.id));
    await auditar({ accion: "admin.usuario.rol", resultado: "ok", actorEmail: "cli", objetivo: `usuario:${existente.id}`, detalle: { rol: "admin", origen: "script" } });
    console.log(`Usuario ${correo} promovido a administrador.`);
    process.exit(0);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const pass = process.env.ADMIN_PASSWORD ?? (await rl.question("Contraseña (mín. 12 caracteres): "));
  rl.close();
  const v = passwordSchema.safeParse(pass);
  if (!v.success) {
    console.error(v.error.issues.map((i) => i.message).join("\n"));
    process.exit(1);
  }

  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(user).values({ id, name: nombre.join(" ") || "Administrador", email: correo, emailVerified: true, role: "admin" });
    await tx.insert(account).values({ id: randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(pass) });
  });
  await auditar({ accion: "admin.usuario.rol", resultado: "ok", actorEmail: "cli", objetivo: `usuario:${id}`, detalle: { rol: "admin", origen: "script", nuevo: true } });
  console.log(`Administrador ${correo} creado. Ingrese y active 2FA en /cuenta/seguridad.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
