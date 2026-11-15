#!/bin/sh
# Genera las contraseñas del laboratorio. No se versionan (ver .gitignore).
set -eu
mkdir -p secrets
gen() { head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32; }
for f in db_password db_root_password; do
  if [ ! -s "secrets/$f.txt" ]; then
    gen > "secrets/$f.txt"
    chmod 600 "secrets/$f.txt"
    echo "creado secrets/$f.txt"
  else
    echo "ya existe secrets/$f.txt (no se modifica)"
  fi
done
