"""
routers/dashboard.py — ⚠️ 已棄用：向後相容墊片（Deprecated Shim）
=====================================================================
新路由（v1.1.0+）：
  設備管理  →  /api/equipment
  VHS 趨勢  →  /api/vhs
  警報管理  →  /api/alerts
  管線狀態  →  /api/pipeline

本檔案保留 /api/dashboard/* 舊路由以維持前端向後相容，將於 v1.3.0 移除。
=====================================================================
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.schemas import (
    AlertCreate, AlertOut,
    EquipmentOut, EquipmentSummary,
    PipelineStatusOut,
    VhsReadingCreate, VhsReadingOut, VhsTrendMeta,
)

# ── 直接委派至新 Router Handler ─────────────────────────────────────
from routers.equipment import get_equipment_summary, list_equipment
from routers.vhs       import get_vhs_trend, create_vhs_reading
from routers.alerts    import get_alerts, create_alert, resolve_alert, delete_alert
from routers.pipeline  import get_pipeline_status

router = APIRouter(prefix="/api/dashboard", tags=["dashboard (deprecated)"])


# ── 設備 ──────────────────────────────────────────────────────────────
router.add_api_route(
    "/summary",
    get_equipment_summary,
    methods=["GET"],
    response_model=EquipmentSummary,
    summary="[deprecated] 設備統計 → 請改用 GET /api/equipment/summary",
)

router.add_api_route(
    "/equipment",
    list_equipment,
    methods=["GET"],
    response_model=list[EquipmentOut],
    summary="[deprecated] 設備清單 → 請改用 GET /api/equipment",
)


# ── 警報 ──────────────────────────────────────────────────────────────
router.add_api_route(
    "/alerts",
    get_alerts,
    methods=["GET"],
    response_model=list[AlertOut],
    summary="[deprecated] 警報列表 → 請改用 GET /api/alerts",
)

router.add_api_route(
    "/alerts",
    create_alert,
    methods=["POST"],
    response_model=AlertOut,
    status_code=201,
    summary="[deprecated] 新增警報 → 請改用 POST /api/alerts",
)

router.add_api_route(
    "/alerts/{alert_id}/resolve",
    resolve_alert,
    methods=["PATCH"],
    response_model=AlertOut,
    summary="[deprecated] 解除警報 → 請改用 PATCH /api/alerts/{alert_id}/resolve",
)

router.add_api_route(
    "/alerts/{alert_id}",
    delete_alert,
    methods=["DELETE"],
    status_code=204,
    summary="[deprecated] 刪除警報 → 請改用 DELETE /api/alerts/{alert_id}",
)


# ── VHS ───────────────────────────────────────────────────────────────
router.add_api_route(
    "/vhs-trend/{equipment_id}",
    get_vhs_trend,
    methods=["GET"],
    response_model=VhsTrendMeta,
    summary="[deprecated] VHS 趨勢 → 請改用 GET /api/vhs/trend/{equipment_id}",
)

router.add_api_route(
    "/vhs-readings",
    create_vhs_reading,
    methods=["POST"],
    response_model=VhsReadingOut,
    status_code=201,
    summary="[deprecated] 寫入 VHS 評分 → 請改用 POST /api/vhs/readings",
)


# ── Pipeline ──────────────────────────────────────────────────────────
router.add_api_route(
    "/pipeline-status",
    get_pipeline_status,
    methods=["GET"],
    response_model=PipelineStatusOut,
    summary="[deprecated] 管線狀態 → 請改用 GET /api/pipeline/status",
)
