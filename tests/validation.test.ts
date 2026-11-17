import { describe, expect, it } from "vitest";
import { busquedaSchema, dpiSchema, idProductoSchema, passwordSchema, productoSchema, registroSchema } from "@/lib/validation";

describe("validación de entradas (allowlist)", () => {
  it("rechaza ids de producto con inyección SQL", () => {
    expect(idProductoSchema.safeParse("1 OR 1=1").success).toBe(false);
    expect(idProductoSchema.safeParse("603; DROP TABLE productos").success).toBe(false);
    expect(idProductoSchema.safeParse("603").success).toBe(true);
  });

  it("exige contraseñas robustas", () => {
    expect(passwordSchema.safeParse("corta").success).toBe(false);
    expect(passwordSchema.safeParse("Tr1f0rc3&").success).toBe(false);
    expect(passwordSchema.safeParse("soloLetrasLargasSinNumeros").success).toBe(false);
    expect(passwordSchema.safeParse("una frase larga 2026 segura").success).toBe(true);
  });

  it("normaliza y valida el DPI (13 dígitos)", () => {
    expect(dpiSchema.parse("2345 67890 1234")).toBe("2345678901234");
    expect(dpiSchema.safeParse("12345").success).toBe(false);
    expect(dpiSchema.safeParse("abcdefghijklm").success).toBe(false);
  });

  it("rechaza nombres con etiquetas HTML en el registro", () => {
    const r = registroSchema.safeParse({
      nombres: "<script>alert(1)</script>",
      apellidos: "Pérez",
      email: "a@b.com",
      telefono: "55551234",
      dpi: "1234567890123",
      password: "una frase larga 2026 segura",
      repassword: "una frase larga 2026 segura",
    });
    expect(r.success).toBe(false);
  });

  it("limita descuentos y precios del panel admin", () => {
    const base = { id: 1, nombre: "Silla", descripcion: "d", detalles: "d", precio: "10.50", stock: 1, categoriaId: 1, activo: "on" };
    expect(productoSchema.safeParse({ ...base, descuento: 95 }).success).toBe(false);
    expect(productoSchema.safeParse({ ...base, descuento: 10, precio: "-5" }).success).toBe(false);
    expect(productoSchema.safeParse({ ...base, descuento: 10 }).success).toBe(true);
  });

  it("acota la paginación (evita extracción masiva)", () => {
    expect(busquedaSchema.parse({ pagina: "999999" }).pagina).toBe(1);
    expect(busquedaSchema.parse({ q: "x".repeat(500) }).q).toBeUndefined();
  });
});

describe("precio con máximo 2 decimales", () => {
  const base = { id: 1, nombre: "Silla", descripcion: "d", detalles: "d", descuento: 0, stock: 1, categoriaId: 1, activo: "on" };
  it("acepta 2 decimales y rechaza 3", async () => {
    const { productoSchema } = await import("@/lib/validation");
    expect(productoSchema.safeParse({ ...base, precio: "10.55" }).success).toBe(true);
    expect(productoSchema.safeParse({ ...base, precio: "0.29" }).success).toBe(true);
    expect(productoSchema.safeParse({ ...base, precio: "10.555" }).success).toBe(false);
  });
});
