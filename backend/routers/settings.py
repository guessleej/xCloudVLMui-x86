"""
routers/settings.py — 系統設定管理（OCR 引擎、Embedding 模型、LLM 模型）

設定生效機制：
  1. DB 儲存（持久）：寫入 SQLite 的 system_settings 表
  2. Live 套用（即時）：同步更新 config.py 的 in-memory Settings 物件，
     讓 embedding_service / rag_service 無需重啟即可使用新值。
  3. 啟動載入：app 啟動時讀取 DB 設定並套用，覆蓋 env var 預設值。
"""
from __future__ import annotations
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import SystemSettings
from models.schemas import SettingsOut, SettingsUpdate, SettingItem

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/settings", tags=["settings"])

# 預設設定（與 config.py 預設值一致）
_DEFAULT_SETTINGS: dict[str, str] = {
    "ocr_engine":       "vlm",
    "embed_model_url":  "",
    "embed_model_name": "nomic-embed-text",   # Ollama 向量嵌入模型
    "llm_model_url":    "",
    "llm_model_name":   "gemma4:e4b",         # Ollama 語言模型
    "chunk_size":       "800",
    "chunk_overlap":    "100",
    "rag_top_k":        "5",
}

# DB key → config.py Settings 屬性 對應表
_DB_TO_CONFIG: dict[str, str] = {
    "embed_model_name": "embed_model",
    "llm_model_name":   "llm_model",
    "llm_model_url":    "llm_base_url",    # 非空才覆蓋
}


def apply_settings_to_live_config(updates: dict[str, str]) -> None:
    """
    將 DB 設定同步套用到 in-memory config 物件（lru_cache singleton）。
    讓 embedding_service / rag_service 不需重啟即可使用新值。
    """
    try:
        from config import get_settings
        live = get_settings()
        for db_key, value in updates.items():
            attr = _DB_TO_CONFIG.get(db_key)
            if not attr or not value:
                continue
            # db_key="llm_model_url" 只在非空時才覆蓋 llm_base_url
            if db_key == "llm_model_url" and not value.strip():
                continue
            try:
                object.__setattr__(live, attr, value)
                logger.info("Live config updated: %s = %s", attr, value)
            except Exception as e:
                logger.warning("Could not apply %s→%s: %s", db_key, attr, e)
    except Exception as e:
        logger.error("apply_settings_to_live_config failed: %s", e)

_DESCRIPTIONS: dict[str, str] = {
    "ocr_engine":       "圖片文字辨識引擎（vlm = 使用 Gemma 視覺模型 | disabled = 停用 OCR）",
    "embed_model_url":  "向量嵌入端點 URL（留空使用 config.py 預設值）",
    "embed_model_name": "向量嵌入模型名稱",
    "llm_model_url":    "語言模型端點 URL（留空使用 config.py 預設值）",
    "llm_model_name":   "語言模型名稱",
    "chunk_size":       "文件切片大小（字元數）",
    "chunk_overlap":    "相鄰切片重疊字元數",
    "rag_top_k":        "語意搜尋回傳最大段落數",
}


async def _get_all_settings(db: AsyncSession) -> dict[str, str]:
    """從資料庫讀取所有設定，不存在的 key 使用預設值"""
    result = await db.execute(select(SystemSettings))
    rows   = {r.key: r.value for r in result.scalars().all()}
    merged = dict(_DEFAULT_SETTINGS)
    merged.update({k: v for k, v in rows.items() if v is not None})
    return merged


@router.get("", response_model=SettingsOut)
async def get_settings(db: AsyncSession = Depends(get_db)):
    """取得目前系統設定"""
    s = await _get_all_settings(db)
    return SettingsOut(
        ocr_engine=        s.get("ocr_engine",       "vlm"),
        embed_model_url=   s.get("embed_model_url",  ""),
        embed_model_name=  s.get("embed_model_name", "gemma-4-e4b-it"),
        llm_model_url=     s.get("llm_model_url",    ""),
        llm_model_name=    s.get("llm_model_name",   "gemma-4-e4b-it"),
        chunk_size=        int(s.get("chunk_size",    "800")),
        chunk_overlap=     int(s.get("chunk_overlap", "100")),
        rag_top_k=         int(s.get("rag_top_k",     "5")),
    )


@router.put("", response_model=SettingsOut)
async def update_settings(
    payload: SettingsUpdate,
    db:      AsyncSession = Depends(get_db),
):
    """更新系統設定（只更新傳入的欄位）"""
    updates: dict[str, str] = {}
    if payload.ocr_engine       is not None: updates["ocr_engine"]       = payload.ocr_engine
    if payload.embed_model_url  is not None: updates["embed_model_url"]  = payload.embed_model_url
    if payload.embed_model_name is not None: updates["embed_model_name"] = payload.embed_model_name
    if payload.llm_model_url    is not None: updates["llm_model_url"]    = payload.llm_model_url
    if payload.llm_model_name   is not None: updates["llm_model_name"]   = payload.llm_model_name
    if payload.chunk_size       is not None: updates["chunk_size"]       = str(payload.chunk_size)
    if payload.chunk_overlap    is not None: updates["chunk_overlap"]    = str(payload.chunk_overlap)
    if payload.rag_top_k        is not None: updates["rag_top_k"]        = str(payload.rag_top_k)

    for key, value in updates.items():
        result = await db.execute(select(SystemSettings).where(SystemSettings.key == key))
        row    = result.scalar_one_or_none()
        if row:
            row.value = value
        else:
            db.add(SystemSettings(
                id=          str(uuid.uuid4()),
                key=         key,
                value=       value,
                description= _DESCRIPTIONS.get(key),
            ))

    await db.commit()
    logger.info("Settings updated: %s", list(updates.keys()))

    # ── 即時套用到 in-memory config（不需重啟）──────────────────────
    apply_settings_to_live_config(updates)

    return await get_settings(db)


@router.post("/reset", response_model=SettingsOut)
async def reset_settings(db: AsyncSession = Depends(get_db)):
    """重置所有設定為預設值"""
    result = await db.execute(select(SystemSettings))
    for row in result.scalars().all():
        await db.delete(row)
    await db.commit()
    logger.info("Settings reset to defaults.")

    # ── 套用預設值到 live config ────────────────────────────────────
    apply_settings_to_live_config(_DEFAULT_SETTINGS)

    return await get_settings(db)
