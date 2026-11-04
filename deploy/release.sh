#!/usr/bin/env bash
# Heroku release phase: runs before each new version goes live.
set -euo pipefail
cd /app/backend
alembic upgrade head
# Creates the demo account from VEYRA_DEMO_PASSWORD (and the demo property once). No-op without it.
python -m app.demo_seed --release
