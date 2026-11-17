/** Verifica la integridad de la bitácora encadenada. Código de salida 1 si fue alterada (útil para cron / SIEM). */
import { verificarCadena } from "@/lib/audit";

verificarCadena()
  .then((r) => {
    if (r.ok) console.log(`OK: ${r.total} eventos íntegros.`);
    else console.error(`ALERTA: cadena rota en el evento #${r.rotoEn} (de ${r.total}).`);
    process.exit(r.ok ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(2);
  });
