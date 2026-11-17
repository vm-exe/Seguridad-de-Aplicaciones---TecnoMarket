/**
 * Elimina los datos creados por las pruebas E2E (usuarios @e2e.test, sus pedidos y los
 * productos con payload XSS). No toca la bitácora de auditoría (es histórica e inmutable).
 *   npm run e2e:limpiar
 */
import { inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { ordenes, productos, user } from "@/db/schema";

async function main() {
  const usuarios = await db.select({ id: user.id }).from(user).where(like(user.email, "%@e2e.test"));
  const ids = usuarios.map((u) => u.id);
  if (ids.length) {
    await db.delete(ordenes).where(inArray(ordenes.userId, ids)); // orden_items en cascada
    await db.delete(user).where(inArray(user.id, ids)); // sesiones, cuentas, perfil y 2FA en cascada
  }
  const [prod] = await db.delete(productos).where(like(productos.nombre, "<img src=x%"));
  console.log(`Eliminados: ${ids.length} usuarios de prueba, ${prod.affectedRows} productos de prueba.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
