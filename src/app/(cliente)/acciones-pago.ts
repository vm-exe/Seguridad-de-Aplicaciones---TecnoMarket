"use server";

import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { confirmarPago, ErrorNegocio, iniciarPago } from "@/lib/ordenes";
import { permitir } from "@/lib/rate-limit";
import { contextoSolicitud } from "@/lib/request-context";
import { requerirUsuario } from "@/lib/session";
import { uuidSchema } from "@/lib/validation";

export async function iniciarCheckout() {
  const s = await requerirUsuario("/checkout");
  const ctx = await contextoSolicitud();
  if (!(await permitir(`checkout:${s.user.id}`, 10, 600))) redirect("/checkout?error=limite");
  let destino: string;
  try {
    destino = await iniciarPago({ id: s.user.id, email: s.user.email }, ctx);
  } catch (e) {
    if (!(e instanceof ErrorNegocio)) logger.error("Error iniciando pago", { error: String(e) });
    redirect("/checkout?error=inicio");
  }
  redirect(destino);
}

export async function confirmarPagoSimulado(fd: FormData) {
  if (env.PAYMENT_MODE !== "simulado") redirect("/checkout");
  const s = await requerirUsuario("/checkout");
  const orden = uuidSchema.safeParse(fd.get("orden"));
  if (!orden.success) redirect("/checkout?error=orden");
  let id: string;
  try {
    id = await confirmarPago({ ordenId: orden.data }, { id: s.user.id, email: s.user.email }, await contextoSolicitud());
  } catch (e) {
    if (!(e instanceof ErrorNegocio)) logger.error("Error confirmando pago simulado", { error: String(e) });
    const msg = e instanceof ErrorNegocio ? "pago" : "inicio";
    redirect(`/checkout?error=${msg}`);
  }
  redirect(`/pedido/${id}?ok=1`);
}
