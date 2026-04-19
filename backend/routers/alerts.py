"""
routers/alerts.py — 設備警報 CRUD API
職責：警報的查詢、新增、解除（resolve）、刪除

端點：
  GET    /api/alerts                     → 查詢警報列表（可過濾）
  POST   /api/alerts                     → 新增警報
  PATCH  /api/alerts/{alert_id}/resolve  → 標記已解除
  DELETE /api/alerts/{alert_id}          → 刪除警報

警報等級（level）：critical > elevated > moderate > low
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import EquipmentAlert
from models.schemas import AlertCreate, AlertOut

router = APIRouter(prefix="/api/alerts", tags=["alerts"])

# 嚴重度排序權重（數字越小越嚴重）
_LEVEL_ORDER: dict[str, int] = {
    "critical": 0,
    "elevated": 1,
    "moderate": 2,
    "low":      3,
}


@router.get("", response_model=list[AlertOut])
async def get_alerts(
    include_resolved: bool       = False,
    equipment_id:     str | None = None,
    level:            str | None = None,
    limit:            int        = 100,
    offset:           int        = 0,
    db:               AsyncSession = Depends(get_db),
):
    """
    取得警報列表。
    - include_resolved=false（預設）：只回傳未解決警報
    - equipment_id：過濾特定設備
    - level：過濾特定等級（critical / elevated / moderate / low）
    - 依 level 嚴重度 → created_at desc 排序
    """
    stmt = select(EquipmentAlert)
    if not include_resolved:
        stmt = stmt.where(EquipmentAlert.resolved == False)   # noqa: E712
    if equipment_id:
        stmt = stmt.where(EquipmentAlert.equipment_id == equipment_id)
    if level:
        stmt = stmt.where(EquipmentAlert.level == level)

    stmt = stmt.order_by(EquipmentAlert.created_at.desc())
    result = await db.execute(stmt)
    rows   = result.scalars().all()

    # 在 Python 側依嚴重度再排序（DB 端已按時間降序）
    rows_sorted = sorted(rows, key=lambda r: _LEVEL_ORDER.get(r.level, 9))

    # 手動分頁
    return rows_sorted[offset: offset + limit]


@router.get("/{alert_id}", response_model=AlertOut)
async def get_alert(
    alert_id: str,
    db:       AsyncSession = Depends(get_db),
):
    """取得單一警報詳情"""
    result = await db.execute(
        select(EquipmentAlert).where(EquipmentAlert.id == alert_id)
    )
    alert = result.scalar_one_or_none()
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


@router.post("", response_model=AlertOut, status_code=201)
async def create_alert(
    payload: AlertCreate,
    db:      AsyncSession = Depends(get_db),
):
    """
    新增警報。
    可由 VLM 推論、MQTT 閾值觸發或前端手動建立工單時呼叫。
    """
    alert = EquipmentAlert(
        id=             str(uuid.uuid4()),
        equipment_id=   payload.equipment_id,
        equipment_name= payload.equipment_name,
        level=          payload.level,
        message=        payload.message,
        created_at=     datetime.now(timezone.utc),
        resolved=       False,
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)
    return alert


@router.patch("/{alert_id}/resolve", response_model=AlertOut)
async def resolve_alert(
    alert_id: str,
    db:       AsyncSession = Depends(get_db),
):
    """
    標記警報為已解除（resolved=True）。
    自動記錄 resolved_at 時間戳。
    """
    result = await db.execute(
        select(EquipmentAlert).where(EquipmentAlert.id == alert_id)
    )
    alert = result.scalar_one_or_none()
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    if alert.resolved:
        raise HTTPException(status_code=409, detail="Alert already resolved")

    alert.resolved    = True
    alert.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(alert)
    return alert


@router.delete("/{alert_id}", status_code=204)
async def delete_alert(
    alert_id: str,
    db:       AsyncSession = Depends(get_db),
):
    """永久刪除警報記錄（不可復原）"""
    result = await db.execute(
        select(EquipmentAlert).where(EquipmentAlert.id == alert_id)
    )
    alert = result.scalar_one_or_none()
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    await db.delete(alert)
    await db.commit()
