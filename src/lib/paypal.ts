import "server-only";
import { env } from "./env";
import { logger } from "./logger";

/**
 * Cliente mínimo de PayPal Orders v2 (servidor a servidor).
 * El navegador NUNCA envía montos ni estados: el servidor crea la orden con el
 * total calculado desde la BD y luego captura y verifica la respuesta de PayPal.
 * (En el legado, clases/capture.php guardaba el monto/estado enviados por el JS del cliente.)
 */
export const PAYPAL_ORDER_ID = /^[A-Z0-9]{10,25}$/;

async function token(): Promise<string> {
  const cred = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const r = await fetch(`${env.PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${cred}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`PayPal OAuth ${r.status}`);
  const j = (await r.json()) as { access_token: string };
  return j.access_token;
}

export async function crearOrdenPaypal(p: {
  ordenId: string;
  total: string;
  moneda: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; aprobarUrl: string }> {
  const r = await fetch(`${env.PAYPAL_API_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `crear-${p.ordenId}`, // idempotencia
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        { reference_id: p.ordenId, custom_id: p.ordenId, amount: { currency_code: p.moneda, value: p.total } },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            return_url: p.returnUrl,
            cancel_url: p.cancelUrl,
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
          },
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const j = (await r.json()) as { id?: string; links?: { rel: string; href: string }[] };
  if (!r.ok || !j.id) {
    logger.error("PayPal crear orden falló", { status: r.status });
    throw new Error("No se pudo crear la orden de pago");
  }
  const aprobar = j.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (!aprobar || !/^https:\/\/www\.(sandbox\.)?paypal\.com\//.test(aprobar)) throw new Error("Enlace de aprobación inválido");
  return { id: j.id, aprobarUrl: aprobar };
}

export type CapturaVerificada = { capturaId: string; valor: string; moneda: string; customId: string };

export async function capturarOrdenPaypal(paypalId: string, ordenId: string): Promise<CapturaVerificada> {
  if (!PAYPAL_ORDER_ID.test(paypalId)) throw new Error("Identificador de PayPal inválido");
  const r = await fetch(`${env.PAYPAL_API_BASE}/v2/checkout/orders/${paypalId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `capturar-${ordenId}`,
    },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const j = (await r.json()) as {
    status?: string;
    purchase_units?: {
      payments?: {
        captures?: { id: string; status: string; custom_id?: string; amount: { currency_code: string; value: string } }[];
      };
    }[];
  };
  const cap = j.purchase_units?.[0]?.payments?.captures?.[0];
  if (!r.ok || j.status !== "COMPLETED" || !cap || cap.status !== "COMPLETED") {
    logger.warn("Captura PayPal no completada", { status: r.status, estado: j.status });
    throw new Error("El pago no fue completado");
  }
  return { capturaId: cap.id, valor: cap.amount.value, moneda: cap.amount.currency_code, customId: cap.custom_id ?? "" };
}

/**
 * Reembolso total de una captura (cuando no hay stock o el monto no coincide).
 * Idempotente por PayPal-Request-Id: reintentar no genera un segundo reembolso.
 */
export async function reembolsarCaptura(capturaId: string, ordenId: string): Promise<{ id: string; estado: string }> {
  if (!/^[A-Z0-9]{10,25}$/.test(capturaId)) throw new Error("Identificador de captura inválido");
  const r = await fetch(`${env.PAYPAL_API_BASE}/v2/payments/captures/${capturaId}/refund`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `reembolso-${ordenId}`,
    },
    body: "{}",
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const j = (await r.json()) as { id?: string; status?: string };
  if (!r.ok || !j.id) {
    logger.error("Reembolso PayPal falló", { status: r.status, ordenId });
    throw new Error("No se pudo reembolsar");
  }
  return { id: j.id, estado: j.status ?? "DESCONOCIDO" };
}

/** Consulta el estado de una orden en PayPal (conciliación de órdenes pendientes). */
export async function consultarOrdenPaypal(paypalId: string): Promise<{
  estado: string;
  captura?: CapturaVerificada & { estadoCaptura: string };
}> {
  if (!PAYPAL_ORDER_ID.test(paypalId)) throw new Error("Identificador de PayPal inválido");
  const r = await fetch(`${env.PAYPAL_API_BASE}/v2/checkout/orders/${paypalId}`, {
    headers: { Authorization: `Bearer ${await token()}` },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (r.status === 404) return { estado: "NO_ENCONTRADA" };
  if (!r.ok) throw new Error(`PayPal consulta ${r.status}`);
  const j = (await r.json()) as {
    status: string;
    purchase_units?: {
      payments?: { captures?: { id: string; status: string; custom_id?: string; amount: { currency_code: string; value: string } }[] };
    }[];
  };
  const cap = j.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    estado: j.status,
    captura: cap
      ? { capturaId: cap.id, valor: cap.amount.value, moneda: cap.amount.currency_code, customId: cap.custom_id ?? "", estadoCaptura: cap.status }
      : undefined,
  };
}
