"""
rag_service.py — ChromaDB 向量存取 + Gemma 4 E4B 生成

流程：
  1. 使用者輸入問題
  2. get_embedding() 取得問題向量
  3. ChromaDB 語意搜尋 top-k 相關段落
  4. 組合 context + question 呼叫 llama.cpp /v1/chat/completions
  5. 回傳 answer + sources
"""
from __future__ import annotations
import asyncio
import logging
import time
import uuid
from pathlib import Path
from typing import Optional

import chromadb
from chromadb.config import Settings as ChromaSettings
import httpx

from config import get_settings
from services.embedding_service import get_embedding, get_embeddings_batch
from models.schemas import RagSource

logger   = logging.getLogger(__name__)
settings = get_settings()

# ── ChromaDB 客戶端（persistent）───────────────────────────────────────
_chroma_client: Optional[chromadb.PersistentClient] = None
_collection    = None


def _get_client() -> chromadb.PersistentClient:
    global _chroma_client
    if _chroma_client is None:
        Path(settings.chroma_persist_dir).mkdir(parents=True, exist_ok=True)
        _chroma_client = chromadb.PersistentClient(
            path=settings.chroma_persist_dir,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
    return _chroma_client


def _get_collection():
    global _collection
    if _collection is None:
        client = _get_client()
        _collection = client.get_or_create_collection(
            name=settings.chroma_collection,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


# ── 文件嵌入（上傳時呼叫）──────────────────────────────────────────────

async def embed_document(
    doc_id:   str,
    filename: str,
    chunks:   list[str],
    metadatas: Optional[list[dict]] = None,
) -> int:
    """
    將文件切成段落後批次嵌入 ChromaDB。
    回傳成功嵌入的 chunk 數。
    """
    if not chunks:
        return 0

    vecs = await get_embeddings_batch(chunks)
    ok_chunks, ok_vecs, ok_ids, ok_metas = [], [], [], []

    for i, (chunk, vec) in enumerate(zip(chunks, vecs)):
        if not vec:
            logger.warning("Chunk %d of %s got empty embedding, skipped.", i, filename)
            continue
        ok_chunks.append(chunk)
        ok_vecs.append(vec)
        ok_ids.append(f"{doc_id}_{i}")
        meta = (metadatas[i] if metadatas else {}) or {}
        meta.update({"doc_id": doc_id, "filename": filename, "chunk_index": i})
        ok_metas.append(meta)

    if not ok_chunks:
        return 0

    col = _get_collection()
    col.add(
        documents=ok_chunks,
        embeddings=ok_vecs,
        ids=ok_ids,
        metadatas=ok_metas,
    )
    logger.info("Embedded %d/%d chunks from %s", len(ok_chunks), len(chunks), filename)
    return len(ok_chunks)


def delete_document(doc_id: str) -> int:
    """從 ChromaDB 刪除指定文件的所有 chunk"""
    col = _get_collection()
    existing = col.get(where={"doc_id": doc_id}, include=["documents"])
    ids = existing.get("ids", [])
    if ids:
        col.delete(ids=ids)
    return len(ids)


# ── 語意搜尋 ──────────────────────────────────────────────────────────

async def semantic_search(
    question: str,
    top_k:    int = 5,
) -> tuple[list[str], list[RagSource]]:
    """
    回傳 (context_list, sources)
    """
    vec = await get_embedding(question)
    if not vec:
        logger.warning("Empty embedding for question, returning empty context.")
        return [], []

    col    = _get_collection()
    result = col.query(
        query_embeddings=[vec],
        n_results=min(top_k, col.count() or 1),
        include=["documents", "metadatas", "distances"],
    )

    docs      = result.get("documents",  [[]])[0]
    metas     = result.get("metadatas",  [[]])[0]
    distances = result.get("distances",  [[]])[0]

    sources = []
    for meta, dist in zip(metas, distances):
        score = max(0.0, 1.0 - float(dist))   # cosine distance → similarity
        sources.append(RagSource(
            filename=meta.get("filename", "unknown"),
            page=    meta.get("page"),
            score=   round(score, 3),
        ))

    return docs, sources


# ── Gemma 4 E4B 生成 ──────────────────────────────────────────────────

_SYSTEM_PROMPT = """你是一位工業設備維護專家 AI，專精於 PdM（預測性維護）。
請根據以下維修手冊摘錄與歷史工單，以繁體中文回答問題。
- 回答需具體、可操作，並引用來源段落
- 若資料不足，請誠實說明並給出一般性建議
- 輸出請使用 Markdown 格式（標題、條列、重點粗體）
"""


async def generate_answer(
    question: str,
    contexts: list[str],
    max_tokens: int = 1024,
) -> str:
    """呼叫 llama.cpp /v1/chat/completions 生成回答"""
    ctx_text = "\n\n---\n\n".join(contexts) if contexts else "（暫無相關文件）"

    user_message = (
        f"## 參考資料\n\n{ctx_text}\n\n"
        f"## 問題\n\n{question}"
    )

    url  = f"{settings.llm_base_url}/v1/chat/completions"
    body = {
        "model":       settings.llm_model,
        "messages":    [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user",   "content": user_message},
        ],
        "max_tokens":  max_tokens,
        "temperature": settings.llm_temperature,
        "stream":      False,
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            res = await client.post(
                url, json=body,
                headers={"Content-Type": "application/json"},
            )
            res.raise_for_status()
            data = res.json()
            return data["choices"][0]["message"]["content"].strip()
    except httpx.HTTPStatusError as e:
        logger.error("LLM HTTP error %s: %s", e.response.status_code, e.response.text[:200])
        return f"⚠️ 語言模型回應錯誤（HTTP {e.response.status_code}）。請確認 llama.cpp 服務正常運作。"
    except httpx.RequestError as e:
        logger.error("LLM connection error: %s", str(e))
        return "⚠️ 無法連線至本地語言模型（llama.cpp :8080）。請確認服務已啟動。"
    except (KeyError, IndexError) as e:
        logger.error("LLM response parse error: %s", str(e))
        return "⚠️ 模型回應格式解析失敗，請稍後再試。"
    except Exception as e:
        logger.error("LLM unexpected error: %s", str(e))
        return f"⚠️ 語言模型暫時無法回應（{type(e).__name__}）。macOS 開發環境使用 stub，無法真實推論。"


# ── 主要 RAG pipeline ─────────────────────────────────────────────────

async def rag_query(
    question: str,
    top_k:    int = 5,
) -> tuple[str, list[RagSource], int]:
    """
    端對端 RAG：搜尋 + 生成。
    回傳 (answer, sources, latency_ms)
    """
    t0 = time.monotonic()
    contexts, sources = await semantic_search(question, top_k=top_k)
    answer            = await generate_answer(question, contexts)
    latency_ms        = int((time.monotonic() - t0) * 1000)
    return answer, sources, latency_ms


# ── ChromaDB 健康檢查 ─────────────────────────────────────────────────

def chroma_is_healthy() -> bool:
    try:
        col = _get_collection()
        col.count()
        return True
    except Exception as e:
        logger.warning("ChromaDB health check failed: %s", str(e))
        return False
