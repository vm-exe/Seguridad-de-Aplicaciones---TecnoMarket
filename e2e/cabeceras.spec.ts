import { expect, test } from "@playwright/test";

// RS: cabeceras de seguridad y CSP (A02 Security Misconfiguration, A05 Injection/XSS)
test.describe("Cabeceras de seguridad", () => {
  test("CSP con nonce único por solicitud y cabeceras de endurecimiento", async ({ request }) => {
    const a = await request.get("/tienda");
    const b = await request.get("/tienda");
    const csp = a.headers()["content-security-policy"];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toBe(b.headers()["content-security-policy"]); // nonce distinto en cada respuesta
    expect(a.headers()["x-content-type-options"]).toBe("nosniff");
    expect(a.headers()["x-frame-options"]).toBe("DENY");
    expect(a.headers()["strict-transport-security"]).toContain("max-age=");
    expect(a.headers()["x-powered-by"]).toBeUndefined();
  });

  test("las páginas públicas cargan sin violaciones de CSP", async ({ page }) => {
    const violaciones: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy|Refused to/.test(m.text())) violaciones.push(m.text());
    });
    for (const ruta of ["/", "/tienda", "/carrito", "/login", "/registro"]) await page.goto(ruta);
    expect(violaciones).toEqual([]);
  });

  test("health: liveness sin BD y readiness con BD, sin filtrar detalles", async ({ request }) => {
    expect(await (await request.get("/api/health")).json()).toEqual({ status: "ok" });
    const r = await request.get("/api/health?db=1");
    expect(r.status()).toBe(200);
    expect(JSON.stringify(await r.json())).not.toMatch(/mysql|version|host/i);
  });

  test("rutas privadas redirigen a login sin sesión", async ({ page }) => {
    for (const ruta of ["/admin", "/cuenta", "/checkout"]) {
      await page.goto(ruta);
      await expect(page).toHaveURL(/\/login\?next=/);
    }
  });

  test("las imágenes no permiten path traversal", async ({ request }) => {
    expect((await request.get("/api/imagenes/..%2F..%2F.env.local")).status()).toBe(404);
    expect((await request.get("/api/imagenes/no-existe.jpg")).status()).toBe(404);
  });
});
