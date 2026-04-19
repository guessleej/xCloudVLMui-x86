"""
adapters/base.py — 適配器層 Protocol 介面定義
================================================
使用 Python typing.Protocol 定義各外部服務的抽象介面。
Protocol 支援結構性子型別（structural subtyping），
不需繼承即可實現鴨子型別的靜態型別檢查（mypy 相容）。

介面：
  ISensorAdapter      — 感測器資料存取（MQTT / 模擬）
  ILLMAdapter         — 大型語言模型推論
  IVectorStoreAdapter — 向量資料庫存取（RAG 檢索）
"""
from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


# ── 感測器介面 ────────────────────────────────────────────────────────

@runtime_checkable
class ISensorAdapter(Protocol):
    """感測器資料存取介面（MQTT Broker / 本機模擬）"""

    async def connect(self) -> None:
        """建立與 Broker 的連線"""
        ...

    async def disconnect(self) -> None:
        """關閉連線並釋放資源"""
        ...

    async def publish(self, topic: str, payload: str | bytes, qos: int = 0) -> None:
        """發布訊息至指定主題"""
        ...

    async def subscribe(self, topic: str, qos: int = 0) -> None:
        """訂閱指定主題"""
        ...

    def is_connected(self) -> bool:
        """回傳目前連線狀態"""
        ...


# ── LLM 介面 ─────────────────────────────────────────────────────────

@runtime_checkable
class ILLMAdapter(Protocol):
    """大型語言模型推論介面（llama.cpp / OpenAI-compatible）"""

    async def complete(
        self,
        prompt:      str,
        max_tokens:  int   = 512,
        temperature: float = 0.1,
        **kwargs:    Any,
    ) -> str:
        """同步式文字補全，回傳生成結果字串"""
        ...

    async def chat(
        self,
        messages:    list[dict[str, str]],
        max_tokens:  int   = 512,
        temperature: float = 0.1,
        **kwargs:    Any,
    ) -> str:
        """對話式文字生成（OpenAI chat format），回傳 assistant 回覆字串"""
        ...

    async def health(self) -> bool:
        """回傳服務是否正常"""
        ...

    async def model_name(self) -> str:
        """回傳當前載入的模型 ID"""
        ...


# ── 向量資料庫介面 ────────────────────────────────────────────────────

@runtime_checkable
class IVectorStoreAdapter(Protocol):
    """向量資料庫存取介面（ChromaDB / FAISS / 其他）"""

    async def add_documents(
        self,
        doc_id:   str,
        chunks:   list[str],
        metadatas: list[dict[str, Any]],
    ) -> int:
        """
        新增文件切片至向量資料庫。
        回傳成功寫入的 chunk 數量。
        """
        ...

    async def query(
        self,
        query_text: str,
        top_k:      int = 5,
    ) -> list[dict[str, Any]]:
        """
        語意搜尋最相關的 top_k 段落。
        回傳包含 text / metadata / score 的字典列表。
        """
        ...

    async def delete(self, doc_id: str) -> int:
        """
        刪除指定文件的所有向量。
        回傳刪除的 chunk 數量。
        """
        ...

    def is_healthy(self) -> bool:
        """回傳向量資料庫是否可用"""
        ...
