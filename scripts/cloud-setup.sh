#!/usr/bin/env bash
set -euo pipefail
cd /workspace/maket
npm ci --cache /tmp/maket-npm --no-audit --no-fund
if [ ! -f .env ]; then cp .env.example .env; fi
# Start the bundled development database only for the documented local connection.
# Other DATABASE_URL bindings are preserved and their service is managed separately.
if node --input-type=module -e 'import "dotenv/config"; const u=new URL(process.env.DATABASE_URL); process.exit(["localhost","127.0.0.1"].includes(u.hostname) && (u.port==="5432" || !u.port) && u.username==="maket" && u.password==="maket_local" && u.pathname==="/maket" ? 0 : 1)'; then
  if docker inspect maket-postgres >/dev/null 2>&1; then
    docker start maket-postgres >/dev/null
  else
    docker run --name maket-postgres -e POSTGRES_USER=maket -e POSTGRES_PASSWORD=maket_local -e POSTGRES_DB=maket -p 127.0.0.1:5432:5432 -v maket-postgres-data:/var/lib/postgresql/data -d postgres:17 >/dev/null
  fi
  ready=false
  for attempt in {1..30}; do
    if docker exec maket-postgres pg_isready -U maket -d maket >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
  done
  if [ "$ready" != true ]; then echo 'PostgreSQL did not become ready' >&2; exit 1; fi
fi
npm run db:generate
npm run db:migrate
npm run typecheck
npm test
