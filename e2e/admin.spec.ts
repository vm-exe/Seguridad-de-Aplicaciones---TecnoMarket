import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ADMIN_FILE, iniciarSesion, sufijo, totp } from "./utilidades";

// RS: autorización y MFA del administrador (A01/A07), XSS almacenado (A05), SQLi, no repudio (bitácora)
test.describe.serial("Administración", () => {
  test.skip(process.env.E2E_SKIP_ADMIN === "1" || !existsSync(ADMIN_FILE), "Requiere E2E_CREAR_ADMIN=1");
  const admin = existsSync(ADMIN_FILE) ? (JSON.parse(readFileSync(ADMIN_FILE, "utf8")) as { email: string; password: string }) : null;
  let secreto = "";

  test("el admin sin 2FA es obligado a activarlo y luego entra al panel", async ({ page }) => {
    await iniciarSesion(page, admin!.email, admin!.password, "/admin");
    await expect(page).toHaveURL(/requiere2fa=1/);
    await page.getByLabel("Confirme su contraseña").fill(admin!.password);
    await page.getByRole("button", { name: "Activar verificación en dos pasos" }).click();
    secreto = (await page.getByTestId("clave-totp").textContent())!;
    await page.getByLabel(/Ingrese el código/).fill(totp(secreto));
    await page.getByRole("button", { name: "Confirmar y activar" }).click();
    await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
  });

  test("XSS almacenado y SQLi neutralizados; bitácora íntegra", async ({ page }) => {
    // Esperar al siguiente intervalo TOTP: los códigos no se pueden reutilizar (anti-replay).
    await page.waitForTimeout(31_000);
    await iniciarSesion(page, admin!.email, admin!.password, "/admin");
    await page.getByLabel(/Código de su app/).fill(totp(secreto));
    await page.getByRole("button", { name: "Verificar" }).click();
    await page.waitForURL(/\/admin$/);

    const id = sufijo();
    await page.goto("/admin/productos/nuevo");
    await page.getByLabel("Código (numérico)").fill(id);
    await page.getByLabel("Nombre", { exact: true }).fill(`<img src=x onerror=alert(1)>Silla ${id}`);
    await page.getByLabel("Descripción").fill("<script>alert(1)</script>");
    await page.getByLabel("Detalles").fill("Detalles");
    await page.getByLabel("Precio").fill("150.50");
    await page.getByLabel("Descuento (%)").fill("10");
    await page.getByLabel("Stock").fill("3");
    await page.getByLabel("Categoría").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Guardar" }).click();
    await page.waitForURL(new RegExp(`/admin/productos/${id}`));

    let dialogo = false;
    page.on("dialog", async (d) => {
      dialogo = true;
      await d.dismiss();
    });
    await page.goto(`/producto/${id}`);
    await expect(page.locator("h1")).toContainText("<img src=x");
    expect(dialogo).toBe(false);

    const r = await page.goto(`/tienda?q=${encodeURIComponent("' OR 1=1 -- ")}`);
    expect(r?.status()).toBe(200);
    await expect(page.getByText("No se encontraron productos")).toBeVisible();

    await page.goto("/admin/auditoria");
    await expect(page.getByText("Integridad verificada")).toBeVisible();
  });

  test("un código TOTP incorrecto es rechazado", async ({ page }) => {
    await iniciarSesion(page, admin!.email, admin!.password, "/admin");
    await page.getByLabel(/Código de su app/).fill("000000");
    await page.getByRole("button", { name: "Verificar" }).click();
    await expect(page.getByText("Código incorrecto")).toBeVisible();
  });
});
