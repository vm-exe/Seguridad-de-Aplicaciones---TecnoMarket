import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { cancelarOrdenPendiente } from "@/lib/ordenes";
import { PAYPAL_ORDER_ID } from "@/lib/paypal";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const s = await auth.api.getSession({ headers: req.headers });
  if (s && PAYPAL_ORDER_ID.test(token)) await cancelarOrdenPendiente(token, s.user.id);
  return Response.redirect(new URL("/checkout?error=cancelado", env.APP_URL), 303);
}
