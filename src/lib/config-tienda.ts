import "server-only";
import { db } from "@/db";
import { configuracion } from "@/db/schema";

export type ConfigTienda = {
  tienda_nombre: string;
  tienda_telefono: string;
  moneda_simbolo: string;
  moneda_codigo: "USD" | "GTQ";
};

const DEFECTO: ConfigTienda = {
  tienda_nombre: "Furniture Investment",
  tienda_telefono: "+502 0000-0000",
  moneda_simbolo: "$",
  moneda_codigo: "USD",
};

export async function leerConfig(): Promise<ConfigTienda> {
  const filas = await db.select().from(configuracion);
  const out = { ...DEFECTO } as Record<string, string>;
  for (const f of filas) if (f.clave in DEFECTO) out[f.clave] = f.valor;
  return out as ConfigTienda;
}
