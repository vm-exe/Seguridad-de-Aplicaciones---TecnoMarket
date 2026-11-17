import type { Metadata } from "next";
import Link from "next/link";
import { BotonEnviar } from "@/components/formulario";
import { leerCarrito, resolverCarrito } from "@/lib/carrito";
import { leerConfig } from "@/lib/config-tienda";
import { env } from "@/lib/env";
import { formatoMoneda } from "@/lib/precios";
import { requerirUsuario } from "@/lib/session";
import { iniciarCheckout } from "../acciones-pago";

export const metadata: Metadata = { title: "Pago" };

const ERRORES: Record<string, string> = {
  inicio: "No fue posible iniciar el pago. Intente de nuevo.",
  pago: "El pago no pudo completarse o no coincide con la orden.",
  limite: "Demasiados intentos de pago. Espere unos minutos.",
  orden: "Orden inválida.",
  cancelado: "El pago fue cancelado.",
};

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await requerirUsuario("/checkout");
  const { error } = await searchParams;
  const [{ lineas, total }, cfg] = await Promise.all([resolverCarrito(await leerCarrito()), leerConfig()]);
  const m = (c: number) => formatoMoneda(c, cfg.moneda_simbolo);

  return (
    <div className="contenedor max-w-3xl py-10">
      <h1 className="mb-6 text-3xl font-bold">Confirmar compra</h1>
      {error && ERRORES[error] && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{ERRORES[error]}</p>}
      {lineas.length === 0 ? (
        <p>Su carrito está vacío. <Link className="text-marca underline" href="/tienda">Ir a la tienda</Link></p>
      ) : (
        <div className="tarjeta">
          <p className="mb-4 text-sm text-gray-600">Comprador: <b>{s.user.email}</b></p>
          <table className="tabla">
            <tbody>
              {lineas.map((l) => (
                <tr key={l.id}>
                  <td>{l.nombre} × {l.cantidad}</td>
                  <td className="text-right">{m(l.subtotal)}</td>
                </tr>
              ))}
              <tr>
                <td className="font-bold">Total ({cfg.moneda_codigo})</td>
                <td className="text-right text-lg font-bold">{m(total)}</td>
              </tr>
            </tbody>
          </table>
          <form action={iniciarCheckout} className="mt-6">
            <BotonEnviar className="btn-acento w-full">
              {env.PAYMENT_MODE === "paypal" ? "Pagar con PayPal" : "Pagar (modo simulado de laboratorio)"}
            </BotonEnviar>
          </form>
          <p className="mt-3 text-xs text-gray-500">
            El monto se calcula en el servidor y se verifica contra la respuesta de PayPal antes de confirmar el pedido.
          </p>
        </div>
      )}
    </div>
  );
}
