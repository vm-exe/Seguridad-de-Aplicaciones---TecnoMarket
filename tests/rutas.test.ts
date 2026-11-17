import { describe, expect, it } from "vitest";
import { rutaSegura } from "@/lib/rutas";

describe("rutaSegura (anti open-redirect, CWE-601)", () => {
  it("acepta rutas internas", () => {
    expect(rutaSegura("/admin")).toBe("/admin");
    expect(rutaSegura("/pedido/abc?ok=1")).toBe("/pedido/abc?ok=1");
  });

  it("rechaza destinos externos y protocol-relative", () => {
    expect(rutaSegura("https://evil.example")).toBe("/");
    expect(rutaSegura("//evil.example")).toBe("/");
    expect(rutaSegura("/\\evil.example")).toBe("/");
    expect(rutaSegura("javascript:alert(1)")).toBe("/");
  });

  it("rechaza caracteres de control (inyección de cabeceras)", () => {
    expect(rutaSegura("/ok\r\nSet-Cookie: x=1")).toBe("/");
  });

  it("usa el valor por defecto cuando no hay destino", () => {
    expect(rutaSegura(undefined, "/cuenta")).toBe("/cuenta");
    expect(rutaSegura(null)).toBe("/");
  });
});
