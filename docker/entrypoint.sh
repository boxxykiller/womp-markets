#!/bin/sh
# Single-container entrypoint: initialize Postgres on first run (into a
# volume-backed data directory), start it, apply Prisma migrations, then exec
# the Node server.
set -e

PGBIN=$(dirname "$(find /usr/lib/postgresql -name pg_ctl | head -n1)")
PGDATA=/var/lib/postgresql/data

POSTGRES_DB="${POSTGRES_DB:-womp_markets}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"

if [ -z "$POSTGRES_PASSWORD" ]; then
  echo "[entrypoint] POSTGRES_PASSWORD must be set." >&2
  exit 1
fi
# scram-sha-256 auth applies to local socket connections too, so every
# gosu-run psql/pg_isready call below needs this to avoid an interactive
# password prompt.
export PGPASSWORD="$POSTGRES_PASSWORD"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "[entrypoint] Initializing Postgres data directory at $PGDATA..."
  mkdir -p "$PGDATA"
  chown -R postgres:postgres "$PGDATA"
  echo "$POSTGRES_PASSWORD" > /tmp/pgpass
  gosu postgres "$PGBIN/initdb" -D "$PGDATA" -U "$POSTGRES_USER" --pwfile=/tmp/pgpass --auth=scram-sha-256
  rm -f /tmp/pgpass
fi

chown -R postgres:postgres "$PGDATA"

echo "[entrypoint] Starting Postgres..."
gosu postgres "$PGBIN/pg_ctl" -D "$PGDATA" -l /var/lib/postgresql/logfile -o "-c listen_addresses=localhost" -w start

until gosu postgres "$PGBIN/pg_isready" -q; do
  sleep 1
done

DB_EXISTS=$(gosu postgres psql -U "$POSTGRES_USER" -tAc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'")
if [ "$DB_EXISTS" != "1" ]; then
  echo "[entrypoint] Creating database $POSTGRES_DB..."
  gosu postgres psql -U "$POSTGRES_USER" -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\";"
fi

echo "[entrypoint] Running Prisma migrations..."
cd /app/server
node_modules/.bin/prisma migrate deploy

echo "[entrypoint] Starting server..."
cd /app
exec node server/src/index.js
