"""
routers/feature_flags.py — Feature Flag 管理 API
==================================================
功能開關（Feature Flags）允許在不部署新程式碼的情況下，
動態啟用 / 停用功能，支援漸進式推出（rollout_pct）。

端點：
  GET  /api/settings/feature-flags           → 所有旗標清單 + enabled_map
  GET  /api/settings/feature-flags/{key}     → 單一旗標
  PUT  /api/settings/feature-flags/{key}     → 更新旗標（enabled / rollout_pct / metadata）
  POST /api/settings/feature-flags/{key}/toggle → 切換 enabled 狀態

預設旗標（首次存取時自動植入）：
  ff.line_notify     — LINE Notify 推播通知
  ff.auto_report     — VLM 分析完成後自動生成報告
  ff.vlm_ocr         — 圖片上傳使用 VLM OCR
  ff.mqtt_alert      — MQTT 感測器閾值自動警報
  ff.rag_rerank      — RAG 查詢結果重排序（v1.2.0）
  ff.dark_mode       — 前端暗色主題（預設啟用）
"""
from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import FeatureFlag
from models.schemas import FeatureFlagBulkResponse, FeatureFlagOut, FeatureFlagUpdate

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/settings/feature-flags", tags=["feature-flags"])


# ── 預設旗標定義 ──────────────────────────────────────────────────────

_DEFAULT_FLAGS: list[dict] = [
    {
        "key":         "ff.line_notify",
        "enabled":     False,
        "rollout_pct": 100,
        "description": "LINE Notify 推播通知（警報等級 critical / elevated 時發送）",
        "metadata":    {"webhook_url": "", "notify_levels": ["critical", "elevated"]},
    },
    {
        "key":         "ff.auto_report",
        "enabled":     True,
        "rollout_pct": 100,
        "description": "VLM 視覺分析完成後自動生成維修報告",
        "metadata":    {"min_risk_level": "moderate"},
    },
    {
        "key":         "ff.vlm_ocr",
        "enabled":     True,
        "rollout_pct": 100,
        "description": "圖片上傳使用 Gemma VLM 進行 OCR 文字擷取",
        "metadata":    None,
    },
    {
        "key":         "ff.mqtt_alert",
        "enabled":     True,
        "rollout_pct": 100,
        "description": "MQTT 感測器讀值超出閾值時自動建立 EquipmentAlert",
        "metadata":    {"debounce_sec": 30},
    },
    {
        "key":         "ff.rag_rerank",
        "enabled":     False,
        "rollout_pct": 0,
        "description": "RAG 查詢結果使用 cross-encoder 重排序（v1.2.0 功能預留）",
        "metadata":    {"model": "cross-encoder/ms-marco-MiniLM-L-6-v2"},
    },
    {
        "key":         "ff.dark_mode",
        "enabled":     True,
        "rollout_pct": 100,
        "description": "前端儀表板暗色主題（由前端讀取此旗標決定預設值）",
        "metadata":    None,
    },
]


async def _seed_defaults(db: AsyncSession) -> None:
    """首次存取時植入預設旗標（幂等操作）"""
    for flag_def in _DEFAULT_FLAGS:
        result = await db.execute(
            select(FeatureFlag).where(FeatureFlag.key == flag_def["key"])
        )
        if result.scalar_one_or_none() is None:
            db.add(FeatureFlag(
                id=           str(uuid.uuid4()),
                key=          flag_def["key"],
                enabled=      flag_def["enabled"],
                rollout_pct=  flag_def["rollout_pct"],
                description=  flag_def["description"],
                extra_config= flag_def["metadata"],
            ))
    await db.commit()


# ── 端點 ──────────────────────────────────────────────────────────────

@router.get("", response_model=FeatureFlagBulkResponse)
async def list_feature_flags(db: AsyncSession = Depends(get_db)):
    """
    取得所有 Feature Flags。
    首次呼叫時自動植入預設旗標。
    回應包含 `enabled_map`（key→bool）供前端快速查詢。
    """
    await _seed_defaults(db)
    result = await db.execute(select(FeatureFlag).order_by(FeatureFlag.key))
    flags  = result.scalars().all()
    return FeatureFlagBulkResponse(
        flags=       [FeatureFlagOut.model_validate(f) for f in flags],
        enabled_map= {f.key: f.enabled for f in flags},
    )


@router.get("/{key}", response_model=FeatureFlagOut)
async def get_feature_flag(key: str, db: AsyncSession = Depends(get_db)):
    """取得單一 Feature Flag 詳細資訊"""
    result = await db.execute(select(FeatureFlag).where(FeatureFlag.key == key))
    flag   = result.scalar_one_or_none()
    if flag is None:
        raise HTTPException(status_code=404, detail=f"Feature flag '{key}' not found")
    return flag


@router.put("/{key}", response_model=FeatureFlagOut)
async def update_feature_flag(
    key:     str,
    payload: FeatureFlagUpdate,
    db:      AsyncSession = Depends(get_db),
):
    """
    更新 Feature Flag。
    若旗標不存在則自動建立（upsert）。
    只更新傳入的非 None 欄位。
    """
    result = await db.execute(select(FeatureFlag).where(FeatureFlag.key == key))
    flag   = result.scalar_one_or_none()

    if flag is None:
        # 不在預設清單中的自訂旗標 → 動態建立
        flag = FeatureFlag(
            id=           str(uuid.uuid4()),
            key=          key,
            enabled=      payload.enabled if payload.enabled is not None else False,
            rollout_pct=  payload.rollout_pct if payload.rollout_pct is not None else 100,
            description=  payload.description,
            extra_config= payload.metadata,
        )
        db.add(flag)
        logger.info("Feature flag created: key=%s enabled=%s", key, flag.enabled)
    else:
        if payload.enabled     is not None: flag.enabled     = payload.enabled
        if payload.rollout_pct is not None: flag.rollout_pct = payload.rollout_pct
        if payload.description is not None: flag.description = payload.description
        if payload.metadata    is not None: flag.extra_config = payload.metadata
        logger.info("Feature flag updated: key=%s enabled=%s", key, flag.enabled)

    await db.commit()
    await db.refresh(flag)
    return flag


@router.post("/{key}/toggle", response_model=FeatureFlagOut)
async def toggle_feature_flag(key: str, db: AsyncSession = Depends(get_db)):
    """
    切換 Feature Flag 的 enabled 狀態（True ↔ False）。
    旗標不存在時回傳 404。
    """
    result = await db.execute(select(FeatureFlag).where(FeatureFlag.key == key))
    flag   = result.scalar_one_or_none()
    if flag is None:
        raise HTTPException(status_code=404, detail=f"Feature flag '{key}' not found")

    flag.enabled = not flag.enabled
    await db.commit()
    await db.refresh(flag)
    logger.info("Feature flag toggled: key=%s enabled=%s", key, flag.enabled)
    return flag
