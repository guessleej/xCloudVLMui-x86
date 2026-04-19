"""
routers/knowledge.py — 知識文件管理 API
職責：RAG 知識庫的文件上傳、列表查詢、刪除

端點：
  GET    /api/knowledge/documents                  → 文件列表
  POST   /api/knowledge/documents/upload           → 上傳文字文件（PDF/TXT/MD/CSV）
  POST   /api/knowledge/documents/upload-image     → 上傳圖片（OCR → 嵌入）
  DELETE /api/knowledge/documents/{doc_id}         → 刪除文件
"""
from __future__ import annotations

import io
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import RagDocument
from models.schemas import RagDocumentOut
from services.rag_service import embed_document, delete_document

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])

# 支援格式
_ALLOWED_TYPES = {"application/pdf", "text/plain", "text/markdown", "text/csv"}
_UPLOAD_DIR    = Path("./uploads")
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ── 文件列表 ──────────────────────────────────────────────────────────

@router.get("/documents", response_model=list[RagDocumentOut])
async def list_documents(db: AsyncSession = Depends(get_db)):
    """取得所有知識文件列表（依建立時間降序）"""
    result = await db.execute(
        select(RagDocument).order_by(RagDocument.created_at.desc())
    )
    docs = result.scalars().all()
    return [
        RagDocumentOut(
            id=          d.id,
            filename=    d.filename,
            file_type=   d.file_type,
            file_size=   d.file_size,
            description= d.description,
            chunk_count= d.chunk_count,
            embedded=    d.embedded,
            created_at=  d.created_at.isoformat(),
        )
        for d in docs
    ]


# ── 文字文件上傳 ─────────────────────────────────────────────────────

@router.post("/documents/upload", response_model=RagDocumentOut, status_code=201)
async def upload_document(
    file:        UploadFile      = File(...),
    description: str             = Form(default=""),
    db:          AsyncSession    = Depends(get_db),
):
    """
    上傳文件（PDF / TXT / MD / CSV）並自動切片嵌入 ChromaDB。
    """
    content_type = file.content_type or "application/octet-stream"
    suffix       = Path(file.filename or "file").suffix.lower()

    if content_type not in _ALLOWED_TYPES and suffix not in {".pdf", ".txt", ".md", ".csv"}:
        raise HTTPException(
            status_code=415,
            detail=f"不支援的檔案格式：{content_type}。請上傳 PDF / TXT / MD / CSV。",
        )

    raw       = await file.read()
    file_size = len(raw)
    doc_id    = str(uuid.uuid4())

    # ── 儲存原始檔 ──────────────────────────────────────────────────
    save_path = _UPLOAD_DIR / f"{doc_id}{suffix}"
    save_path.write_bytes(raw)

    # ── 文字提取 + 切片 ────────────────────────────────────────────
    chunks = _extract_chunks(raw, suffix)

    # ── 嵌入 ChromaDB ──────────────────────────────────────────────
    chunk_count = 0
    embedded    = False
    try:
        metas       = [{"page": i // 3 + 1} for i in range(len(chunks))]
        chunk_count = await embed_document(doc_id, file.filename or "file", chunks, metas)
        embedded    = chunk_count > 0
    except Exception as e:
        logger.error("Embedding failed for %s: %s", file.filename, str(e))

    # ── 存入 SQLite ────────────────────────────────────────────────
    doc = RagDocument(
        id=          doc_id,
        filename=    file.filename or "unnamed",
        file_type=   suffix.lstrip(".") or "bin",
        file_size=   file_size,
        description= description,
        chunk_count= chunk_count,
        embedded=    embedded,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    return RagDocumentOut(
        id=          doc.id,
        filename=    doc.filename,
        file_type=   doc.file_type,
        file_size=   doc.file_size,
        description= doc.description,
        chunk_count= doc.chunk_count,
        embedded=    doc.embedded,
        created_at=  doc.created_at.isoformat(),
    )


# ── 圖片文件上傳（OCR）──────────────────────────────────────────────

@router.post("/documents/upload-image", response_model=RagDocumentOut, status_code=201)
async def upload_image_document(
    file:        UploadFile      = File(...),
    description: str             = Form(default=""),
    db:          AsyncSession    = Depends(get_db),
):
    """
    上傳圖片（JPG/PNG/WEBP）並透過 OCR（Gemma VLM）提取文字後嵌入 ChromaDB。
    """
    from services.ocr_service import extract_text_from_image, image_to_chunks, SUPPORTED_IMAGE_TYPES

    suffix = Path(file.filename or "image.jpg").suffix.lower()
    if suffix not in SUPPORTED_IMAGE_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"不支援的圖片格式：{suffix}。請上傳 JPG / PNG / WEBP / GIF / BMP。",
        )

    raw       = await file.read()
    file_size = len(raw)
    doc_id    = str(uuid.uuid4())

    # 儲存原始圖片
    save_path = _UPLOAD_DIR / f"{doc_id}{suffix}"
    save_path.write_bytes(raw)

    # OCR 提取文字
    ocr_text = ""
    try:
        ocr_text = await extract_text_from_image(raw, suffix)
    except Exception as e:
        logger.error("OCR failed for %s: %s", file.filename, str(e))

    # 文字切片
    chunks = image_to_chunks(ocr_text) if ocr_text else []

    # 嵌入 ChromaDB
    chunk_count = 0
    embedded    = False
    if chunks:
        try:
            metas       = [{"source": "ocr", "page": 1} for _ in chunks]
            chunk_count = await embed_document(doc_id, file.filename or "image", chunks, metas)
            embedded    = chunk_count > 0
        except Exception as e:
            logger.error("Embedding failed for image %s: %s", file.filename, str(e))

    # 存入 SQLite
    doc = RagDocument(
        id=          doc_id,
        filename=    file.filename or "unnamed.jpg",
        file_type=   "image",
        file_size=   file_size,
        description= description or (ocr_text[:200] if ocr_text else ""),
        chunk_count= chunk_count,
        embedded=    embedded,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    return RagDocumentOut(
        id=          doc.id,
        filename=    doc.filename,
        file_type=   doc.file_type,
        file_size=   doc.file_size,
        description= doc.description,
        chunk_count= doc.chunk_count,
        embedded=    doc.embedded,
        created_at=  doc.created_at.isoformat(),
    )


# ── 刪除文件 ──────────────────────────────────────────────────────────

@router.delete("/documents/{doc_id}", status_code=204)
async def remove_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    """永久刪除文件記錄及 ChromaDB 向量（不可復原）"""
    result = await db.execute(select(RagDocument).where(RagDocument.id == doc_id))
    doc    = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    deleted = delete_document(doc_id)
    logger.info("Deleted %d chunks from ChromaDB for doc %s", deleted, doc_id)
    await db.delete(doc)
    await db.commit()

    # 刪除原始檔（嘗試所有已知副檔名）
    for ext in [".pdf", ".txt", ".md", ".csv", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]:
        p = _UPLOAD_DIR / f"{doc_id}{ext}"
        if p.exists():
            p.unlink()
            break


# ── 文字提取工具（內部） ───────────────────────────────────────────────

def _extract_chunks(raw: bytes, suffix: str, chunk_size: int = 800) -> list[str]:
    """
    簡易文字提取 + 重疊切片（每 chunk ~800 chars，重疊 100 chars）。
    PDF 需安裝 pdfminer.six 或 pypdf（可選）。
    """
    text = ""

    if suffix == ".pdf":
        try:
            from pdfminer.high_level import extract_text as pdf_extract
            text = pdf_extract(io.BytesIO(raw))
        except ImportError:
            try:
                import pypdf
                reader = pypdf.PdfReader(io.BytesIO(raw))
                text   = "\n".join(p.extract_text() or "" for p in reader.pages)
            except ImportError:
                logger.warning(
                    "No PDF library found; treating as binary. "
                    "Install pdfminer.six or pypdf."
                )
                text = raw.decode("utf-8", errors="replace")
    else:
        text = raw.decode("utf-8", errors="replace")

    text = text.strip()
    if not text:
        return []

    overlap = 100
    chunks: list[str] = []
    start   = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        chunks.append(text[start:end])
        start += chunk_size - overlap

    return [c.strip() for c in chunks if c.strip()]
