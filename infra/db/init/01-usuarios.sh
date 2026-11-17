#!/bin/bash
# Crea usuarios de base de datos con MENOR PRIVILEGIO (se ejecuta sólo en el primer arranque).
#  - ventas_app:      DML únicamente (SELECT/INSERT/UPDATE/DELETE) -> usado por la aplicación
#  - ventas_migrator: DDL para migraciones -> usado sólo por el job "migrate"
# Las contraseñas provienen de variables de entorno (.env.docker), nunca del código.
set -euo pipefail

: "${MYSQL_DATABASE:?}" "${APP_DB_PASSWORD:?}" "${MIGRATOR_DB_PASSWORD:?}"

mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'ventas_app'@'%' IDENTIFIED BY '${APP_DB_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`${MYSQL_DATABASE}\`.* TO 'ventas_app'@'%';

CREATE USER IF NOT EXISTS 'ventas_migrator'@'%' IDENTIFIED BY '${MIGRATOR_DB_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES
  ON \`${MYSQL_DATABASE}\`.* TO 'ventas_migrator'@'%';

FLUSH PRIVILEGES;
SQL
