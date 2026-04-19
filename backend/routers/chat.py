"""
routers/chat.py — RAG 問答 API + 歷史記錄 CRUD
職責：
  - 接收使用者問題，語意搜尋知識庫後由 Gemma 4 E4B 生成回答
  - 每次問答自動儲存到 chat_history 資料表
  - 提供歷史查詢、備註修改與刪除端點

端點：
  POST   /api/chat/query           → 問答 + 自動存歷史
  GET    /api/chat/history         → 查詢歷史列表（分頁）
  PATCH  /api/chat/history/{id}    → 修改備註
  DELETE /api/chat/history/{id}    → 軟刪除
  DELETE /api/chat/history         → 清空全部歷史（軟刪除）
"""
from __future__ import annotations

import uuid
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from database import get_db
from models.db_models import ChatHistory
from models.schemas import (
    RagQueryRequest, RagQueryResponse,
    ChatHistoryOut, ChatHistoryUpdate, ChatHistoryListResponse,
)
from services.rag_service import rag_query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])


# ═══════════════════════════════════════════════════════════════════════
#  問答端點（自動存歷史）
# ═══════════════════════════════════════════════════════════════════════

@router.post("/query", response_model=RagQueryResponse)
async def query_chat(
    payload: RagQueryRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    RAG 問答：
      1. 語意搜尋 ChromaDB 最相關的 top_k 段落
      2. 將段落作為 Context 送入 Gemma 4 E4B 生成回答
      3. 自動儲存問答記錄至 chat_history
      4. 回傳答案、來源段落列表及推論延遲
    """
    if not payload.question.strip():
        raise HTTPException(status_code=422, detail="question 不能為空")

    answer, sources, latency = await rag_query(
        question= payload.question,
        top_k=    payload.top_k,
    )

    # ── 自動儲存歷史（非同步，失敗不影響回應）────────────────────────
    try:
        history = ChatHistory(
            id=         str(uuid.uuid4()),
            session_id= getattr(payload, "session_id", None),
            question=   payload.question.strip(),
            answer=     answer,
            sources=    sources,
            latency_ms= int(latency) if latency else None,
        )
        db.add(history)
        await db.commit()
    except Exception as _e:
        logger.warning("[ChatHistory] 儲存失敗（不影響問答）：%s", _e)
        await db.rollback()

    return RagQueryResponse(
        answer=     answer,
        sources=    sources,
        latency_ms= latency,
    )


# ═══════════════════════════════════════════════════════════════════════
#  歷史記錄 CRUD
# ═══════════════════════════════════════════════════════════════════════

@router.get("/history", response_model=ChatHistoryListResponse)
async def list_history(
    session_id: Optional[str] = Query(None,  description="過濾特定 session"),
    q:          Optional[str] = Query(None,  description="問題關鍵字搜尋"),
    limit:      int           = Query(50,   ge=1,  le=200),
    offset:     int           = Query(0,    ge=0),
    db: AsyncSession = Depends(get_db),
):
    """查詢知識庫問答歷史（排除軟刪除，降序排列）"""
    conditions = [ChatHistory.is_deleted == False]

    if session_id:
        conditions.append(ChatHistory.session_id == session_id)
    if q:
        conditions.append(ChatHistory.question.ilike(f"%{q}%"))

    # 計算總筆數
    total_stmt = select(func.count()).where(and_(*conditions)).select_from(ChatHistory)
    total_row  = await db.execute(total_stmt)
    total      = total_row.scalar_one()

    # 查詢資料
    stmt = (
        select(ChatHistory)
        .where(and_(*conditions))
        .order_by(ChatHistory.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = await db.execute(stmt)
    items = rows.scalars().all()

    return ChatHistoryListResponse(
        total= total,
        items= [ChatHistoryOut.model_validate(item) for item in items],
    )


@router.patch("/history/{history_id}", response_model=ChatHistoryOut)
async def update_history(
    history_id: str,
    payload:    ChatHistoryUpdate,
    db:         AsyncSession = Depends(get_db),
):
    """修改歷史記錄的備註欄位（notes）"""
    stmt = select(ChatHistory).where(
        ChatHistory.id == history_id,
        ChatHistory.is_deleted == False,
    )
    row = await db.execute(stmt)
    item = row.scalar_one_or_none()

    if not item:
        raise HTTPException(status_code=404, detail="歷史記錄不存在")

    if payload.notes is not None:
        item.notes = payload.notes.strip() or None

    await db.commit()
    await db.refresh(item)
    return ChatHistoryOut.model_validate(item)


@router.delete("/history/{history_id}", status_code=204)
async def delete_history(
    history_id: str,
    db:         AsyncSession = Depends(get_db),
):
    """軟刪除單筆歷史記錄"""
    stmt = select(ChatHistory).where(
        ChatHistory.id == history_id,
        ChatHistory.is_deleted == False,
    )
    row  = await db.execute(stmt)
    item = row.scalar_one_or_none()

    if not item:
        raise HTTPException(status_code=404, detail="歷史記錄不存在")

    item.is_deleted = True
    await db.commit()


@router.delete("/history", status_code=204)
async def clear_all_history(
    session_id: Optional[str] = Query(None, description="僅清空特定 session；省略則清空全部"),
    db: AsyncSession = Depends(get_db),
):
    """批量軟刪除全部歷史（或指定 session）"""
    conditions = [ChatHistory.is_deleted == False]
    if session_id:
        conditions.append(ChatHistory.session_id == session_id)

    stmt = select(ChatHistory).where(and_(*conditions))
    rows = await db.execute(stmt)
    items = rows.scalars().all()

    for item in items:
        item.is_deleted = True

    await db.commit()
    logger.info("[ChatHistory] 批量清空 %d 筆歷史記錄", len(items))
