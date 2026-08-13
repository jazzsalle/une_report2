#!/bin/sh
# Runs only on first initdb (fresh une_pgdata volume). Creates the worker's
# dedicated LOGIN role (OB-17).
#
# Why a separate role instead of granting une_worker/une_retention to une_app:
# the default INHERIT would hand the API runtime the retention role's policy
# membership, so une_app could read every tenant's raw provider payloads
# (ADR-35 D2/D4 boundary). The split keeps the API strictly tenant-scoped.
#
# Ordering: this script runs BEFORE migrations, so une_worker and
# une_retention do not exist yet and cannot be granted here. Migration 0050
# grants the memberships (WITH INHERIT FALSE, SET TRUE) once those roles
# exist. This script only supplies LOGIN and the password, which a migration
# must never carry.
#
# Passwords must be quote-free (hex recommended, see .env.example).
set -eu

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE ${UNE_DB_WORKER_USER} LOGIN PASSWORD '${UNE_DB_WORKER_PASSWORD}'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO ${UNE_DB_WORKER_USER};
  GRANT USAGE ON SCHEMA public TO ${UNE_DB_WORKER_USER};
EOSQL

echo "worker login role ${UNE_DB_WORKER_USER} ready (memberships come from migration 0050)"
