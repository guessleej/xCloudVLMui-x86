"""
routers/pipeline.py — 四段式巡檢管線狀態 API
職責：聚合並回傳 Vision / Inference / RAG / Output 四段即時狀態

端點：
  GET /api/pipeline/status → 四段管線即時狀態（並行查詢）

管線四段說明：
  Stage 1  視覺取像   — VLM WebUI / WebRTC 服務健康
  Stage 2  邊緣推論   — llama.cpp API 健康 + 模型名稱
  Stage 3  知識整合   — ChromaDB 文件數 / 嵌入狀態
  Stage 4  維護輸出   — 24h 報告數 / 未解決警報數
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone, timedelta

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from database import get_db
from models.db_models import EquipmentAlert, RagDocument, Report
from models.schemas import PipelineStageOut, PipelineStatusOut

router   = APIRouter(prefix="/api/pipeline", tags=["pipeline"])
_settings = get_settings()


# ── 外部服務健康探測（並行）─────────────────────────────────────────

async def _probe_webui(url: str) -> tuple[bool, str]:
    """探測 VLM WebUI HTTP 服務"""
    try:
        async with httpx.AsyncClient(timeout=4.0) as c:
            r = await c.get(f"{url}/")
            return r.status_code < 500, f"HTTP {r.status_code}"
    except Exception as exc:
        return False, str(exc)[:60]


async def _probe_llm(url: str) -> tuple[bool, str, str]:
    """探測 llama.cpp 並取得當前載入模型名稱"""
    try:
        async with httpx.AsyncClient(timeout=4.0) as c:
            r = await c.get(f"{url}/v1/models")
            if r.status_code == 200:
                models = r.json().get("data", [])
                model  = models[0].get("id", "unknown") if models else "unknown"
                return True, model, ""
            return False, "", f"HTTP {r.status_code}"
    except Exception as exc:
        return False, "", str(exc)[:60]


def _stage_status(ok: bool, has_data: bool = True) -> tuple[str, str]:
    """依健康與資料狀況回傳 status / status_label"""
    if ok and has_data:
        return "online",  "線上"
    if ok:
        return "warning", "警告"
    return "offline", "離線"


@router.get("/status", response_model=PipelineStatusOut)
async def get_pipeline_status(db: AsyncSession = Depends(get_db)):
    """
    四段式巡檢管線即時狀態聚合。
    使用 asyncio.gather 並行查詢所有外部服務，最小化總延遲。
    """
    now = datetime.now(timezone.utc)

    # ── [並行] 外部服務探測 ───────────────────────────────────────────
    (webui_ok, _), (llm_ok, llm_model, _) = await asyncio.gather(
        _probe_webui(_settings.vlm_webui_url),
        _probe_llm(_settings.llm_base_url),
    )

    # ── [DB] RAG 文件統計 ────────────────────────────────────────────
    doc_total = await db.scalar(
        select(func.count()).select_from(RagDocument)
    ) or 0
    doc_embed = await db.scalar(
        select(func.count()).select_from(RagDocument)
        .where(RagDocument.embedded == True)   # noqa: E712
    ) or 0
    chunk_sum = int(
        await db.scalar(
            select(func.sum(RagDocument.chunk_count)).select_from(RagDocument)
        ) or 0
    )

    # ── [DB] 輸出層統計 ──────────────────────────────────────────────
    since_24h = now - timedelta(hours=24)
    rpt_24h   = await db.scalar(
        select(func.count()).select_from(Report)
        .where(Report.created_at >= since_24h, Report.is_deleted == False)   # noqa: E712
    ) or 0
    active_alerts = await db.scalar(
        select(func.count()).select_from(EquipmentAlert)
        .where(EquipmentAlert.resolved == False)   # noqa: E712
    ) or 0

    # ── 四段狀態組裝 ─────────────────────────────────────────────────
    s1_st, s1_sl = _stage_status(webui_ok)
    s2_st, s2_sl = _stage_status(llm_ok)
    s3_st, s3_sl = _stage_status(ok=True, has_data=doc_embed > 0)  # ChromaDB 本機，探測嵌入數
    s4_st, s4_sl = ("online", "線上")                               # 輸出層：後端活著即線上

    stages = [
        PipelineStageOut(
            stage=1, key="vision",
            label="視覺取像", subtitle="RealSense D455 / WebRTC",
            status=s1_st, status_label=s1_sl,
            metrics={
                "WebUI URL":  _settings.vlm_webui_url,
                "WebRTC":     "就緒" if webui_ok else "未啟動",
                "串流協定":   "WebRTC + RTP",
                "相機型號":   "Intel RealSense D455",
            },
            checked_at=now,
        ),
        PipelineStageOut(
            stage=2, key="inference",
            label="邊緣推論", subtitle="Gemma 4 E4B + llama.cpp",
            status=s2_st, status_label=s2_sl,
            metrics={
                "llama.cpp":  "就緒" if llm_ok else "未啟動",
                "模型":       llm_model or "未載入",
                "推論端點":   _settings.llm_base_url,
                "量化格式":   "GGUF Q4_K_M",
            },
            checked_at=now,
        ),
        PipelineStageOut(
            stage=3, key="rag",
            label="知識整合", subtitle="SEGMA RAG + SOP",
            status=s3_st, status_label=s3_sl,
            metrics={
                "知識文件":   f"{doc_total} 份",
                "已建立索引": f"{doc_embed} 份",
                "向量段落":   f"{chunk_sum} 段",
                "向量引擎":   "ChromaDB（本機）",
            },
            checked_at=now,
        ),
        PipelineStageOut(
            stage=4, key="output",
            label="維護輸出", subtitle="報告 / 工單 / LINE",
            status=s4_st, status_label=s4_sl,
            metrics={
                "24h 報告":   f"{rpt_24h} 份",
                "待處理警報": f"{active_alerts} 項",
                "輸出通道":   "報告 / 工單 / LINE Notify",
                "資料庫":     "SQLite（本機持久化）",
            },
            checked_at=now,
        ),
    ]

    # 整體狀態
    if not webui_ok or not llm_ok:
        overall = "offline"
    elif s3_st == "warning":
        overall = "degraded"
    else:
        overall = "online"

    return PipelineStatusOut(stages=stages, overall=overall, checked_at=now)
