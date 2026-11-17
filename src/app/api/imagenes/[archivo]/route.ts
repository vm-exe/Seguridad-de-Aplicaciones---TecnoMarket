import { leerImagen } from "@/lib/uploads";

export async function GET(_req: Request, { params }: { params: Promise<{ archivo: string }> }) {
  const { archivo } = await params;
  const img = await leerImagen(archivo);
  if (!img) return new Response("No encontrado", { status: 404 });
  return new Response(new Uint8Array(img.datos), {
    headers: {
      "Content-Type": img.mime,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
