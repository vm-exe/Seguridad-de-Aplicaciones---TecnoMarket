"use client";

/** Página de error genérica: nunca muestra trazas ni mensajes internos (el legado imprimía PDOException). */
export default function ErrorGlobal({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="contenedor py-20 text-center">
      <h1 className="text-3xl font-bold">Ocurrió un error</h1>
      <p className="mt-2 text-gray-600">Intente nuevamente. Si el problema persiste, contacte a soporte.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-gray-400">Referencia: {error.digest}</p>}
      <button onClick={reset} className="btn-primario mt-6">Reintentar</button>
    </div>
  );
}
