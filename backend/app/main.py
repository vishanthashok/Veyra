from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import audits, core, data, rules

app = FastAPI(title="Veyra API", version="0.1.0",
              description="CAM pre-close audit. Provisional results for accountant review.")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health():
    return {"status": "ok"}


for r in (core.router, data.router, rules.router, audits.router):
    app.include_router(r, prefix="/api/v1")
