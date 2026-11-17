import { describe, expect, it } from "vitest";
import { cifrarCampo, descifrarCampo, enmascararDpi, hmacIndice } from "@/lib/crypto";

describe("cifrado de PII (AES-256-GCM)", () => {
  it("cifra y descifra; cada cifrado usa un IV distinto", () => {
    const a = cifrarCampo("2345678901234");
    const b = cifrarCampo("2345678901234");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(descifrarCampo(a)).toBe("2345678901234");
  });

  it("detecta manipulación del texto cifrado (cifrado autenticado)", () => {
    const [v, iv, tag, ct] = cifrarCampo("2345678901234").split(":");
    const bytes = Buffer.from(ct, "base64");
    bytes[0] ^= 0xff;
    expect(() => descifrarCampo([v, iv, tag, bytes.toString("base64")].join(":"))).toThrow();
  });

  it("rechaza etiquetas GCM truncadas (hallazgo SAST gcm-no-tag-length)", () => {
    const [v, iv, tag, ct] = cifrarCampo("2345678901234").split(":");
    const corta = Buffer.from(tag, "base64").subarray(0, 4).toString("base64");
    expect(() => descifrarCampo([v, iv, corta, ct].join(":"))).toThrow();
  });

  it("índice HMAC determinista para búsquedas sin descifrar", () => {
    expect(hmacIndice("dpi:1")).toBe(hmacIndice("dpi:1"));
    expect(hmacIndice("dpi:1")).not.toBe(hmacIndice("dpi:2"));
  });

  it("enmascara el DPI para mostrarlo", () => {
    expect(enmascararDpi("2345678901234")).toMatch(/1234$/);
    expect(enmascararDpi("2345678901234")).not.toContain("23456789");
  });
});
