import Link from "next/link";
import { requerirAdmin } from "@/lib/session";

const MENU = [
  ["/admin", "Resumen"],
  ["/admin/productos", "Productos"],
  ["/admin/categorias", "Categorías"],
  ["/admin/ordenes", "Órdenes"],
  ["/admin/usuarios", "Usuarios"],
  ["/admin/auditoria", "Auditoría"],
  ["/admin/configuracion", "Configuración"],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Autorización en el servidor para TODO el subárbol /admin (rol admin + 2FA).
  const s = await requerirAdmin();
  return (
    <div className="contenedor grid gap-8 py-8 md:grid-cols-[200px_1fr]">
      <aside>
        <p className="mb-3 text-xs uppercase tracking-wide text-gray-500">Administración</p>
        <nav className="flex flex-row flex-wrap gap-1 md:flex-col" aria-label="Menú de administración">
          {MENU.map(([href, txt]) => (
            <Link key={href} href={href} className="rounded-lg px-3 py-2 text-sm hover:bg-crema">
              {txt}
            </Link>
          ))}
        </nav>
        <p className="mt-6 hidden truncate text-xs text-gray-500 md:block" title={s.user.email}>
          {s.user.email}
        </p>
      </aside>
      <section className="min-w-0">{children}</section>
    </div>
  );
}
