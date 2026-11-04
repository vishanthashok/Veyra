# Single-container production image: Next.js serves the UI on $PORT and proxies /api to
# FastAPI on 127.0.0.1:8000 inside the same container. Used by heroku.yml.
# Local development still uses docker-compose.yml with backend/ and frontend/ images.

FROM node:22-slim AS web
RUN corepack enable
WORKDIR /web
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
# Rewrites are resolved at build time. The API runs in the same container.
ENV VEYRA_API_URL=http://127.0.0.1:8000 NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv
COPY --from=web /usr/local/bin/node /usr/local/bin/node
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/ ./
COPY demo/generate.py /app/demo/generate.py
COPY demo/data /app/demo/data
COPY --from=web /web/.next/standalone /app/web
COPY --from=web /web/.next/static /app/web/.next/static
COPY --from=web /web/public /app/web/public
COPY deploy/start.sh deploy/release.sh /app/
RUN chmod +x /app/start.sh /app/release.sh && useradd --create-home veyra
USER veyra
ENV PATH="/app/backend/.venv/bin:$PATH" PYTHONUNBUFFERED=1 NODE_ENV=production VEYRA_ENV=production
CMD ["/app/start.sh"]
