import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { obtenerSesion } from "@/lib/session";
import { cambiarRol } from "../acciones";

export const metadata: Metadata = { title: "Usuarios" };

export default async function AdminUsuarios({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const s = await obtenerSesion();
  const lista = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      verificado: user.emailVerified,
      dosFactores: user.twoFactorEnabled,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(desc(user.createdAt))
    .limit(200);
  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">Usuarios</h1>
      {error === "reautenticar" && (
        <p role="alert" className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Cambiar roles requiere una sesión iniciada hace menos de 10 minutos. Cierre sesión y vuelva a ingresar con su código 2FA.
        </p>
      )}
      <p className="mb-6 text-sm text-gray-600">Al cambiar el rol se revocan todas las sesiones del usuario. Un administrador debe activar 2FA para usar el panel.</p>
      <div className="overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr><th>Nombre</th><th>Correo</th><th>Verificado</th><th>2FA</th><th>Rol</th></tr>
          </thead>
          <tbody>
            {lista.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.verificado ? "Sí" : "No"}</td>
                <td>{u.dosFactores ? "Sí" : "No"}</td>
                <td>
                  {u.id === s?.user.id ? (
                    <span>{u.role === "admin" ? "admin" : "cliente"} (usted)</span>
                  ) : (
                    <form action={cambiarRol} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <select name="rol" defaultValue={u.role ?? "user"} className="campo w-32" aria-label={`Rol de ${u.email}`}>
                        <option value="user">cliente</option>
                        <option value="admin">admin</option>
                      </select>
                      <button className="text-sm text-marca underline">Aplicar</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
