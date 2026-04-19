"""
routers/_shared_data.py — 跨 Router 共用的設備資料輔助模組

說明：
  - _EQUIPMENT 為 6 台模擬設備（v1.2 接入 Equipment DB 前的 Mock 資料）
  - estimate_vhs_score 保留供 VHS 趨勢計算使用
"""
from __future__ import annotations

import math
from models.schemas import EquipmentOut

# ── 設備清單（6 台模擬設備；v1.2 改為真實 DB 驅動）──────────────────────
_EQUIPMENT: list[EquipmentOut] = [
    EquipmentOut(
        id="AIR-030-01",
        name="壓縮機 #1",
        type="compressor",
        location="廠房A",
        status="critical",
        vhs_score=28.5,
        active_alerts=3,
        last_inspection=None,
    ),
    EquipmentOut(
        id="AIR-030-02",
        name="壓縮機 #2",
        type="compressor",
        location="廠房A",
        status="warning",
        vhs_score=61.2,
        active_alerts=1,
        last_inspection=None,
    ),
    EquipmentOut(
        id="AIR-030-03",
        name="冷卻水塔",
        type="cooling",
        location="廠房B",
        status="normal",
        vhs_score=88.4,
        active_alerts=0,
        last_inspection=None,
    ),
    EquipmentOut(
        id="AIR-030-04",
        name="送風機 #1",
        type="fan",
        location="廠房B",
        status="normal",
        vhs_score=91.7,
        active_alerts=0,
        last_inspection=None,
    ),
    EquipmentOut(
        id="AIR-030-05",
        name="電控盤 #1",
        type="panel",
        location="控制室",
        status="offline",
        vhs_score=54.9,
        active_alerts=0,
        last_inspection=None,
    ),
    EquipmentOut(
        id="AIR-030-06",
        name="油壓泵浦",
        type="pump",
        location="廠房C",
        status="warning",
        vhs_score=48.3,
        active_alerts=2,
        last_inspection=None,
    ),
]


def estimate_vhs_score(base: float, day_offset: int, total_days: int) -> float:
    """根據設備當前分數估算歷史趨勢（確定性計算，無隨機）"""
    decay     = day_offset * (100 - base) / (total_days * 6)
    variation = math.sin(day_offset * 0.7) * 3
    return round(max(5.0, min(100.0, base - decay + variation)), 1)
