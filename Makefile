.PHONY: setup test test-engine migrate demo api web up e2e screenshots

setup:
	cd backend && uv sync
	cd frontend && pnpm install

test-engine:
	cd backend && uv run pytest tests/engine -q

# API tests need VEYRA_TEST_DATABASE_URL pointing at a database they may wipe.
test:
	cd backend && uv run ruff check . && uv run mypy && uv run pytest -q
	cd frontend && pnpm lint && pnpm typecheck && pnpm test && pnpm build

e2e:
	cd frontend && pnpm e2e

screenshots:
	cd frontend && SCREENSHOTS=1 pnpm e2e e2e/screenshots.spec.ts

migrate:
	cd backend && uv run alembic upgrade head

demo: migrate
	cd backend && uv run python ../demo/generate.py && uv run python ../demo/expected.py && uv run python -m app.demo_seed --reports

api:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

web:
	cd frontend && pnpm dev

up:
	docker compose up --build
