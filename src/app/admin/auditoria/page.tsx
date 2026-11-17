import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditoria } from "@/db/schema";
import { verificarCadena } from "@/lib/audit";

export const metadata: Metadata = { title: "Auditoría" };

export default async function AdminAuditoria() {
  const [eventos, cadena] = await Promise.all([
    db.select().from(auditoria).orderBy(desc(auditoria.id)).limit(200),
    verificarCadena(),
  ]);
  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">Bitácora de auditoría</h1>
      <p
        role="status"
        className={`mb-6 rounded-lg px-4 py-3 text-sm ${cadena.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
      >
        {cadena.ok
          ? `Integridad verificada: ${cadena.total} eventos encadenados con HMAC-SHA256 sin alteraciones.`
          : `¡ALERTA! La cadena está rota en el evento #${cadena.rotoEn}. Posible manipulación de la bitácora.`}
      </p>
      <div className="overflow-x-auto">
        <table className="tabla text-xs">
          <thead>
            <tr><th>#</th><th>Fecha (UTC)</th><th>Acción</th><th>Resultado</th><th>Actor</th><th>Objetivo</th><th>IP</th><th>Hash</th></tr>
          </thead>
          <tbody>
            {eventos.map((e) => (
              <tr key={e.id}>
                <td>{e.id}</td>
                <td className="whitespace-nowrap">{e.ts.toISOString().replace("T", " ").slice(0, 19)}</td>
                <td className="font-mono">{e.accion}</td>
                <td className={e.resultado === "ok" ? "text-green-700" : "font-semibold text-red-700"}>{e.resultado}</td>
                <td>{e.actorEmail ?? e.actorId?.slice(0, 8) ?? "—"}</td>
                <td className="font-mono">{e.objetivo ?? "—"}</td>
                <td>{e.ip ?? "—"}</td>
                <td className="font-mono text-gray-400" title={e.hash}>{e.hash.slice(0, 10)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
