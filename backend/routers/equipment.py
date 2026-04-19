"""
routers/equipment.py — 設備管理 API
職責：設備清單查詢、設備統計摘要

端點：
  GET  /api/equipment         → 取得全部設備清單
  GET  /api/equipment/summary → 取得設備統計（total/normal/warning/critical/offline）

備註：
  設備資料由真實 DB / MQTT 寫入產生（v1.2 接入 Equipment DB 資料表）。
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.schemas import EquipmentOut, EquipmentSummary
from routers._shared_data import _EQUIPMENT

router = APIRouter(prefix="/api/equipment", tags=["equipment"])


@router.get("/summary", response_model=EquipmentSummary)
async def get_equipment_summary(db: AsyncSession = Depends(get_db)):
    """設備統計摘要：各狀態設備數量。"""
    return EquipmentSummary(
        total=    len(_EQUIPMENT),
        normal=   sum(1 for e in _EQUIPMENT if e.status == "normal"),
        warning=  sum(1 for e in _EQUIPMENT if e.status == "warning"),
        critical= sum(1 for e in _EQUIPMENT if e.status == "critical"),
        offline=  sum(1 for e in _EQUIPMENT if e.status == "offline"),
    )


@router.get("", response_model=list[EquipmentOut])
async def list_equipment():
    """取得所有設備清單（含 VHS 分數與即時警報數）"""
    return _EQUIPMENT


@router.get("/{equipment_id}", response_model=EquipmentOut)
async def get_equipment(equipment_id: str):
    """取得單一設備詳情"""
    from fastapi import HTTPException
    equip = next((e for e in _EQUIPMENT if e.id == equipment_id), None)
    if equip is None:
        raise HTTPException(status_code=404, detail=f"Equipment '{equipment_id}' not found")
    return equip
