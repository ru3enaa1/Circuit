#!/bin/sh
# ADR-0020 D4: the database container's entry. Before PostgreSQL starts, it makes, once, each
# password that is not in the secrets volume yet, and gives the admin's to the image's own entry
# when the environment (or .env) left POSTGRES_PASSWORD empty. A clone with no .env thus needs
# nothing but `docker compose up`; one with .env keeps its own passwords. No value is printed.
set -eu

SECRETS_DIR=/run/circuit-secrets
# The group of the image's node user, which runs setup, crm and circuit (Dockerfile).
APP_GROUP=1000
# 32 letters and digits: inside the rule of every password (16 to 128 of A-Za-z0-9._~-).
PASSWORD_LENGTH=32

# The umask only in this subshell: the image's own entry creates the data folders with its default
# one, and with 027 the postgres user could not enter them (seen on 2026-11-27, «Permission denied»).
(
  umask 027
  for name in POSTGRES_PASSWORD CRM_DB_PASSWORD CIRCUIT_DB_PASSWORD; do
    file="$SECRETS_DIR/$name"
    if [ ! -s "$file" ]; then
      # A temporary and a rename: a container stopped halfway never leaves a short password.
      tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$PASSWORD_LENGTH" > "$file.tmp"
      mv "$file.tmp" "$file"
    fi
  done
)
chgrp "$APP_GROUP" "$SECRETS_DIR" "$SECRETS_DIR"/*
chmod 0750 "$SECRETS_DIR"
chmod 0640 "$SECRETS_DIR"/*

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  POSTGRES_PASSWORD="$(cat "$SECRETS_DIR/POSTGRES_PASSWORD")"
  export POSTGRES_PASSWORD
fi

exec docker-entrypoint.sh postgres
