# Pruebas DAST con OWASP ZAP (Fase 4 – Ciberdefensa)

Objetivo: evaluar la aplicación **desplegada detrás del WAF** (`http://localhost:8080`) sin acceso al código (caja negra) y luego con credenciales (caja gris).

> Ejecutar sólo contra entornos propios. Nunca contra producción sin autorización escrita.

## 1. Baseline pasivo (lo que corre el pipeline)

```bash
docker run --rm --network host -v "$PWD/security/zap:/zap/wrk:rw" \
  ghcr.io/zaproxy/zaproxy:stable zap-baseline.py \
  -t http://localhost:8080 -c rules.tsv -r baseline.html -J baseline.json -a -j
```

`rules.tsv` define qué alertas hacen fallar el build (`FAIL`), cuáles se reportan (`WARN`) y cuáles se ignoran (`IGNORE`) con su justificación.

## 2. Escaneo completo / activo – caja negra (manual)

Con ZAP Desktop (Windows, sin Docker):

1. Instalar ZAP desde <https://www.zaproxy.org/download/> (requiere Java 17+).
2. *Automated Scan* → URL `http://localhost:8080` (o `http://localhost:3000` para comparar **sin WAF**).
3. Activar *AJAX Spider* (la app es React/Next.js).
4. *Report → Generate Report* (HTML + JSON) y guardar en `docs/evidencias/`.

Con Docker:

```bash
docker run --rm --network host -v "$PWD/security/zap:/zap/wrk:rw" \
  ghcr.io/zaproxy/zaproxy:stable zap-full-scan.py \
  -t http://localhost:8080 -c rules.tsv -r full.html -J full.json -j
```

**Comparación sugerida para el informe:** correr el full scan contra `:3000` (app directa) y `:8080` (con WAF). La diferencia de alertas/bloqueos (403 de ModSecurity) evidencia el control compensatorio del WAF.

## 3. Escaneo autenticado – caja gris

1. Registrar un usuario de prueba (`cliente.zap@example.com`) y un admin de prueba (con 2FA desactivado SOLO en el entorno de pruebas, o usando una sesión ya validada).
2. En ZAP Desktop: *Contexts → Include in context* `http://localhost:8080.*`.
   - *Authentication*: **JSON-based** → login URL `http://localhost:8080/api/auth/sign-in/email`, cuerpo `{"email":"{%username%}","password":"{%password%}"}`.
   - *Session Management*: **Cookie-based** (cookie `better-auth.session_token`).
   - *Verification*: patrón logged-in `"/cuenta"` / logged-out `"Iniciar sesión"`.
   - *Users*: agregar el usuario de prueba.
3. Ejecutar Spider + Active Scan **como el usuario**.
4. Pruebas manuales de **BOLA/IDOR** (Fase 4.2): con el usuario A, abrir `/pedido/<id>` de un pedido del usuario B (usar *Request Editor* o *Fuzzer* sobre el ID). Resultado esperado: 404/403 y evento `authz.denied` en logs.
5. Pruebas de **casos de abuso** (Fase 4.3):
   - Fuerza bruta: *Fuzzer* sobre `password` en `/api/auth/sign-in/email` → esperado `429` tras 5 intentos/min (Nginx) y bloqueo por rate-limit de la app.
   - Manipulación de precio: interceptar el checkout y agregar `total=1` → esperado `403` (regla WAF 1200) y el total sigue calculándose en servidor.
   - Escalamiento: con sesión de cliente acceder a `/admin` → redirección/403.

## 4. Herramientas complementarias

| Herramienta | Uso |
|---|---|
| Burp Suite Community | Interceptar/repetir peticiones, pruebas manuales IDOR y tampering |
| Nmap | `nmap -sV -p- localhost` → sólo debe aparecer 8080 (WAF); 3000/3306 no expuestos en compose |
| sqlmap (con permiso) | Verificar que el WAF y las consultas parametrizadas bloquean SQLi |
