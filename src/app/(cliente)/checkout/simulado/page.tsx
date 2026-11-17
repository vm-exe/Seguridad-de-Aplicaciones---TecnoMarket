import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { BotonEnviar } from "@/components/formulario";
import { db } from "@/db";
import { ordenes } from "@/db/schema";
import { leerConfig } from "@/lib/config-tienda";
import { env } from "@/lib/env";
import { aCentavos, formatoMoneda } from "@/lib/precios";
import { requerirUsuario } from "@/lib/session";
import { uuidSchema } from "@/lib/validation";
import { confirmarPagoSimulado } from "../../acciones-pago";

/** Pasarela simulada SOLO para laboratorio / DAST (deshabilitada en producción por env.ts). */
export default async function PagoSimuladoPage({ searchParams }: { searchParams: Promise<{ orden?: string }> }) {
  if (env.PAYMENT_MODE !== "simulado") redirect("/checkout");
  const s = await requerirUsuario("/checkout");
  const id = uuidSchema.safeParse((await searchParams).orden);
  if (!id.success) notFound();
  const [o] = await db
    .select()
    .from(ordenes)
    .where(and(eq(ordenes.id, id.data), eq(ordenes.userId, s.user.id)))
    .limit(1);
  if (!o) notFound();
  if (o.estado !== "pendiente") redirect(`/pedido/${o.id}`);
  const cfg = await leerConfig();

  return (
    <div className="contenedor max-w-md py-12">
      <div className="tarjeta">
        <h1 className="mb-2 text-2xl font-bold">Pasarela simulada</h1>
        <p className="mb-6 text-sm text-gray-600">Entorno de laboratorio. No se realiza ningún cargo real.</p>
        <p className="mb-6 text-lg">
          Total a pagar: <b>{formatoMoneda(aCentavos(o.total), cfg.moneda_simbolo)}</b>
        </p>
        <form action={confirmarPagoSimulado}>
          <input type="hidden" name="orden" value={o.id} />
          <BotonEnviar className="btn-marca w-full">Aprobar pago</BotonEnviar>
        </form>
      </div>
    </div>
  );
}
