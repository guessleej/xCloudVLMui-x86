"""
database.py — SQLAlchemy async engine + Base + session
"""
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from config import get_settings

_settings = get_settings()

engine = create_async_engine(
    _settings.database_url,
    echo=_settings.debug,
    connect_args={"check_same_thread": False},
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def init_db() -> None:
    """建立所有資料表（首次啟動時呼叫，已存在則跳過）"""
    from models.db_models import User, Report, RagDocument, SystemSettings, MqttDevice, MqttSensorReading, MqttAlertThreshold, EquipmentAlert, VhsReading, VisionSession, ChatHistory, TrainedModel, FactoryEvent  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, checkfirst=True)


async def get_db():
    """FastAPI Depends 注入用"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
