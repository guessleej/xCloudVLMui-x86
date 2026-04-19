"""
routers/rag.py — ⚠️ 已棄用：向後相容墊片（Deprecated Shim）
=====================================================================
新路由（v1.1.0+）：
  問答   →  POST /api/chat/query
  文件管理 → /api/knowledge/documents

本檔案保留 /api/rag/* 舊路由以維持前端向後相容，將於 v1.3.0 移除。
=====================================================================
"""
import logging
from fastapi import APIRouter, Depends, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.schemas import RagQueryRequest, RagQueryResponse, RagDocumentOut

# ── 直接委派至新 Router Handler ─────────────────────────────────────
from routers.chat      import query_chat
from routers.knowledge import (
    list_documents,
    upload_document,
    upload_image_document,
    remove_document,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rag", tags=["rag (deprecated)"])


# ── 向後相容路由別名 ──────────────────────────────────────────────────
# 直接掛載新 handler 函式，確保行為與新路由完全一致

router.add_api_route(
    "/query",
    query_chat,
    methods=["POST"],
    response_model=RagQueryResponse,
    summary="[deprecated] 語意搜尋問答 → 請改用 POST /api/chat/query",
)

router.add_api_route(
    "/documents",
    list_documents,
    methods=["GET"],
    response_model=list[RagDocumentOut],
    summary="[deprecated] 文件列表 → 請改用 GET /api/knowledge/documents",
)

router.add_api_route(
    "/documents/upload",
    upload_document,
    methods=["POST"],
    response_model=RagDocumentOut,
    status_code=201,
    summary="[deprecated] 上傳文件 → 請改用 POST /api/knowledge/documents/upload",
)

router.add_api_route(
    "/documents/upload-image",
    upload_image_document,
    methods=["POST"],
    response_model=RagDocumentOut,
    status_code=201,
    summary="[deprecated] 上傳圖片 → 請改用 POST /api/knowledge/documents/upload-image",
)

router.add_api_route(
    "/documents/{doc_id}",
    remove_document,
    methods=["DELETE"],
    status_code=204,
    summary="[deprecated] 刪除文件 → 請改用 DELETE /api/knowledge/documents/{doc_id}",
)
