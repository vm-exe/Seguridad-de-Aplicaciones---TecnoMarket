import { describe, expect, it } from "vitest";
import { compararSeguro, descifrarCampo, hmac } from "@/lib/crypto";
import { aCentavos, centavosADecimal } from "@/lib/precios";
import { cantidadSchema, formAObjeto } from "@/lib/validation";

describe("utilidades de seguridad", () => {
  it("compararSeguro compara en tiempo constante y maneja longitudes distintas", () => {
    const f = hmac("dato");
    expect(compararSeguro(f, hmac("dato"))).toBe(true);
    expect(compararSeguro(f, hmac("otro"))).toBe(false);
    expect(compararSeguro(f, "corta")).toBe(false);
  });

  it("descifrarCampo rechaza formatos desconocidos", () => {
    expect(() => descifrarCampo("texto-plano")).toThrow();
    expect(() => descifrarCampo("v2:a:b:c")).toThrow();
  });

  it("formAObjeto ignora archivos y campos internos de Server Actions", () => {
    const fd = new FormData();
    fd.set("nombre", "Silla");
    fd.set("$ACTION_ID_abc", "x");
    fd.set("imagen", new Blob(["x"]), "a.jpg");
    expect(formAObjeto(fd)).toEqual({ nombre: "Silla" });
  });

  it("cantidad del carrito acotada a 1..10", () => {
    expect(cantidadSchema.safeParse("0").success).toBe(false);
    expect(cantidadSchema.safeParse("11").success).toBe(false);
    expect(cantidadSchema.safeParse("3").success).toBe(true);
  });

  it("montos negativos en centavos", () => {
    expect(aCentavos("-1.50")).toBe(-150);
    expect(centavosADecimal(-150)).toBe("-1.50");
  });
});
