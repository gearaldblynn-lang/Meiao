#!/bin/sh
set -eu

: "${POSTGRES_SEEDS:?ERROR: POSTGRES_SEEDS environment variable is required}"
: "${POSTGRES_USER:?ERROR: POSTGRES_USER environment variable is required}"

DB_PORT="${DB_PORT:-5432}"

echo "Starting Temporal PostgreSQL schema setup..."
nc -z -w 10 "$POSTGRES_SEEDS" "$DB_PORT"

temporal-sql-tool --plugin postgres12 --ep "$POSTGRES_SEEDS" -u "$POSTGRES_USER" -p "$DB_PORT" --db temporal create || true
temporal-sql-tool --plugin postgres12 --ep "$POSTGRES_SEEDS" -u "$POSTGRES_USER" -p "$DB_PORT" --db temporal setup-schema -v 0.0 || true
temporal-sql-tool --plugin postgres12 --ep "$POSTGRES_SEEDS" -u "$POSTGRES_USER" -p "$DB_PORT" --db temporal update-schema -d /etc/temporal/schema/postgresql/v12/temporal/versioned

temporal-sql-tool --plugin postgres12 --ep "$POSTGRES_SEEDS" -u "$POSTGRES_USER" -p "$DB_PORT" --db temporal_visibility create || true
temporal-sql-tool --plugin postgres12 --ep "$POSTGRES_SEEDS" -u "$POSTGRES_USER" -p "$DB_PORT" --db temporal_visibility setup-schema -v 0.0 || true
temporal-sql-tool --plugin postgres12 --ep "$POSTGRES_SEEDS" -u "$POSTGRES_USER" -p "$DB_PORT" --db temporal_visibility update-schema -d /etc/temporal/schema/postgresql/v12/visibility/versioned

echo "Temporal PostgreSQL schema setup complete."
