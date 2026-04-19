# ADR-003：選用 ChromaDB 而非 pgvector / Qdrant 作為向量資料庫

| 欄位       | 內容                                                          |
|-----------|---------------------------------------------------------------|
| **狀態**  | ✅ 已採納（Accepted）                                          |
| **日期**  | 2025-12-20                                                    |
| **決策者** | 架構師、AI 工程師                                             |
| **關聯**  | ADR-001（SQLite）、ADR-002（llama.cpp）、services/rag_service.py |

---

## 背景與問題

RAG（Retrieval-Augmented Generation）知識庫需要：
- 儲存設備維修手冊、歷史工單、SOP 文件的向量嵌入
- 支援語意搜尋（cosine similarity）以取得最相關段落
- 在 AIR-030 邊緣環境本機執行，不依賴外部向量資料庫服務

---

## 評估的方案

### 方案 A：ChromaDB（PersistentClient，本機）

**優點：**
- **Python-native**：pip install chromadb，零額外 Docker 服務
- **PersistentClient**：資料自動持久化至 `./chroma_db` 目錄
- 完整的 HNSW 索引 + cosine / L2 距離支援
- 內建 sentence-transformers embedding 支援（可選）
- 輕量：嵌入至 backend Docker image，無需獨立容器

**缺點：**
- 不支援分散式部署（單節點）
- 過濾查詢（metadata filter）語法較 Qdrant 受限
- 大規模（> 100 萬向量）效能不如 Qdrant Server

### 方案 B：pgvector（PostgreSQL Extension）

**優點：**
- 統一向量與業務資料庫，簡化資料架構

**缺點：**
- 依賴 PostgreSQL（ADR-001 已決定不引入）
- 在 Jetson ARM64 上 PostgreSQL 映像需額外驗證
- pgvector 索引（IVFFlat / HNSW）對 Jetson 的優化有限

### 方案 C：Qdrant（Docker Service）

**優點：**
- 工業級向量搜尋效能
- 豐富的 payload filter 能力

**缺點：**
- 需額外 Docker 服務（+1 container，+512MB+ 記憶體）
- ARM64 支援需特定映像版本確認
- 本專案向量規模（< 10 萬 chunks）未達 Qdrant 的必要門檻

### 方案 D：FAISS（Meta，純記憶體）

**優點：**
- 極高搜尋效能（GPU FAISS on Jetson）

**缺點：**
- 無原生持久化（需自行序列化索引）
- Python binding 維護複雜
- 缺乏 metadata 過濾能力

---

## 決策

**選用 ChromaDB PersistentClient（方案 A）。**

理由：

1. **無額外服務依賴**：ChromaDB 以 Python library 嵌入 backend，
   維持 7 服務的 Docker Compose 架構不變。

2. **知識庫規模適配**：工廠設備手冊、SOP 預計 < 1,000 份文件，
   ~50,000 chunks。HNSW 索引在此規模效能充裕（< 100ms 查詢）。

3. **IVectorStoreAdapter 抽象**：`ChromaAdapter` 實作 `IVectorStoreAdapter` Protocol，
   若未來需遷移至 Qdrant，替換 adapter 即可，RAG service 邏輯不變。

4. **ARM64 穩定支援**：ChromaDB ≥ 0.5.x 有完整 ARM64 wheel，
   AIR-030 驗證測試通過。

---

## 後果與限制

- ✅ ChromaDB 資料持久化於 `backend-data` volume（`/data/chroma`）
- ✅ 與 SQLite 共享同一個 volume，統一備份策略
- ⚠️ 超過 100K chunks 後建議評估遷移至 Qdrant Server
- ⚠️ `chroma_is_healthy()` 函式在 health check 中執行同步操作，
  需確保 Chroma 初始化不阻塞 event loop
- 📋 `GET /api/health` 的 `chroma_ok` 欄位監控向量庫可用性

---

## 後續行動

- [ ] v1.2.0：實作 `IVectorStoreAdapter.query()` 支援 metadata filter（設備 ID 過濾）
- [ ] v2.0.0：若知識庫 > 100K chunks，評估遷移至 Qdrant，透過 `ChromaAdapter` → `QdrantAdapter` 切換
