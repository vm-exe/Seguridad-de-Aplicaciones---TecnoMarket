export function MarcoAuth({ titulo, children, ancho = "max-w-md" }: { titulo: string; children: React.ReactNode; ancho?: string }) {
  return (
    <div className="contenedor py-12">
      <div className={`tarjeta mx-auto ${ancho}`}>
        <h1 className="mb-6 text-2xl font-bold">{titulo}</h1>
        {children}
      </div>
    </div>
  );
}
