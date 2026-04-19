"""
syslog_models.py — 系統事件日誌 ORM Model
獨立存放於 syslog.db，與主業務資料庫完全隔離
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, Float, Text, Index

from database_syslog import SyslogBase


class SysLog(SyslogBase):
    """
    系統事件日誌

    level   : DEBUG / INFO / WARNING / ERROR / CRITICAL
    module  : mqtt / rag / report / settings / auth / vlm / system
    action  : 動作識別碼，例如 device.create / threshold.delete / user.login
    message : 人類可讀的描述
    detail  : JSON 字串，選填額外上下文（請求 body、錯誤訊息等）
    """
    __tablename__ = "syslogs"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    timestamp   = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    level       = Column(String(20),  nullable=False, index=True)   # INFO / WARNING / ERROR / CRITICAL
    module      = Column(String(50),  nullable=False, index=True)   # mqtt / rag / report / …
    action      = Column(String(120), nullable=False)               # device.create / user.login / …
    message     = Column(String(500), nullable=False)               # 人類可讀說明
    detail      = Column(Text,        nullable=True)                # JSON 格式的額外資料
    ip_address  = Column(String(60),  nullable=True)                # 請求來源 IP
    status_code = Column(Integer,     nullable=True)                # HTTP 狀態碼
    duration_ms = Column(Float,       nullable=True)                # API 回應時間（毫秒）
    user_id     = Column(String(100), nullable=True)                # 操作者 user ID（若有）
    request_id  = Column(String(100), nullable=True, index=True)   # X-Request-ID 關聯追蹤（UUID v4）

    # 複合索引：加速常見查詢
    __table_args__ = (
        Index("ix_syslogs_level_ts",  "level",  "timestamp"),
        Index("ix_syslogs_module_ts", "module", "timestamp"),
    )

    def __repr__(self) -> str:
        return f"<SysLog [{self.level}] {self.module}.{self.action} @ {self.timestamp}>"
