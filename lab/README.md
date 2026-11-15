# Laboratorio TecnoMarket GT

Tienda ficticia sobre WordPress y WooCommerce para el proyecto final de Seguridad en
Aplicaciones (UMG). Todos los datos son sintéticos. Las pruebas ofensivas se ejecutan
únicamente contra este laboratorio.

> Estos archivos se validaron con `docker compose config`, pero no se ejecutaron:
> el entorno donde se prepararon no tiene acceso a Docker Hub. El primer arranque
> puede requerir ajustes; anótenlos, porque son parte de la evidencia del Anexo C.

## Servicios

| Servicio  | Imagen                         | Redes             | Puertos publicados |
|-----------|--------------------------------|-------------------|--------------------|
| waf       | owasp/modsecurity-crs:nginx    | frontend          | 80 y 443           |
| wordpress | wordpress:php8.3-apache        | frontend, backend | ninguno            |
| mariadb   | mariadb:11.4                   | backend (interna) | ninguno            |

WordPress pertenece a la red frontend porque necesita salida a Internet para descargar
WooCommerce y sus actualizaciones. MariaDB solo pertenece a la red backend, que es
interna: no tiene ruta hacia el anfitrión ni hacia Internet.

## 1. Preparación

1. Añadir al archivo hosts del equipo: `127.0.0.1 tecnomarket.local`
2. Generar las contraseñas: `./init-secrets.sh`
3. Copiar la configuración: `cp .env.example .env`
4. Levantar el laboratorio: `docker compose up -d`
5. Comprobar el estado: `docker compose ps`

El WAF usa un certificado autofirmado; el navegador mostrará una advertencia.

## 2. Instalación de la tienda

```sh
# Núcleo de WordPress (pedirá la contraseña del administrador)
docker compose --profile setup run --rm wpcli wp core install \
  --url=https://tecnomarket.local --title="TecnoMarket GT" \
  --admin_user=admin_tmgt --admin_email=admin@tecnomarket.local --prompt=admin_password

# WooCommerce y tema
docker compose --profile setup run --rm wpcli wp plugin install woocommerce --activate
docker compose --profile setup run --rm wpcli wp theme install storefront --activate

# Cuentas de prueba para caja gris (pedirá cada contraseña)
docker compose --profile setup run --rm wpcli wp user create gestor gestor@tecnomarket.local --role=shop_manager --prompt=user_pass
docker compose --profile setup run --rm wpcli wp user create cliente_a cliente_a@tecnomarket.local --role=customer --prompt=user_pass
docker compose --profile setup run --rm wpcli wp user create cliente_b cliente_b@tecnomarket.local --role=customer --prompt=user_pass
```

Después, desde el panel (`https://tecnomarket.local/wp-admin/`): configurar la moneda en
quetzales, crear las categorías y productos de prueba, un cupón de un solo uso y al
menos un pedido por cada cliente.

Las tareas programadas no se ejecutan por petición externa (`DISABLE_WP_CRON`).
Para ejecutarlas a mano:

```sh
docker compose --profile setup run --rm wpcli wp cron event run --due-now
```

## 3. Registro de versiones (Anexo A)

```sh
docker compose images
docker compose --profile setup run --rm wpcli wp core version
docker compose --profile setup run --rm wpcli wp plugin list
docker image inspect --format '{{index .RepoDigests 0}}' owasp/modsecurity-crs:nginx wordpress:php8.3-apache mariadb:11.4
```

Con los digest obtenidos, sustituir las etiquetas del `docker-compose.yml` por
`imagen@sha256:...`.

## 4. Las dos rondas de pruebas

| Ronda | `.env`                             | Archivos                                              |
|-------|------------------------------------|-------------------------------------------------------|
| 1     | `MODSEC_RULE_ENGINE=DetectionOnly` | `docker-compose.yml`                                  |
| 2     | `MODSEC_RULE_ENGINE=On`            | `docker-compose.yml` y `docker-compose.hardening.yml` |

```sh
# Ronda 2
docker compose -f docker-compose.yml -f docker-compose.hardening.yml up -d
```

Antes del escaneo activo de ZAP, respaldar el estado (el escaneo crea reseñas y cuentas):

```sh
docker compose exec mariadb sh -c 'mariadb-dump -uroot -p"$(cat /run/secrets/db_root_password)" tecnomarket' > respaldo_linea_base.sql
```

## 5. Evidencia del WAF (Anexo H)

```sh
docker compose logs waf | grep tecnomarket        # reglas propias activadas
docker compose logs waf | grep -o '"ruleId":"[0-9]*"' | sort | uniq -c   # reglas CRS activadas
```

## 6. Pendientes conocidos

- **Límite de intentos en `/wp-login.php` (R01).** No está configurado. Requiere
  añadir `limit_req_zone` y `limit_req` a la plantilla de Nginx de la imagen del WAF.
  Para ver la plantilla por omisión antes de modificarla:
  `docker compose exec waf ls /etc/nginx/templates/conf.d/`
- **Complemento propio.** Cuando exista, descomentar su volumen en `docker-compose.yml`.
- **Reglas propias del WAF.** `waf/REQUEST-900-...conf` no se ha probado en ejecución.
  Verificar con: `curl -k -i https://tecnomarket.local/xmlrpc.php` (esperado en ronda 2: 403).
- **Endurecimiento.** Si un servicio no arranca con `docker-compose.hardening.yml`,
  revisar sus logs y ajustar `cap_add`.

## Apagado

```sh
docker compose down        # conserva los datos
docker compose down -v     # borra la tienda y la base de datos
```
