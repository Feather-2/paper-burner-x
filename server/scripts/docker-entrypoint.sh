#!/bin/sh
set -eu

# Optional runtime migrations
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Running Prisma migrations..."
  (cd /app/server && npx prisma migrate deploy)
else
  echo "[entrypoint] Skipping Prisma migrations (RUN_MIGRATIONS=$RUN_MIGRATIONS)"
fi

# Start server
exec node /app/server/src/index.js
