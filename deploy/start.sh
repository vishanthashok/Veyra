#!/usr/bin/env bash
# Starts the API on loopback and the web server on $PORT. If either exits, the container
# exits so the platform restarts it.
set -euo pipefail

cd /app/backend
# The API trusts X-Forwarded-For only from the local Next.js proxy (uvicorn default),
# so the login rate limit sees the visitor IP that the platform router appends.
uvicorn app.main:app --host 127.0.0.1 --port 8000 --forwarded-allow-ips 127.0.0.1 &

cd /app/web
PORT="${PORT:-3000}" HOSTNAME=0.0.0.0 node server.js &

wait -n
exit $?
