import type { NextConfig } from "next";

/**
 * Cabeceras de seguridad para TODAS las rutas (incluye /api).
 * La CSP con nonce se agrega en src/proxy.ts porque requiere un valor por solicitud.
 */
const seguridad = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false, // no revelar "X-Powered-By: Next.js"
  productionBrowserSourceMaps: false,
  agentRules: false, // `next dev` no genera AGENTS.md en el repositorio
  // Se cargan con require() (sin empaquetar) para que OpenTelemetry pueda instrumentar mysql2.
  serverExternalPackages: ["mysql2", "@opentelemetry/instrumentation-mysql2"],
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb", // carga de imágenes (2 MB c/u) en el panel admin
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: seguridad },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
