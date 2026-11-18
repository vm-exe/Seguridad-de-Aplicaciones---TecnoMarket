# =============================================================================
# WAF = imagen oficial OWASP CRS (nginx + ModSecurity 3) + módulo OpenTelemetry de nginx.
#
# La imagen base no incluye ngx_otel_module. Se instala el paquete OFICIAL de nginx.org
# para la MISMA versión de nginx de la imagen (un módulo dinámico debe coincidir
# exactamente con el binario). apk verifica la firma del paquete con la clave de nginx.org.
# =============================================================================
FROM owasp/modsecurity-crs:4.25-nginx-alpine-lts

USER root
RUN set -eux; \
    NGINX_VER="$(nginx -v 2>&1 | sed 's#.*/##')"; \
    ALPINE_VER="$(cut -d. -f1,2 /etc/alpine-release)"; \
    wget -qO /etc/apk/keys/nginx_signing.rsa.pub https://nginx.org/keys/nginx_signing.rsa.pub; \
    apk add --no-cache \
      --repository "https://nginx.org/packages/alpine/v${ALPINE_VER}/main" \
      "nginx-module-otel~${NGINX_VER}"; \
    test -f /usr/lib/nginx/modules/ngx_otel_module.so; \
    # load_module solo es válido en el contexto principal: se antepone a la plantilla de la imagen.
    sed -i '1i load_module modules/ngx_otel_module.so;' /etc/nginx/templates/nginx.conf.template

USER nginx
