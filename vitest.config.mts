import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // "server-only" lanza fuera de React Server Components; en pruebas se reemplaza por un módulo vacío.
      "server-only": path.resolve(__dirname, "tests/server-only-vacio.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "reportes/cobertura",
      // Módulos de seguridad puros: deben mantenerse bien cubiertos.
      include: ["src/lib/precios.ts", "src/lib/validation.ts", "src/lib/crypto.ts", "src/lib/rutas.ts"],
      thresholds: { lines: 90, functions: 90, branches: 70, statements: 90 },
    },
  },
});
