"""
routers/vision.py — 視覺分析會話管理
  POST   /api/vision/sessions        — 儲存一次合併分析（YOLO + VLM）
  GET    /api/vision/sessions        — 列出歷史會話（可按 mode 篩選）
  GET    /api/vision/sessions/{id}   — 取得單一會話
  DELETE /api/vision/sessions/{id}   — 刪除會話
  GET    /api/vision/stats           — 統計摘要
"""
from __future__ import annotations
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import VisionSession
from models.schemas import VisionSessionCreate, VisionSessionOut, VisionStats
from services.event_service import auto_create_events

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/vision", tags=["vision"])


@router.post("/sessions", response_model=VisionSessionOut, status_code=201)
async def create_session(
    payload: VisionSessionCreate,
    db:      AsyncSession = Depends(get_db),
):
    """儲存一次視覺分析會話（YOLO 偵測 + VLM 分析合併）"""
    row = VisionSession(
        id=str(uuid.uuid4()),
        **payload.model_dump(),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    logger.info("Vision session saved: mode=%s risk=%s persons=%d",
                row.mode, row.risk_level, row.person_count)
    try:
        await auto_create_events(db, row)
    except Exception as _e:
        logger.warning("Auto-create events failed (non-fatal): %s", _e)
    return row


@router.get("/sessions", response_model=list[VisionSessionOut])
async def list_sessions(
    mode:   Optional[str] = Query(None, description="equipment|people|events|objects"),
    limit:  int           = Query(50,  ge=1, le=500),
    offset: int           = Query(0,   ge=0),
    db:     AsyncSession  = Depends(get_db),
):
    """列出視覺分析歷史（最新優先）"""
    q = (
        select(VisionSession)
        .order_by(desc(VisionSession.created_at))
        .offset(offset)
        .limit(limit)
    )
    if mode:
        q = q.where(VisionSession.mode == mode)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/sessions/{session_id}", response_model=VisionSessionOut)
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)):
    row = await db.get(VisionSession, session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    return row


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str, db: AsyncSession = Depends(get_db)):
    row = await db.get(VisionSession, session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.delete(row)
    await db.commit()


@router.get("/stats", response_model=VisionStats)
async def get_stats(db: AsyncSession = Depends(get_db)):
    """取得視覺分析統計摘要"""
    # 總數
    total = (await db.execute(select(func.count(VisionSession.id)))).scalar_one()

    # 按模式分組
    rows = await db.execute(
        select(VisionSession.mode, func.count(VisionSession.id))
        .group_by(VisionSession.mode)
    )
    by_mode: dict[str, int] = {r[0]: r[1] for r in rows}

    # 按風險等級分組
    rows = await db.execute(
        select(VisionSession.risk_level, func.count(VisionSession.id))
        .group_by(VisionSession.risk_level)
    )
    by_risk: dict[str, int] = {(r[0] or "unknown"): r[1] for r in rows}

    # 設備模式 VHS 平均分
    avg_vhs_raw = (await db.execute(
        select(func.avg(VisionSession.vhs_score))
        .where(VisionSession.mode == "equipment")
        .where(VisionSession.vhs_score.is_not(None))
    )).scalar_one()

    # 近 24h 高風險（critical）事件數
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    hazards = (await db.execute(
        select(func.count(VisionSession.id))
        .where(VisionSession.risk_level == "critical")
        .where(VisionSession.created_at >= cutoff)
    )).scalar_one()

    # 累計人員偵測次數
    person_total_raw = (await db.execute(
        select(func.sum(VisionSession.person_count))
    )).scalar_one()

    return VisionStats(
        total_sessions=total,
        by_mode=by_mode,
        by_risk=by_risk,
        avg_vhs_score=float(avg_vhs_raw) if avg_vhs_raw is not None else None,
        recent_hazards_24h=hazards,
        total_person_detections=int(person_total_raw or 0),
    )
