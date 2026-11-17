import { expect, test } from "@playwright/test";
import { BUZON, PASS, enlaceDeCorreo, iniciarSesion, sufijo } from "./utilidades";

// RS: autenticación (A07), enumeración de cuentas, fuerza bruta, open redirect
test.describe("Autenticación", () => {
  test("el registro rechaza contraseñas débiles", async ({ page }) => {
    await page.goto("/registro");
    await page.getByLabel(/^Contraseña/).fill("corta");
    await page.getByLabel("Confirmar contraseña").fill("corta");
    await page.getByRole("button", { name: "Registrarme" }).click();
    await expect(page.getByText(/al menos 12 caracteres/)).toBeVisible();
  });

  test("registro → sin verificar no entra → verifica correo → entra", async ({ page }) => {
    test.skip(!BUZON, "Requiere E2E_MAILBOX_DIR (buzón de pruebas)");
    const s = sufijo();
    const email = `nuevo${s}@e2e.test`;
    await page.goto("/registro");
    await page.getByLabel("Nombres").fill("Luis");
    await page.getByLabel("Apellidos").fill("García");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Teléfono").fill("+502 4444-1234");
    await page.getByLabel(/DPI/).fill(`31${s}0202`.slice(0, 13).padEnd(13, "5"));
    await page.getByLabel(/^Contraseña/).fill(PASS);
    await page.getByLabel("Confirmar contraseña").fill(PASS);
    await page.getByRole("button", { name: "Registrarme" }).click();
    // Mensaje genérico: no revela si el correo ya existía.
    await expect(page.getByText("Si los datos son válidos")).toBeVisible();

    await iniciarSesion(page, email, PASS);
    await expect(page.getByText("Credenciales inválidas o cuenta no activada")).toBeVisible();

    await page.goto(await enlaceDeCorreo(email, /Active su cuenta/));
    if (!(await page.getByRole("button", { name: "Salir" }).isVisible())) await iniciarSesion(page, email, PASS);
    await expect(page.getByRole("button", { name: "Salir" })).toBeVisible();
  });

  test("mensaje idéntico para correo inexistente (anti-enumeración)", async ({ page }) => {
    await iniciarSesion(page, `noexiste${sufijo()}@e2e.test`, "una-clave-cualquiera-1");
    await expect(page.getByText("Credenciales inválidas o cuenta no activada")).toBeVisible();
  });

  test("bloqueo por fuerza bruta tras 5 intentos sobre la misma cuenta", async ({ page }) => {
    const email = `victima${sufijo()}@e2e.test`;
    let bloqueado = 0;
    for (let i = 1; i <= 7 && !bloqueado; i++) {
      await iniciarSesion(page, email, `incorrecta-${i}-xxxxxx`);
      await expect(page.getByText(/Credenciales inválidas|Demasiados intentos/)).toBeVisible();
      if (await page.getByText("Demasiados intentos").isVisible()) bloqueado = i;
    }
    expect(bloqueado).toBeGreaterThan(0);
    expect(bloqueado).toBeLessThanOrEqual(6);
  });

  test("open redirect: un ?next externo se ignora", async ({ page }) => {
    await page.goto("/login?next=https://evil.example");
    await expect(page.locator('input[name="next"]')).toHaveValue("/");
  });
});
