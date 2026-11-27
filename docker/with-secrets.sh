#!/bin/sh
# ADR-0020 D4: the entry of the three Node services. A password the environment (or .env) brings
# is used as it is; one the service declares but leaves empty is read from the file the database
# container generated in the secrets volume. A variable the service does not declare stays unset,
# so the CRM and circuit never see the admin's password. No value is ever printed.
set -eu

SECRETS_DIR=/run/circuit-secrets

for name in POSTGRES_PASSWORD CRM_DB_PASSWORD CIRCUIT_DB_PASSWORD; do
  # The names are fixed above, so eval only reads one of these three variables.
  eval "declared=\${$name+yes}"
  eval "value=\${$name-}"
  if [ "$declared" = yes ] && [ -z "$value" ]; then
    if [ ! -r "$SECRETS_DIR/$name" ]; then
      echo "Falta la contraseña generada de $name en el volumen secrets: corre docker compose up otra vez." >&2
      exit 1
    fi
    value="$(cat "$SECRETS_DIR/$name")"
    export "$name=$value"
  fi
done

exec "$@"
