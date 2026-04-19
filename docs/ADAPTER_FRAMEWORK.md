# xCloudVLMui Platform — 標準化適配器框架（Adapter Framework）

| 欄位         | 內容                  |
|-------------|----------------------|
| **文件版本** | v1.1.0               |
| **建立日期** | 2026-04-12           |
| **最後更新** | 2026-04-12           |
| **負責人**   | 系統架構師            |

---

## 目錄

1. [設計動機](#1-設計動機)
2. [架構模式選擇](#2-架構模式選擇)
3. [介面定義（Protocol）](#3-介面定義protocol)
4. [現有適配器清單](#4-現有適配器清單)
5. [適配器使用方式](#5-適配器使用方式)
6. [新增適配器指南](#6-新增適配器指南)
7. [測試策略](#7-測試策略)
8. [版本演進計畫](#8-版本演進計畫)

---

## 1. 設計動機

### 1.1 問題背景

xCloudVLMui Platform 依賴多個第三方服務：

| 服務 | 用途 | 耦合風險 |
|------|------|---------|
| llama.cpp | LLM 推論、RAG 嵌入 | API 格式可能變更 |
| Eclipse Mosquitto | MQTT IoT 資料收集 | Broker 可替換 |
| ChromaDB | 向量語意搜尋 | 可能遷移至 pgvector |
| VLM WebUI | 視覺推論 | 服務端點不穩定 |

若直接在 Service 層呼叫第三方 SDK，會導致：
- 測試時必須啟動真實外部服務（CI 不可行）
- 替換實作需修改所有呼叫點
- 業務邏輯與基礎設施高度耦合

### 1.2 解決方案

採用 **Adapter Pattern**（適配器模式）+ **Python Protocol**（結構性型別），將業務邏輯與第三方依賴隔離：

```
Service 層
    │  只依賴 Protocol 介面
    ▼
ILLMAdapter / ISensorAdapter / IVectorStoreAdapter
    │  由具體 Adapter 實作
    ▼
LlamaCppAdapter / MqttAdapter / ChromaAdapter
    │  封裝第三方 SDK
    ▼
llama.cpp HTTP API / aiomqtt / chromadb SDK
```

---

## 2. 架構模式選擇

### 2.1 Python Protocol vs ABC（Abstract Base Class）

| 特性 | Protocol（已採用） | ABC |
|------|-----------------|-----|
| 繼承需求 | ❌ 不需要繼承 | ✅ 必須繼承 |
| 結構性子型別 | ✅ 鴨子型別相容 | ❌ 名義型別 |
| 測試 Mock 難度 | 🟢 極易（任何符合介面的物件）| 🟡 需繼承 |
| 第三方類別相容 | ✅ 無需修改第三方類別 | ❌ 第三方類別需繼承 |

**選擇 Protocol 的原因：** 允許在測試時注入任何符合介面簽名的 Mock 物件，無需繼承鏈。

### 2.2 依賴注入方式

目前採用 **模組層級單例**（Module-level singleton）注入：

```python
# routers/knowledge.py
from adapters import llm_adapter, chroma_adapter
```

**v2.0.0 規劃：** 遷移至 FastAPI `Depends()` 依賴注入，支援請求作用域（request-scoped）適配器實例。

---

## 3. 介面定義（Protocol）

> 所有介面定義於 `backend/adapters/base.py`

### 3.1 ILLMAdapter — 語言模型介面

```python
class ILLMAdapter(Protocol):
    """LLM 推論適配器介面
    
    實作者：LlamaCppAdapter
    用途：文字生成、向量嵌入
    """
    
    async def chat_completion(
        self,
        messages: list[dict[str, str]],
        max_tokens: int = 4096,
        temperature: float = 0.1,
    ) -> str:
        """Chat 對話生成（OpenAI API 相容格式）"""
        ...

    async def embed(self, text: str) -> list[float]:
        """文字向量化（用於 RAG 語意搜尋）"""
        ...

    async def is_healthy(self) -> bool:
        """服務健康探測"""
        ...
```

---

### 3.2 ISensorAdapter — 感測器 IoT 介面

```python
class ISensorAdapter(Protocol):
    """IoT 感測器適配器介面
    
    實作者：MqttAdapter
    用途：感測器資料訂閱、訊息發佈
    """

    async def subscribe(self, topic: str) -> None:
        """訂閱 MQTT Topic"""
        ...

    async def publish(
        self,
        topic: str,
        payload: str,
        qos: int = 1,
    ) -> None:
        """發佈 MQTT 訊息"""
        ...

    async def is_connected(self) -> bool:
        """Broker 連線狀態"""
        ...
```

---

### 3.3 IVectorStoreAdapter — 向量庫介面

```python
class IVectorStoreAdapter(Protocol):
    """向量資料庫適配器介面
    
    實作者：ChromaAdapter
    用途：文件嵌入儲存、語意相似度搜尋
    """

    async def add_documents(
        self,
        collection: str,
        documents: list[str],
        metadatas: list[dict],
        ids: list[str],
        embeddings: list[list[float]],
    ) -> None:
        """新增文件向量至指定 Collection"""
        ...

    async def query(
        self,
        collection: str,
        query_embeddings: list[list[float]],
        n_results: int = 5,
    ) -> list[dict]:
        """語意相似度搜尋"""
        ...

    async def delete_document(self, collection: str, doc_id: str) -> None:
        """刪除指定文件"""
        ...

    async def is_healthy(self) -> bool:
        """向量庫健康探測"""
        ...
```

---

## 4. 現有適配器清單

| 適配器 | 檔案 | 實作介面 | 第三方依賴 | 狀態 |
|--------|------|---------|----------|------|
| **LlamaCppAdapter** | `adapters/llama_cpp_adapter.py` | `ILLMAdapter` | `httpx`（HTTP REST）| ✅ 現行 |
| **MqttAdapter** | `adapters/mqtt_adapter.py` | `ISensorAdapter` | `aiomqtt` | ✅ 現行 |
| **ChromaAdapter** | `adapters/chroma_adapter.py` | `IVectorStoreAdapter` | `chromadb` | ✅ 現行 |

### 4.1 LlamaCppAdapter 設計

```
LlamaCppAdapter
  ├── base_url: str           # http://llama-cpp:8080（from config）
  ├── model: str              # gemma-4-e4b-it
  ├── ctx_size: int           # 131072
  ├── max_tokens: int         # 4096
  └── temperature: float      # 0.1
  
呼叫路徑：
  chat_completion() → POST /v1/chat/completions（OpenAI 格式）
  embed()           → POST /v1/embeddings
  is_healthy()      → GET  /health 或 /v1/models
```

**特性：**
- 使用 `httpx.AsyncClient` 非同步 HTTP
- 設定 `connect_timeout=5s`, `read_timeout=120s`（VLM 推論可能較慢）
- 連線失敗時返回 `is_healthy() = False`（不拋例外）

---

### 4.2 MqttAdapter 設計

```
MqttAdapter
  ├── host: str          # mosquitto（Docker 服務名）
  ├── port: int          # 1883
  └── reconnect_interval: float  # 指數退避 5s → 60s
  
呼叫路徑：
  subscribe() → aiomqtt.Client().subscribe()
  publish()   → aiomqtt.Client().publish(qos=1)
  is_connected() → 連線狀態標誌
```

**特性：**
- 指數退避重連（5s → 10s → 20s → ... → 60s 上限）
- QoS 1 保障（至少一次送達）
- 持久化 Session（`clean_session=False`）

---

### 4.3 ChromaAdapter 設計

```
ChromaAdapter
  ├── persist_dir: str   # /data/chroma（from config）
  └── client: chromadb.PersistentClient
  
呼叫路徑：
  add_documents() → collection.add(embeddings, documents, metadatas, ids)
  query()         → collection.query(query_embeddings, n_results)
  delete_document() → collection.delete(ids=[doc_id])
  is_healthy()    → collection.count() 是否可執行
```

**特性：**
- PersistentClient（本地磁碟持久化）
- Collection per document type（設備類型分類）
- HNSW 索引（預設）

---

## 5. 適配器使用方式

### 5.1 在 Service 層引用

```python
# services/rag_service.py
from adapters import llm_adapter, chroma_adapter
from adapters.base import ILLMAdapter, IVectorStoreAdapter

async def rag_query(
    question: str,
    top_k: int = 5,
    llm: ILLMAdapter = llm_adapter,          # 預設注入真實適配器
    vector_store: IVectorStoreAdapter = chroma_adapter,
) -> RagQueryResponse:
    # 1. 向量化問題
    q_embedding = await llm.embed(question)
    
    # 2. 語意搜尋
    results = await vector_store.query(
        collection="documents",
        query_embeddings=[q_embedding],
        n_results=top_k,
    )
    
    # 3. 生成回答
    context = "\n".join(r["document"] for r in results)
    answer = await llm.chat_completion([
        {"role": "system", "content": f"知識庫內容：\n{context}"},
        {"role": "user", "content": question},
    ])
    
    return RagQueryResponse(answer=answer, sources=results)
```

### 5.2 在測試中注入 Mock

```python
# tests/unit/test_rag_service.py
import pytest
from services.rag_service import rag_query

class MockLLMAdapter:
    """符合 ILLMAdapter Protocol 的測試替身"""
    async def embed(self, text: str) -> list[float]:
        return [0.1, 0.2, 0.3]  # 固定向量
    
    async def chat_completion(self, messages, **kwargs) -> str:
        return "測試回答"
    
    async def is_healthy(self) -> bool:
        return True

class MockVectorStore:
    """符合 IVectorStoreAdapter Protocol 的測試替身"""
    async def query(self, collection, query_embeddings, n_results=5):
        return [{"document": "測試文件段落", "metadata": {"filename": "test.pdf"}}]
    # ... 其他方法

@pytest.mark.asyncio
async def test_rag_query_returns_answer():
    result = await rag_query(
        question="壓縮機怎麼維修？",
        llm=MockLLMAdapter(),           # 注入 Mock
        vector_store=MockVectorStore(), # 注入 Mock
    )
    assert result.answer == "測試回答"
    assert len(result.sources) > 0
```

**優點：** 測試完全不需要啟動 llama.cpp 或 ChromaDB 服務。

---

## 6. 新增適配器指南

### 步驟一：定義 Protocol 介面

在 `backend/adapters/base.py` 新增介面：

```python
class INotificationAdapter(Protocol):
    """通知推播適配器介面（v1.2.0 新增）"""
    
    async def send_alert(self, title: str, message: str) -> bool:
        """發送告警通知，返回是否成功"""
        ...
    
    async def is_enabled(self) -> bool:
        """通知功能是否啟用"""
        ...
```

### 步驟二：實作具體 Adapter

建立 `backend/adapters/line_notify_adapter.py`：

```python
from adapters.base import INotificationAdapter
import httpx

class LineNotifyAdapter:
    """LINE Notify 適配器實作（v1.2.0）"""
    
    def __init__(self, token: str, enabled: bool = False):
        self._token = token
        self._enabled = enabled
    
    async def send_alert(self, title: str, message: str) -> bool:
        if not self._enabled:
            return False
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://notify-api.line.me/api/notify",
                headers={"Authorization": f"Bearer {self._token}"},
                data={"message": f"\n【{title}】\n{message}"},
            )
            return resp.status_code == 200
    
    async def is_enabled(self) -> bool:
        return self._enabled
```

### 步驟三：在 `adapters/__init__.py` 匯出

```python
from adapters.line_notify_adapter import LineNotifyAdapter

notification_adapter = LineNotifyAdapter(
    token=settings.line_notify_token,
    enabled=settings.ff_line_notify,
)
```

### 步驟四：撰寫 Mock 測試

```python
class MockNotificationAdapter:
    def __init__(self):
        self.sent_alerts = []
    
    async def send_alert(self, title, message):
        self.sent_alerts.append((title, message))
        return True
    
    async def is_enabled(self):
        return True
```

### 步驟五：更新此文件

在「現有適配器清單」表格新增一列，記錄介面、依賴、狀態。

---

## 7. 測試策略

### 7.1 Adapter Unit Tests

每個 Adapter 應有獨立的 Unit Test，使用 `respx`（httpx Mock）或 `unittest.mock`：

```python
# tests/unit/test_llama_cpp_adapter.py
import respx
import pytest
from adapters.llama_cpp_adapter import LlamaCppAdapter

@pytest.mark.asyncio
@respx.mock
async def test_chat_completion_success():
    respx.post("http://localhost:8080/v1/chat/completions").mock(
        return_value=httpx.Response(200, json={
            "choices": [{"message": {"content": "測試回答"}}]
        })
    )
    adapter = LlamaCppAdapter(base_url="http://localhost:8080")
    result = await adapter.chat_completion([{"role": "user", "content": "test"}])
    assert result == "測試回答"
```

### 7.2 Service Integration Tests

Service 層測試注入 Mock Adapter，驗證業務邏輯：

```python
# tests/unit/test_rag_service.py
# 使用 §5.2 的 MockLLMAdapter + MockVectorStore
```

### 7.3 End-to-End Tests（規劃 v1.3.0）

啟動完整 Docker Compose 環境，驗證真實 Adapter 連線：

```bash
pytest tests/e2e/ --docker-compose=docker-compose.mac.yml
```

---

## 8. 版本演進計畫

### v1.2.0（2026-06-30）

| 項目 | 說明 |
|------|------|
| LineNotifyAdapter | LINE Notify 告警推播（ff.line_notify）|
| vlm_service 重構 | 將 VLM 服務納入 Adapter 框架（目前直接呼叫 httpx）|
| Adapter Unit Tests | 補充 LlamaCppAdapter, MqttAdapter, ChromaAdapter 測試（TD-003）|

### v2.0.0（2026-12-31）

| 項目 | 說明 |
|------|------|
| PostgreSQLAdapter | 替換 SQLite，IDBAdapter 介面（DB 層 Adapter 化）|
| FastAPI Depends 注入 | 取代模組層級單例，支援 DI 框架 |
| K8s Service Discovery | Adapter base_url 從環境變數轉為 K8s Service DNS |

---

## 現有適配器目錄結構

```
backend/adapters/
├── __init__.py             # 單例匯出（llm_adapter, chroma_adapter, mqtt_adapter）
├── base.py                 # Protocol 介面定義（ILLMAdapter, ISensorAdapter, IVectorStoreAdapter）
├── llama_cpp_adapter.py    # LlamaCppAdapter 實作
├── mqtt_adapter.py         # MqttAdapter 實作
└── chroma_adapter.py       # ChromaAdapter 實作
```

---

*相關文件：[architecture/CORE_MODULES.md §5](architecture/CORE_MODULES.md) | [CONTRIBUTING.md §6](../CONTRIBUTING.md) | [CONTINUOUS_IMPROVEMENT.md §4 TD-003](CONTINUOUS_IMPROVEMENT.md)*
