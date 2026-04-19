"""
routers/syslog.py — 事件中心 API
提供日誌查詢、統計、清除功能
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, delete

from database_syslog import get_syslog_db
from models.syslog_models import SysLog
from models.syslog_schemas import SysLogOut, SysLogStats

router = APIRouter(prefix="/api/syslog", tags=["syslog"])


# ── 查詢日誌列表 ──────────────────────────────────────────────────────
@router.get("/", response_model=list[SysLogOut], summary="查詢日誌列表")
async def list_logs(
    level:   Optional[str] = Query(None, description="過濾等級：INFO / WARNING / ERROR / CRITICAL"),
    module:  Optional[str] = Query(None, description="過濾模組：mqtt / rag / report / settings / auth / vlm / system"),
    search:  Optional[str] = Query(None, description="訊息關鍵字搜尋"),
    since_h: Optional[int] = Query(None, description="最近幾小時（24 = 最近一天）"),
    limit:   int           = Query(200, le=1000, description="最多回傳筆數"),
    offset:  int           = Query(0,  ge=0,    description="分頁偏移"),
    db:      AsyncSession  = Depends(get_syslog_db),
):
    q = select(SysLog).order_by(desc(SysLog.timestamp))

    if level and level.upper() != "ALL":
        q = q.where(SysLog.level == level.upper())
    if module and module.lower() != "all":
        q = q.where(SysLog.module == module.lower())
    if search:
        q = q.where(SysLog.message.ilike(f"%{search}%"))
    if since_h:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=since_h)
        q = q.where(SysLog.timestamp >= cutoff)

    q = q.offset(offset).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


# ── 統計資訊 ──────────────────────────────────────────────────────────
@router.get("/stats", response_model=SysLogStats, summary="統計摘要")
async def get_stats(db: AsyncSession = Depends(get_syslog_db)):
    # 總筆數
    total = (await db.execute(select(func.count()).select_from(SysLog))).scalar_one()

    # 各等級計數
    level_rows = (await db.execute(
        select(SysLog.level, func.count(SysLog.id)).group_by(SysLog.level)
    )).all()
    by_level = {row[0]: row[1] for row in level_rows}

    # 各模組計數
    module_rows = (await db.execute(
        select(SysLog.module, func.count(SysLog.id)).group_by(SysLog.module)
    )).all()
    by_module = {row[0]: row[1] for row in module_rows}

    # 最近 24 小時錯誤數
    cutoff_24h = datetime.now(timezone.utc) - timedelta(hours=24)
    recent_errors = (await db.execute(
        select(func.count(SysLog.id)).where(
            SysLog.level.in_(["ERROR", "CRITICAL"]),
            SysLog.timestamp >= cutoff_24h,
        )
    )).scalar_one()

    recent_warnings = (await db.execute(
        select(func.count(SysLog.id)).where(
            SysLog.level == "WARNING",
            SysLog.timestamp >= cutoff_24h,
        )
    )).scalar_one()

    return SysLogStats(
        total=               total,
        by_level=            by_level,
        by_module=           by_module,
        recent_errors_24h=   recent_errors,
        recent_warnings_24h= recent_warnings,
    )


# ── 最近 N 筆（快速取得最新事件，供儀表板小工具使用）────────────────
@router.get("/recent", response_model=list[SysLogOut], summary="最近事件快取")
async def get_recent(
    limit: int          = Query(50, le=200),
    db:    AsyncSession = Depends(get_syslog_db),
):
    q = select(SysLog).order_by(desc(SysLog.timestamp)).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


# ── 清除舊日誌 ────────────────────────────────────────────────────────
@router.delete("/", status_code=204, summary="清除過期日誌")
async def clear_old_logs(
    before_days: int          = Query(30, ge=1, description="清除幾天前的日誌，最少 1 天"),
    db:          AsyncSession = Depends(get_syslog_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(days=before_days)
    stmt   = delete(SysLog).where(SysLog.timestamp < cutoff)
    result = await db.execute(stmt)
    await db.commit()
    return None  # 204 No Content


# ── 手動寫入一筆日誌（供外部測試或第三方整合使用）───────────────────
@router.post("/", response_model=SysLogOut, status_code=201, summary="手動寫入日誌")
async def create_log(
    payload: dict,
    db:      AsyncSession = Depends(get_syslog_db),
):
    required = {"level", "module", "action", "message"}
    missing  = required - payload.keys()
    if missing:
        raise HTTPException(status_code=422, detail=f"缺少必填欄位：{missing}")

    log = SysLog(
        timestamp=   datetime.now(timezone.utc),
        level=       payload["level"].upper(),
        module=      payload["module"].lower(),
        action=      payload["action"],
        message=     payload["message"],
        detail=      payload.get("detail"),
        ip_address=  payload.get("ip_address"),
        status_code= payload.get("status_code"),
        duration_ms= payload.get("duration_ms"),
        user_id=     payload.get("user_id"),
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return log
