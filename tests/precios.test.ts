import { describe, expect, it } from "vitest";
import { aCentavos, centavosADecimal, formatoMoneda, precioConDescuento } from "@/lib/precios";

describe("cálculo monetario en centavos", () => {
  it("convierte decimales sin errores de punto flotante", () => {
    expect(aCentavos("176.00")).toBe(17600);
    expect(aCentavos("0.1")).toBe(10);
    expect(aCentavos("99.99")).toBe(9999);
    expect(aCentavos(110)).toBe(11000);
  });

  it("aplica descuentos redondeando al centavo", () => {
    expect(precioConDescuento("99.00", 17)).toBe(8217); // 99 - 16.83
    expect(precioConDescuento("176.00", 0)).toBe(17600);
  });

  it("formatea de vuelta a decimal y moneda", () => {
    expect(centavosADecimal(8217)).toBe("82.17");
    expect(centavosADecimal(5)).toBe("0.05");
    expect(formatoMoneda(123456789, "Q")).toBe("Q1,234,567.89");
  });
});
