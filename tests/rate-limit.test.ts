import { describe, expect, it } from "vitest";
import { permitirIp } from "@/lib/rate-limit";

describe("permitirIp", () => {
  it("no aplica límite por IP si la IP no es confiable (evita DoS con contador compartido)", async () => {
    // No toca la base de datos: retorna antes de consultar.
    await expect(permitirIp("login", "desconocida", 1, 60)).resolves.toBe(true);
    await expect(permitirIp("login", "", 1, 60)).resolves.toBe(true);
  });
});
