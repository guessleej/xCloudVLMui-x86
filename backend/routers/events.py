"""
routers/events.py — 工廠事件 CRUD API
職責：工廠事件的查詢、統計、新增、確認（acknowledge）、解決（resolve）、刪除

端點：
  GET    /api/events                        → 查詢事件列表（可過濾）
  GET    /api/events/stats                  → 統計摘要
  POST   /api/events                        → 手動建立事件
  PATCH  /api/events/{id}/acknowledge       → 標記已確認
  PATCH  /api/events/{id}/resolve           → 標記已解決
  DELETE /api/events/{id}                   → 刪除事件
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import FactoryEvent
from models.event_schemas import EventCreate, EventOut, EventStats

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("", response_model=list[EventOut])
async def list_events(
    event_type: Optional[str] = Query(None, description="detection|hazard|ppe_violation|equipment|system"),
    severity:   Optional[str] = Query(None, description="critical|high|medium|low|info"),
    resolved:   Optional[bool] = Query(None, description="true=已解決，false=未解決，None=全部"),
    since_h:    Optional[int]  = Query(None, ge=1, description="過去 N 小時"),
    limit:      int            = Query(100, ge=1, le=1000),
    offset:     int            = Query(0,   ge=0),
    db:         AsyncSession   = Depends(get_db),
):
    """取得事件列表，可依類型、嚴重度、解決狀態、時間範圍過濾。"""
    stmt = select(FactoryEvent)

    if event_type:
        stmt = stmt.where(FactoryEvent.event_type == event_type)
    if severity:
        stmt = stmt.where(FactoryEvent.severity == severity)
    if resolved is not None:
        stmt = stmt.where(FactoryEvent.resolved == resolved)
    if since_h is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=since_h)
        stmt = stmt.where(FactoryEvent.created_at >= cutoff)

    stmt = stmt.order_by(FactoryEvent.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/stats", response_model=EventStats)
async def get_stats(db: AsyncSession = Depends(get_db)):
    """取得事件統計摘要：總數、未解決、24h 嚴重事件、按類型/嚴重度分組。"""
    cutoff_24h = datetime.now(timezone.utc) - timedelta(hours=24)

    total = (await db.execute(
        select(func.count(FactoryEvent.id))
    )).scalar_one()

    unresolved = (await db.execute(
        select(func.count(FactoryEvent.id))
        .where(FactoryEvent.resolved == False)   # noqa: E712
    )).scalar_one()

    critical_24h = (await db.execute(
        select(func.count(FactoryEvent.id))
        .where(FactoryEvent.severity == "critical")
        .where(FactoryEvent.created_at >= cutoff_24h)
    )).scalar_one()

    high_24h = (await db.execute(
        select(func.count(FactoryEvent.id))
        .where(FactoryEvent.severity == "high")
        .where(FactoryEvent.created_at >= cutoff_24h)
    )).scalar_one()

    # 按類型分組
    rows_type = await db.execute(
        select(FactoryEvent.event_type, func.count(FactoryEvent.id))
        .group_by(FactoryEvent.event_type)
    )
    by_type: dict[str, int] = {r[0]: r[1] for r in rows_type}

    # 按嚴重度分組
    rows_sev = await db.execute(
        select(FactoryEvent.severity, func.count(FactoryEvent.id))
        .group_by(FactoryEvent.severity)
    )
    by_severity: dict[str, int] = {r[0]: r[1] for r in rows_sev}

    return EventStats(
        total=total,
        unresolved=unresolved,
        critical_24h=critical_24h,
        high_24h=high_24h,
        by_type=by_type,
        by_severity=by_severity,
    )


@router.post("", response_model=EventOut, status_code=201)
async def create_event(
    payload: EventCreate,
    db:      AsyncSession = Depends(get_db),
):
    """手動建立工廠事件（source 預設為 manual）。"""
    event = FactoryEvent(
        id=str(uuid.uuid4()),
        **payload.model_dump(),
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


@router.patch("/{event_id}/acknowledge", response_model=EventOut)
async def acknowledge_event(
    event_id: str,
    db:       AsyncSession = Depends(get_db),
):
    """標記事件為已確認（acknowledged=True）。"""
    result = await db.execute(
        select(FactoryEvent).where(FactoryEvent.id == event_id)
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.acknowledged:
        raise HTTPException(status_code=409, detail="Event already acknowledged")

    event.acknowledged = True
    await db.commit()
    await db.refresh(event)
    return event


@router.patch("/{event_id}/resolve", response_model=EventOut)
async def resolve_event(
    event_id: str,
    db:       AsyncSession = Depends(get_db),
):
    """標記事件為已解決（resolved=True），並記錄 resolved_at 時間戳。"""
    result = await db.execute(
        select(FactoryEvent).where(FactoryEvent.id == event_id)
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.resolved:
        raise HTTPException(status_code=409, detail="Event already resolved")

    event.resolved    = True
    event.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(event)
    return event


@router.delete("/{event_id}", status_code=204)
async def delete_event(
    event_id: str,
    db:       AsyncSession = Depends(get_db),
):
    """永久刪除事件記錄（不可復原）。"""
    result = await db.execute(
        select(FactoryEvent).where(FactoryEvent.id == event_id)
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    await db.delete(event)
    await db.commit()
