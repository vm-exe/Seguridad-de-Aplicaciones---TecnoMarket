import { expect, test, type Page } from "@playwright/test";
import { BUZON, clienteVerificado } from "./utilidades";

async function productoDisponible(page: Page) {
  await page.goto("/tienda");
  const tarjetas = page.locator('a[href^="/producto/"]');
  const n = await tarjetas.count();
  for (let i = 0; i < n; i++) {
    const t = tarjetas.nth(i);
    if (!(await t.getByText("Agotado").isVisible())) return (await t.getAttribute("href"))!;
  }
  throw new Error("No hay productos con stock");
}

async function stockDe(page: Page, href: string) {
  await page.goto(href);
  return Number(await page.locator("text=Disponibles:").locator("b").textContent());
}

// RS: lógica de negocio de pagos, IDOR (A01), integridad del carrito
test.describe("Compra y control de acceso a pedidos", () => {
  test.skip(!BUZON, "Requiere E2E_MAILBOX_DIR para crear un cliente verificado");

  test("el stock se descuenta UNA vez aunque el pago se apruebe dos veces en paralelo", async ({ page, context }) => {
    await clienteVerificado(page);
    const href = await productoDisponible(page);
    const antes = await stockDe(page, href);
    await page.getByLabel("Cantidad").fill("1");
    await page.getByRole("button", { name: "Agregar al carrito" }).click();
    await page.getByRole("link", { name: "Proceder al pago" }).click();
    await page.getByRole("button", { name: /Pagar/ }).click();
    await page.waitForURL(/\/checkout\/simulado/);

    // Condición de carrera: dos pestañas aprueban la MISMA orden a la vez.
    const otra = await context.newPage();
    await otra.goto(page.url());
    await Promise.all([
      page.getByRole("button", { name: "Aprobar pago" }).click(),
      otra.getByRole("button", { name: "Aprobar pago" }).click(),
    ]);
    await page.waitForURL(/\/pedido\//);
    await expect(page.getByText("Pagada")).toBeVisible();
    expect(await stockDe(page, href)).toBe(antes - 1);
  });

  test("IDOR: un pedido ajeno o inexistente responde 404", async ({ page }) => {
    await clienteVerificado(page);
    const r = await page.goto("/pedido/11111111-2222-4333-8444-555555555555");
    expect(r?.status()).toBe(404);
  });

  test("una cookie de carrito alterada se descarta (firma HMAC)", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "vos.carrito", value: "eyI2MDMiOjF9.firma-falsa", url: baseURL! }]);
    await page.goto("/carrito");
    await expect(page.getByText("Su carrito está vacío")).toBeVisible();
  });

  test("un cliente no puede entrar al panel de administración", async ({ page }) => {
    await clienteVerificado(page);
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin/);
  });
});
