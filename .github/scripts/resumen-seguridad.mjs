// Resumen de seguridad del pipeline (job "resumen" de .github/workflows/devsecops.yml).
// Lee el resultado y las cifras de cada job (NEEDS = toJSON(needs), pasado por variable de
// entorno y nunca interpolado en el script: evita inyección en el workflow) y escribe una
// tabla en $GITHUB_STEP_SUMMARY, visible en la página del run sin abrir ningún log.
import { appendFileSync } from "node:fs";

const needs = JSON.parse(process.env.NEEDS ?? "{}");
const env = process.env;
const urlRun = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
const urlSecurity = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/security/code-scanning`;

const ESTADOS = {
  success: "✅ Aprobado",
  failure: "❌ Falló",
  cancelled: "⛔ Cancelado",
  skipped: "⏭️ No ejecutado",
};

/** Valor de un output; "s/d" (sin datos) si el job no llegó a publicarlo. */
function v(job, clave) {
  const valor = needs[job]?.outputs?.[clave];
  return valor === undefined || valor === "" || valor === "?" ? "s/d" : String(valor);
}
const celda = (t) => String(t).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const ok = (resultado) => (resultado === "success" ? "✓" : resultado === "skipped" ? "–" : "✗");

const controles = [
  {
    job: "build-test",
    fase: "3",
    control: "Calidad y pruebas unitarias",
    herramienta: "ESLint · TypeScript · Vitest · Next.js build",
    resultado: () =>
      `${v("build-test", "pruebas_ok")}/${v("build-test", "pruebas_total")} pruebas · lint ${ok(v("build-test", "lint"))} · tipos ${ok(v("build-test", "typecheck"))} · build ${ok(v("build-test", "build"))}`,
    criterio: "Cualquier error de lint, de tipos, de compilación o una prueba fallida",
  },
  {
    job: "sast",
    fase: "3",
    control: "Análisis estático (SAST)",
    herramienta: "Semgrep",
    resultado: () => {
      const n = v("sast", "hallazgos");
      const det = v("sast", "detalle");
      return `${n} hallazgos · ${v("sast", "reglas")} reglas (OWASP Top 10, secretos y 8 propias)${n !== "0" && det !== "s/d" ? ` · ${det}` : ""}`;
    },
    criterio: "Cualquier hallazgo de severidad ERROR",
  },
  {
    job: "secrets",
    fase: "3",
    control: "Detección de secretos",
    herramienta: "Gitleaks",
    resultado: () => `${v("secrets", "hallazgos")} secretos en ${v("secrets", "commits")} commits del historial · ${v("secrets", "reglas")} excepciones justificadas`,
    criterio: "Cualquier secreto en el historial de git",
  },
  {
    job: "sca",
    fase: "3",
    control: "Dependencias de terceros (SCA)",
    herramienta: "npm audit · OSV-Scanner · CycloneDX",
    resultado: () =>
      `${v("sca", "audit_total")} vulnerabilidades en ${v("sca", "dependencias")} dependencias de producción · OSV: ${v("sca", "osv")} no aceptadas · ${v("sca", "aceptadas")} riesgo aceptado (vence ${v("sca", "vence")}) · lockfile ${ok(v("sca", "lockfile"))} · SBOM: ${v("sca", "sbom")} componentes`,
    criterio: "Vulnerabilidad HIGH/CRITICAL (npm audit), cualquiera no aceptada (OSV) o lockfile con orígenes no permitidos",
  },
  {
    job: "iac",
    fase: "5",
    control: "Infraestructura como código",
    herramienta: "Checkov",
    resultado: () => `${v("iac", "aprobados")} controles aprobados · ${v("iac", "fallidos")} fallidos · ${v("iac", "excepciones")} excepciones justificadas (${v("iac", "desglose")})`,
    criterio: "Cualquier control fallido sin excepción justificada en el código",
  },
  {
    job: "container",
    fase: "5",
    control: "Imágenes de contenedor",
    herramienta: "Trivy",
    resultado: () =>
      `App: ${v("container", "app_criticas")} críticas · ${v("container", "app_altas")} altas · ${v("container", "app_medias")} medias · WAF: ${v("container", "waf_criticas")} críticas · ${v("container", "waf_altas")} altas · base ${v("container", "base")} · SBOM: ${v("container", "sbom")} componentes`,
    criterio: "Vulnerabilidad CRITICAL/HIGH con parche disponible, secreto o mala configuración en la imagen",
  },
  {
    job: "e2e",
    fase: "4",
    control: "Pruebas E2E de seguridad",
    herramienta: "Playwright",
    resultado: () => {
      const inestables = v("e2e", "inestables");
      return `${v("e2e", "aprobadas")} aprobadas · ${v("e2e", "fallidas")} fallidas${inestables !== "0" && inestables !== "s/d" ? ` · ${inestables} inestables` : ""} en ${v("e2e", "duracion")} s (2FA, IDOR, CSRF, XSS, carrera de pagos)`;
    },
    criterio: "Cualquier prueba fallida",
  },
  {
    job: "dast",
    fase: "4",
    control: "Análisis dinámico (DAST)",
    herramienta: "OWASP ZAP a través del WAF",
    resultado: () =>
      needs.dast?.result === "skipped"
        ? "Requiere que SAST, SCA y Trivy aprueben"
        : `Alertas: ${v("dast", "altas")} altas · ${v("dast", "medias")} medias · ${v("dast", "bajas")} bajas · ${v("dast", "informativas")} informativas · ${v("dast", "bloqueos_waf")} solicitudes bloqueadas por el WAF`,
    criterio: "Cualquier regla marcada FAIL en security/zap/rules.tsv (las advertencias aceptadas no bloquean)",
  },
];

const aprobados = controles.filter((c) => needs[c.job]?.result === "success");
const conProblema = controles.filter((c) => ["failure", "cancelled"].includes(needs[c.job]?.result));
const fecha = new Date().toLocaleString("es-GT", { timeZone: "America/Guatemala", dateStyle: "medium", timeStyle: "short" });

const lineas = [];
lineas.push("# 🛡️ Resumen de seguridad · DevSecOps", "");
lineas.push(
  `**Commit** \`${(env.GITHUB_SHA ?? "").slice(0, 7)}\` · **Rama** \`${env.GITHUB_REF_NAME}\` · **Evento** ${env.GITHUB_EVENT_NAME} · **Fecha** ${fecha} (hora de Guatemala)`,
  "",
);
if (conProblema.length === 0 && aprobados.length === controles.length) {
  lineas.push(`> [!NOTE]`, `> **${aprobados.length} de ${controles.length} controles aprobados.** El cambio cumple todas las puertas de seguridad.`);
} else {
  lineas.push(
    `> [!CAUTION]`,
    `> **${aprobados.length} de ${controles.length} controles aprobados.** Revise: ${conProblema.map((c) => c.control).join(", ") || "controles no ejecutados"}.`,
  );
}
lineas.push("", "| Fase | Control | Herramienta | Estado | Resultado |", "|:-:|---|---|---|---|");
for (const c of controles) {
  const r = needs[c.job]?.result ?? "skipped";
  lineas.push(`| ${c.fase} | **${celda(c.control)}** | ${celda(c.herramienta)} | ${ESTADOS[r] ?? r} | ${celda(c.resultado())} |`);
}

lineas.push("", "<details>", "<summary><b>Criterios de bloqueo (cuándo falla cada control)</b></summary>", "");
lineas.push("| Control | El pipeline falla si… |", "|---|---|");
for (const c of controles) lineas.push(`| ${celda(c.control)} | ${celda(c.criterio)} |`);
lineas.push("", "Las excepciones aceptadas están justificadas junto al código y documentadas en `docs/DEVSECOPS.md` y `docs/LABORATORIOS.md`.", "</details>", "");

lineas.push("### Evidencia");
lineas.push(`- **Hallazgos detallados (SARIF):** pestaña [Security → Code scanning](${urlSecurity}) (Semgrep, OSV-Scanner, Checkov y Trivy).`);
lineas.push(`- **Artefactos del run:** [SBOM de dependencias e imagen, reporte de ZAP, reporte de Playwright y logs del WAF](${urlRun}#artifacts).`);
lineas.push("- **Fases del curso:** 3 = codificación segura, SAST y SCA · 4 = pruebas ofensivas · 5 = contenedores e IaC.");

appendFileSync(env.GITHUB_STEP_SUMMARY, lineas.join("\n") + "\n");
console.log(lineas.join("\n"));
