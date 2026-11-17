import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { confirmarPago, ErrorNegocio } from "@/lib/ordenes";
import { PAYPAL_ORDER_ID } from "@/lib/paypal";
import { ipDesdeHeaders } from "@/lib/request-context";

/**
 * Retorno desde PayPal (?token=<ID de orden PayPal>&PayerID=...).
 * El servidor captura y verifica el pago; el navegador no aporta montos ni estados.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ir = (ruta: string) => Response.redirect(new URL(ruta, env.APP_URL), 303);
  const token = url.searchParams.get("token") ?? "";
  if (!PAYPAL_ORDER_ID.test(token)) return ir("/checkout?error=orden");

  const s = await auth.api.getSession({ headers: req.headers });
  if (!s) return ir(`/login?next=${encodeURIComponent(`/checkout/retorno?token=${token}`)}`);

  try {
    const id = await confirmarPago(
      { paypalId: token },
      { id: s.user.id, email: s.user.email },
      { ip: ipDesdeHeaders(req.headers), userAgent: (req.headers.get("user-agent") ?? "").slice(0, 255) },
    );
    return ir(`/pedido/${id}?ok=1`);
  } catch (e) {
    if (!(e instanceof ErrorNegocio)) logger.error("Error confirmando pago PayPal", { error: String(e) });
    return ir("/checkout?error=pago");
  }
}
