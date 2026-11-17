import Link from "next/link";
import { contarCarrito } from "@/lib/carrito";
import { obtenerSesion } from "@/lib/session";
import { cerrarSesion } from "@/app/(auth)/acciones";

export async function Encabezado() {
  const [sesion, items] = await Promise.all([obtenerSesion(), contarCarrito()]);
  return (
    <header className="bg-marca text-white">
      <nav className="contenedor flex flex-wrap items-center gap-x-6 gap-y-2 py-4" aria-label="Navegación principal">
        <Link href="/" className="text-2xl font-bold">
          Fi<span className="text-acento">.</span>
        </Link>
        <ul className="flex flex-1 flex-wrap gap-5 text-sm text-white/80">
          <li><Link className="hover:text-white" href="/">Inicio</Link></li>
          <li><Link className="hover:text-white" href="/tienda">Tienda</Link></li>
          {sesion && <li><Link className="hover:text-white" href="/cuenta">Mis compras</Link></li>}
          {sesion?.user.role === "admin" && <li><Link className="font-semibold text-acento" href="/admin">Administración</Link></li>}
        </ul>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/carrito" className="relative rounded-full bg-white/10 px-3 py-1.5 hover:bg-white/20" aria-label={`Carrito, ${items} productos`}>
            Carrito <span className="ml-1 rounded-full bg-acento px-2 text-xs font-bold text-tinta">{items}</span>
          </Link>
          {sesion ? (
            <>
              <Link href="/cuenta/seguridad" className="max-w-40 truncate text-white/80 hover:text-white" title={sesion.user.email}>
                {sesion.user.name}
              </Link>
              <form action={cerrarSesion}>
                <button className="text-white/80 underline-offset-2 hover:text-white hover:underline">Salir</button>
              </form>
            </>
          ) : (
            <Link href="/login" className="text-white/80 hover:text-white">Ingresar</Link>
          )}
        </div>
      </nav>
    </header>
  );
}
