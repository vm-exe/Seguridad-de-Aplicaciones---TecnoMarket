export function Pie() {
  return (
    <footer className="mt-16 border-t border-gray-200 bg-crema py-8 text-sm text-gray-600">
      <div className="contenedor flex flex-col justify-between gap-2 md:flex-row">
        <p>© {new Date().getFullYear()} Furniture Investment — Proyecto Seguridad en Aplicaciones (UMG).</p>
        <p>
          Diseño inspirado en la plantilla Furni de{" "}
          <a className="underline" href="https://untree.co" rel="noopener noreferrer">Untree.co</a> (CC BY 3.0).
        </p>
      </div>
    </footer>
  );
}
