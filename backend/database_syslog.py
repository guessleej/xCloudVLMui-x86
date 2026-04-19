"""
database_syslog.py — 獨立 syslog SQLite 非同步引擎
與主資料庫完全隔離，避免 log 寫入影響業務查詢效能
"""
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

SYSLOG_DB_URL = "sqlite+aiosqlite:///./syslog.db"

syslog_engine = create_async_engine(
    SYSLOG_DB_URL,
    echo=False,
    connect_args={"check_same_thread": False},
)

SyslogSessionLocal = async_sessionmaker(
    syslog_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class SyslogBase(DeclarativeBase):
    pass


async def init_syslog_db() -> None:
    """建立 syslog 資料表（首次啟動時呼叫，已存在則跳過）
    使用 try/except 處理多 worker 同時初始化的 race condition
    """
    from models.syslog_models import SysLog  # noqa: F401
    try:
        async with syslog_engine.begin() as conn:
            await conn.run_sync(SyslogBase.metadata.create_all, checkfirst=True)
    except Exception:
        # 另一個 worker 已建立資料表，忽略此錯誤
        pass


async def get_syslog_db():
    """FastAPI Depends 注入用"""
    async with SyslogSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
