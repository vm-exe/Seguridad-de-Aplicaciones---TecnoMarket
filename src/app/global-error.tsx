"use client";

/**
 * Error en el layout raíz (donde error.tsx no alcanza). Genérico: no muestra trazas.
 * Debe incluir sus propias etiquetas <html> y <body>.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Ocurrió un error</h1>
          <p className="mt-2 text-gray-600">Intente nuevamente más tarde.</p>
          {error.digest && <p className="mt-2 font-mono text-xs text-gray-400">Referencia: {error.digest}</p>}
          <button onClick={reset} className="btn-primario mt-6">Reintentar</button>
        </div>
      </body>
    </html>
  );
}
