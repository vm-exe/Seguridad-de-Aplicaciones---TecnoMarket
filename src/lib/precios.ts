/**
 * Cálculo monetario en centavos enteros (evita errores de punto flotante).
 * Única fuente de verdad del precio: la base de datos. Nunca el navegador.
 */
export function aCentavos(decimal: string | number): number {
  const [ent, dec = ""] = String(decimal).split(".");
  const signo = ent.startsWith("-") ? -1 : 1;
  return signo * (Math.abs(parseInt(ent, 10)) * 100 + parseInt((dec + "00").slice(0, 2), 10));
}

export function precioConDescuento(precio: string | number, descuento: number): number {
  const c = aCentavos(precio);
  return c - Math.round((c * descuento) / 100);
}

export function centavosADecimal(c: number): string {
  const s = c < 0 ? "-" : "";
  const a = Math.abs(c);
  return `${s}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

export function formatoMoneda(c: number, simbolo = "$"): string {
  const [ent, dec] = centavosADecimal(c).split(".");
  return `${simbolo}${ent.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${dec}`;
}
