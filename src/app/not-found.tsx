import Link from "next/link";

export default function NoEncontrado() {
  return (
    <div className="contenedor py-20 text-center">
      <h1 className="text-3xl font-bold">Página no encontrada</h1>
      <p className="mt-2 text-gray-600">El recurso solicitado no existe o no tiene acceso a él.</p>
      <Link href="/" className="btn-primario mt-6">Ir al inicio</Link>
    </div>
  );
}
