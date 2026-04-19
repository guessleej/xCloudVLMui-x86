"""
syslog_schemas.py — 事件中心 Pydantic Schemas
"""
from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class SysLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:          int
    timestamp:   datetime
    level:       str
    module:      str
    action:      str
    message:     str
    detail:      Optional[str] = None
    ip_address:  Optional[str] = None
    status_code: Optional[int] = None
    duration_ms: Optional[float] = None
    user_id:     Optional[str] = None


class SysLogStats(BaseModel):
    total:               int
    by_level:            dict[str, int]
    by_module:           dict[str, int]
    recent_errors_24h:   int
    recent_warnings_24h: int


class SysLogCreate(BaseModel):
    """手動寫入日誌（供業務邏輯呼叫）"""
    level:       str = "INFO"
    module:      str
    action:      str
    message:     str
    detail:      Optional[str] = None
    ip_address:  Optional[str] = None
    status_code: Optional[int] = None
    duration_ms: Optional[float] = None
    user_id:     Optional[str] = None
