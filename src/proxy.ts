import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy (antes "middleware") de Next.js 16:
 * 1. Content-Security-Policy estricta con nonce por solicitud (mitiga XSS).
 * 2. Redirección temprana ("optimista") de rutas privadas sin cookie de sesión.
 *    La autorización REAL se valida en el servidor (src/lib/session.ts); esto solo
 *    reduce superficie y carga.
 */
const PRIVADAS = ["/admin", "/cuenta", "/checkout", "/pedido"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PRIVADAS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const cookie = getSessionCookie(request, { cookiePrefix: "vos" });
    if (!cookie) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(url);
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self'${dev ? " 'unsafe-inline'" : ` 'nonce-${nonce}'`}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://www.paypal.com https://www.sandbox.paypal.com",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  const reqHeaders = new Headers(request.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
