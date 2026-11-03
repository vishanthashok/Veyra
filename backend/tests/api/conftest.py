"""API tests run against a real PostgreSQL database named by VEYRA_TEST_DATABASE_URL.

The schema is rebuilt from Alembic migrations at session start.
"""

import os
import uuid

import pytest

TEST_URL = os.environ.get("VEYRA_TEST_DATABASE_URL")
if not TEST_URL:
    pytest.skip("VEYRA_TEST_DATABASE_URL not set. API tests need PostgreSQL.",
                allow_module_level=True)
os.environ["VEYRA_DATABASE_URL"] = TEST_URL


@pytest.fixture(scope="session", autouse=True)
def schema():
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, text

    eng = create_engine(TEST_URL)
    with eng.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    eng.dispose()
    here = os.path.dirname(__file__)
    cfg = Config(os.path.join(here, "..", "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(here, "..", "..", "alembic"))
    command.upgrade(cfg, "head")
    yield


@pytest.fixture
def user_factory():
    from app.demo_seed import ensure_demo_user

    def make():
        email = f"user-{uuid.uuid4().hex[:8]}@test.local"
        ensure_demo_user(email=email, password="pw-test-123", org_name=f"Org {email}")
        return email, "pw-test-123"
    return make


@pytest.fixture
def client(user_factory):
    from fastapi.testclient import TestClient

    from app.main import app

    email, pw = user_factory()
    with TestClient(app) as c:
        r = c.post("/api/v1/auth/login", json={"email": email, "password": pw})
        assert r.status_code == 200
        c.creds = (email, pw)
        yield c
