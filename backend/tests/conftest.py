"""
tests/conftest.py — pytest 全域 Fixture
=========================================
提供 in-memory SQLite、AsyncSession、TestClient 供所有測試共用。

依賴（需安裝 dev 套件）：
  pip install -r requirements-dev.txt
  pytest / httpx / anyio / pytest-asyncio
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx                          import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio         import AsyncSession, create_async_engine
from sqlalchemy.orm                 import sessionmaker
from sqlalchemy.pool                import StaticPool

from database    import Base, get_db
from main        import app


# ── In-memory SQLite 引擎（測試專用，各 session 隔離）──────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

engine = create_async_engine(
    TEST_DATABASE_URL,
    connect_args= {"check_same_thread": False},
    poolclass=    StaticPool,
)

AsyncTestSessionLocal = sessionmaker(
    bind=         engine,
    class_=       AsyncSession,
    expire_on_commit= False,
)


@pytest_asyncio.fixture(scope="function")
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """為每個測試函式建立全新的 in-memory DB（自動 rollback）"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncTestSessionLocal() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """
    提供 FastAPI TestClient（httpx AsyncClient + ASGITransport）。
    自動替換 get_db 依賴為測試用 in-memory session。
    """
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=         ASGITransport(app=app),
        base_url=          "http://testserver",
        follow_redirects=  True,
    ) as c:
        yield c

    app.dependency_overrides.clear()


# ── pytest-asyncio 全域設定 ──────────────────────────────────────────

@pytest.fixture(scope="session")
def event_loop():
    """覆寫 event_loop fixture 確保全 session 使用同一個 loop"""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()
