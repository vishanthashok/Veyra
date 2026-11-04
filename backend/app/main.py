from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .config import settings
from .core import errors, middleware
from .db import engine
from .routers import audits, core, imports, lease_intelligence, mappings, rules, workflows

settings.validate_for_runtime()
middleware.configure_logging(settings.log_level)

app = FastAPI(
    title="Veyra API", version="0.3.0", description="CAM pre-close audit. Provisional results for accountant review."
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Idempotency-Key", "X-Request-ID"],
)
middleware.install(app)
errors.install(app)


@app.get("/api/health")
def health():
    """Liveness and database readiness."""
    try:
        with engine.connect() as c:
            c.execute(text("select 1"))
        db = "ok"
    except Exception:  # noqa: BLE001  health must report, not raise
        db = "unavailable"
    return {"status": "ok" if db == "ok" else "degraded", "database": db, "version": app.version}


for r in (
    core.router,
    imports.router,
    mappings.router,
    rules.router,
    audits.router,
    workflows.router,
    lease_intelligence.router,
):
    app.include_router(r, prefix="/api/v1")
