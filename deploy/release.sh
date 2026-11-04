#!/usr/bin/env bash
# Heroku release phase: runs before each new version goes live.
set -euo pipefail
cd /app/backend
alembic upgrade head
# Creates the demo account from VEYRA_DEMO_PASSWORD (and the demo property once). No-op without it.
# A demo failure is logged but does not block the deploy; migrations above still must succeed.
python -m app.demo_seed --release || echo "WARNING: demo seed failed; see the error above. The app still deploys."
