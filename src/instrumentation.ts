import type { InstrumentationOptionOrName } from "@vercel/otel";

/**
 * Trazas distribuidas con OpenTelemetry (laboratorio de monitoreo, ver docs/LABORATORIOS.md).
 *
 * Solo se activa si OTEL_EXPORTER_OTLP_ENDPOINT está definido (docker-compose lo apunta al
 * OTel Collector). Sin esa variable, en desarrollo y en las pruebas, no se carga nada.
 *
 * Recorrido de una solicitud: ventas-waf (nginx + ModSecurity) → ventas-app (Next.js) → MySQL.
 * El WAF inyecta la cabecera W3C `traceparent` y la app continúa esa misma traza; mysql2 agrega un
 * span por consulta (sentencia parametrizada, nunca los valores). El Collector elimina las query
 * strings antes de guardar nada (tokens de verificación o recuperación de contraseña).
 */
export async function register() {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;

  const { registerOTel } = await import("@vercel/otel");
  const instrumentations: InstrumentationOptionOrName[] = ["auto"];

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { MySQL2Instrumentation } = await import("@opentelemetry/instrumentation-mysql2");
    instrumentations.push(new MySQL2Instrumentation());
  }

  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "ventas-app",
    instrumentations,
  });
}
