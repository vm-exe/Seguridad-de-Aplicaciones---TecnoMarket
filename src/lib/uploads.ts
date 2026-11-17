import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";

/**
 * Carga segura de imágenes (en el legado: validación solo por extensión con un
 * explode(',') defectuoso, nombre controlado por el usuario y mkdir 0777).
 * - Tamaño máximo 2 MB.
 * - Tipo detectado por "magic bytes", no por extensión ni Content-Type del cliente.
 * - Nombre aleatorio generado por el servidor; directorio fuera de /public.
 * - Se sirven por /api/imagenes/<archivo> con nombre validado por regex (sin path traversal).
 * En AWS el directorio se reemplaza por un bucket S3 privado (SSE-KMS).
 */
const MAX_BYTES = 2 * 1024 * 1024;
export const ARCHIVO_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

const TIPOS: { ext: "jpg" | "png" | "webp"; mime: string; firma: (b: Buffer) => boolean }[] = [
  { ext: "jpg", mime: "image/jpeg", firma: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: "png",
    mime: "image/png",
    firma: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: "webp",
    mime: "image/webp",
    firma: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

function dir() {
  return path.resolve(env.UPLOAD_DIR, "productos");
}

export class ErrorArchivo extends Error {}

export async function guardarImagen(archivo: File): Promise<{ archivo: string; mime: string }> {
  if (archivo.size === 0) throw new ErrorArchivo("Archivo vacío");
  if (archivo.size > MAX_BYTES) throw new ErrorArchivo("La imagen supera 2 MB");
  const buf = Buffer.from(await archivo.arrayBuffer());
  const tipo = TIPOS.find((t) => t.firma(buf));
  if (!tipo) throw new ErrorArchivo("Formato no permitido (solo JPG, PNG o WebP)");
  const nombre = `${randomUUID()}.${tipo.ext}`;
  await mkdir(dir(), { recursive: true, mode: 0o750 });
  await writeFile(path.join(dir(), nombre), buf, { mode: 0o640, flag: "wx" });
  return { archivo: nombre, mime: tipo.mime };
}

export async function leerImagen(nombre: string): Promise<{ datos: Buffer; mime: string } | null> {
  if (!ARCHIVO_VALIDO.test(nombre)) return null;
  const ruta = path.join(dir(), nombre);
  if (path.dirname(ruta) !== dir()) return null; // defensa en profundidad
  try {
    const datos = await readFile(ruta);
    const ext = nombre.split(".").pop();
    const mime = TIPOS.find((t) => t.ext === ext)!.mime;
    return { datos, mime };
  } catch {
    return null;
  }
}

export async function borrarImagen(nombre: string) {
  if (!ARCHIVO_VALIDO.test(nombre)) return;
  await unlink(path.join(dir(), nombre)).catch(() => undefined);
}
