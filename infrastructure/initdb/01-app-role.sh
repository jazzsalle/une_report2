#!/bin/sh
# Runs only on first initdb (fresh une_pgdata volume). Creates the
# non-superuser application role so runtime services cannot bypass RLS;
# superuser ${POSTGRES_USER} stays for migrations/ops only.
# Passwords must be quote-free (hex recommended, see .env.example).
set -eu

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE ${UNE_DB_APP_USER} LOGIN PASSWORD '${UNE_DB_APP_PASSWORD}'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${UNE_DB_APP_USER};
  GRANT USAGE ON SCHEMA public TO ${UNE_DB_APP_USER};
  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${UNE_DB_APP_USER};
  ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO ${UNE_DB_APP_USER};
EOSQL

echo "application role ${UNE_DB_APP_USER} ready (NOSUPERUSER NOBYPASSRLS)"
