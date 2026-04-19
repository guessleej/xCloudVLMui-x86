"""
adapters/chroma_adapter.py — ChromaDB 本機向量資料庫適配器
===========================================================
封裝 chromadb 客戶端，提供文件嵌入、語意搜尋、刪除介面。
實作 IVectorStoreAdapter Protocol。

設定（來自 config.Settings）：
  chroma_persist_dir — ChromaDB 本機持久化目錄（預設 ./chroma_db）
  chroma_collection  — Collection 名稱（預設 xcloud_knowledge）

依賴：
  pip install chromadb sentence-transformers
"""
from __future__ import annotations

import logging
from typing import Any

from config import get_settings

logger    = logging.getLogger(__name__)
_settings = get_settings()


class ChromaAdapter:
    """
    ChromaDB 向量資料庫適配器（本機 PersistentClient）。

    使用方式：
        adapter = ChromaAdapter()
        count = await adapter.add_documents("doc-uuid", chunks, metadatas)
        results = await adapter.query("壓縮機軸承溫度")
    """

    def __init__(
        self,
        persist_dir: str = "",
        collection:  str = "",
    ) -> None:
        self._persist_dir = persist_dir or _settings.chroma_persist_dir
        self._collection  = collection  or getattr(_settings, "chroma_collection", "xcloud_knowledge")
        self._client      = None
        self._col         = None

    def _ensure_client(self) -> None:
        """延遲初始化 ChromaDB PersistentClient（避免 import 時即啟動）"""
        if self._client is not None:
            return
        try:
            import chromadb  # type: ignore[import]
            self._client = chromadb.PersistentClient(path=self._persist_dir)
            self._col    = self._client.get_or_create_collection(
                name=     self._collection,
                metadata= {"hnsw:space": "cosine"},
            )
            logger.info(
                "ChromaAdapter initialised: dir=%s collection=%s",
                self._persist_dir, self._collection,
            )
        except Exception as e:
            logger.error("ChromaAdapter init failed: %s", e)
            raise

    # ── IVectorStoreAdapter Protocol 實作 ────────────────────────────

    async def add_documents(
        self,
        doc_id:    str,
        chunks:    list[str],
        metadatas: list[dict[str, Any]],
    ) -> int:
        """
        新增文件切片至 ChromaDB。
        doc_id + 流水號作為唯一 ID（例：uuid-0, uuid-1 ...）。
        回傳成功寫入的 chunk 數量。
        """
        self._ensure_client()
        if not chunks:
            return 0
        ids = [f"{doc_id}-{i}" for i in range(len(chunks))]
        try:
            self._col.add(documents=chunks, metadatas=metadatas, ids=ids)  # type: ignore[union-attr]
            logger.info("ChromaAdapter added %d chunks for doc %s", len(chunks), doc_id)
            return len(chunks)
        except Exception as e:
            logger.error("ChromaAdapter add_documents error: %s", e)
            return 0

    async def query(
        self,
        query_text: str,
        top_k:      int = 5,
    ) -> list[dict[str, Any]]:
        """
        語意搜尋最相關的 top_k 段落。
        回傳 [{"text": ..., "metadata": {...}, "score": float}, ...]
        """
        self._ensure_client()
        try:
            results = self._col.query(  # type: ignore[union-attr]
                query_texts=[query_text],
                n_results=  top_k,
                include=    ["documents", "metadatas", "distances"],
            )
            docs      = results.get("documents",  [[]])[0]
            metas     = results.get("metadatas",  [[]])[0]
            distances = results.get("distances",  [[]])[0]

            return [
                {
                    "text":     doc,
                    "metadata": meta,
                    "score":    round(1 - dist, 4),   # cosine distance → similarity
                }
                for doc, meta, dist in zip(docs, metas, distances)
            ]
        except Exception as e:
            logger.error("ChromaAdapter query error: %s", e)
            return []

    async def delete(self, doc_id: str) -> int:
        """
        刪除指定文件的所有向量（前綴比對 doc_id-*）。
        回傳刪除的 chunk 數量。
        """
        self._ensure_client()
        try:
            existing = self._col.get(where={"$contains": doc_id})   # type: ignore[union-attr]
            ids      = existing.get("ids", [])
            # 精確前綴篩選
            target = [i for i in ids if i.startswith(f"{doc_id}-")]
            if target:
                self._col.delete(ids=target)                          # type: ignore[union-attr]
                logger.info("ChromaAdapter deleted %d chunks for doc %s", len(target), doc_id)
            return len(target)
        except Exception as e:
            logger.error("ChromaAdapter delete error: %s", e)
            return 0

    def is_healthy(self) -> bool:
        """回傳 ChromaDB 是否可用（嘗試初始化 client）"""
        try:
            self._ensure_client()
            return self._col is not None
        except Exception:
            return False
