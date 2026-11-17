import { defineConfig, devices } from "@playwright/test";

/**
 * Pruebas E2E de los controles de seguridad (ver docs/GUIA_EQUIPO.md).
 * Requiere la app corriendo (npm run dev) y, para los flujos con correo,
 * MAIL_CAPTURE_DIR en la app = E2E_MAILBOX_DIR aquí.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1, // comparten BD y limitadores: secuencial para resultados deterministas
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // Localmente puede usar el Chrome instalado (E2E_CHANNEL=chrome) sin descargar navegadores.
      use: { ...devices["Desktop Chrome"], channel: process.env.E2E_CHANNEL || undefined },
    },
  ],
});
