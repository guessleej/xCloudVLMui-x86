# xCloudVLMui Platform — 整合路線圖（Integration Roadmap）

| 欄位         | 內容                  |
|-------------|----------------------|
| **文件版本** | v1.1.0               |
| **建立日期** | 2026-04-11           |
| **最後更新** | 2026-04-11           |
| **負責人**   | 系統架構師 / PM       |

---

## 目錄

1. [版本里程碑總覽](#1-版本里程碑總覽)
2. [v1.2.0 遷移指南](#2-v120-遷移指南2026-06-30)
3. [v2.0.0 遷移指南](#3-v200-遷移指南2026-12-31)
4. [向後相容性矩陣](#4-向後相容性矩陣)
5. [API 廢棄時程](#5-api-廢棄時程)
6. [Feature Flag 推出時程](#6-feature-flag-推出時程)
7. [資料庫遷移策略](#7-資料庫遷移策略)

---

## 1. 版本里程碑總覽

```
2025-12-31  v1.0.0 ──── 基礎平台（VLM + RAG + MQTT + 儀表板）
                │
2026-04-10  v1.1.0 ──── P0/P1 架構重構（現行版本）
                │       • SRP Router 拆分
                │       • Adapter 介面層
                │       • CI/CD + 文件完整化
                │       • Feature Flags 系統
                │
2026-06-30  v1.2.0 ──── 感測器增強 + 可觀測性
                │       • LINE Notify 整合（ff.line_notify）
                │       • Equipment DB CRUD
                │       • 測試覆蓋率 ≥ 70%
                │       • MQTT over TLS（port 8883）
                │       • Trivy 容器掃描 CI
                │       • RAG Rerank（ff.rag_rerank）
                │
2026-12-31  v2.0.0 ──── 多廠房 + 企業級
                        • PostgreSQL 遷移（取代 SQLite）
                        • RBAC 角色權限管理
                        • 多廠房聯網監控
                        • Kubernetes 評估
                        • ERP / CMMS 整合
```

---

## 2. v1.2.0 遷移指南（2026-06-30）

### 2.1 新功能清單

| 功能 | 類型 | Feature Flag | 預設值 | Breaking |
|------|------|-------------|--------|---------|
| LINE Notify 警報推播 | 新功能 | `ff.line_notify` | `false` | ❌ |
| Equipment DB CRUD API | 新功能 | — | 永遠啟用 | ❌ |
| MQTT over TLS（port 8883） | 安全增強 | — | 可選 | ❌ |
| RAG Rerank（cross-encoder） | AI 增強 | `ff.rag_rerank` | `false` | ❌ |
| MQTT 感測器資料 180天 TTL | 維運 | — | 自動啟用 | ❌ |
| Trivy 掃描 CI job | DevOps | — | CI 自動 | ❌ |
| 測試覆蓋率 ≥ 70% | 品質 | — | — | ❌ |

> ✅ v1.2.0 **無 Breaking Changes**，v1.1.0 環境可直接升級。

### 2.2 升級步驟

```bash
# 1. 備份資料
cp /data/xcloudvlm.db /data/xcloudvlm.db.backup.$(date +%Y%m%d)
cp -r /data/chroma /data/chroma.backup.$(date +%Y%m%d)

# 2. 拉取新映像
docker compose pull

# 3. 重啟服務（零停機策略：先啟動新，再停舊）
docker compose up -d --no-deps backend frontend

# 4. 驗證健康狀態
curl http://localhost/api/health | python3 -m json.tool

# 5. 確認新功能（Equipment DB 端點）
curl http://localhost/api/equipment | python3 -m json.tool
```

### 2.3 環境變數變更

v1.2.0 新增以下可選環境變數（`.env.example` 已更新）：

| 變數名稱 | 預設值 | 說明 |
|---------|--------|------|
| `LINE_NOTIFY_TOKEN` | `""` | LINE Notify API Token（啟用 ff.line_notify 必填） |
| `MQTT_TLS_ENABLED` | `false` | 啟用 MQTT over TLS |
| `MQTT_TLS_CA_CERT` | `""` | CA 憑證路徑（MQTT TLS 用） |
| `MQTT_SENSOR_TTL_DAYS` | `180` | 感測器資料保留天數 |
| `CHROMA_RERANK_MODEL` | `""` | RAG Rerank 模型（啟用 ff.rag_rerank 必填）|

### 2.4 LINE Notify 啟用步驟

1. 前往 [LINE Notify](https://notify-bot.line.me/) 取得 Token
2. 在 `.env` 設定 `LINE_NOTIFY_TOKEN=<your_token>`
3. 透過 API 啟用 Feature Flag：
   ```bash
   curl -X POST http://localhost/api/settings/feature-flags/ff.line_notify/toggle
   ```
4. 設定 Webhook URL（透過 PUT API）：
   ```bash
   curl -X PUT http://localhost/api/settings/feature-flags/ff.line_notify \
     -H "Content-Type: application/json" \
     -d '{"metadata": {"webhook_url": "https://notify-api.line.me/api/notify", "notify_levels": ["critical"]}}'
   ```

---

## 3. v2.0.0 遷移指南（2026-12-31）

### 3.1 重大架構變更

| 項目 | v1.x（現行） | v2.0.0 | Breaking |
|------|------------|--------|---------|
| 主資料庫 | SQLite（WAL mode） | PostgreSQL 15 | ✅ **是** |
| 向量資料庫 | ChromaDB（embedded） | pgvector（PostgreSQL extension）| ✅ **是** |
| 認證方式 | NextAuth OAuth2（Google/GitHub） | RBAC + LDAP/AD 選項 | ✅ **是** |
| 部署架構 | 單機 Docker Compose | 評估 Kubernetes（多廠房）| ✅ **是** |
| 感測器資料量 | SQLite（≤ 50 設備） | TimescaleDB（超大量時序資料）| 可選 |

### 3.2 PostgreSQL 遷移計畫

#### Phase 1：準備（v1.2.0 完成後）
- 新增 Alembic migration 框架（`alembic/`）
- 在 `adapters/` 新增 `PostgreSQLAdapter` 實作
- 所有 DB 操作改用 `IDBAdapter` 介面（不直接依賴 SQLite）

#### Phase 2：雙軌寫入（v2.0.0-rc 階段）
- 部署 PostgreSQL 容器（`xcloud-postgres`）
- `config.py` 支援 `DATABASE_BACKEND=sqlite|postgresql`
- Shadow Write：同時寫入 SQLite + PostgreSQL，讀取仍用 SQLite
- 比對兩個 DB 的資料一致性

#### Phase 3：切換（v2.0.0 正式）
- 確認 PostgreSQL 資料完整後，切換讀取至 PostgreSQL
- 舊 SQLite 保留 30 天作為回滾保障

#### 資料遷移腳本（預計）

```bash
# 規劃中：scripts/migrate_to_postgresql.py
python scripts/migrate_to_postgresql.py \
  --sqlite /data/xcloudvlm.db \
  --postgres postgresql://user:pass@localhost:5432/xcloudvlm \
  --tables users,reports,rag_documents,feature_flags \
  --dry-run  # 先 dry run 確認

# ChromaDB → pgvector
python scripts/migrate_chroma_to_pgvector.py \
  --chroma-dir /data/chroma \
  --pgvector postgresql://user:pass@localhost:5432/xcloudvlm
```

### 3.3 RBAC 設計規劃

```
角色層級（計畫）：
  SUPER_ADMIN  — 所有操作（系統設定、使用者管理）
  ADMIN        — 設備管理、知識庫管理、Feature Flags
  ENGINEER     — VLM 巡檢、報告建立、MQTT 查詢
  VIEWER       — 唯讀（儀表板、警報查看）
```

---

## 4. 向後相容性矩陣

### API 端點相容性

| API 端點 | v1.0.0 | v1.1.0 | v1.2.0 | v2.0.0 | 說明 |
|---------|--------|--------|--------|--------|------|
| `GET /api/equipment` | ✅ | ✅ | ✅ | ✅ | 穩定 |
| `GET /api/vhs/*` | ✅ | ✅ | ✅ | ✅ | 穩定 |
| `GET /api/alerts/*` | ✅ | ✅ | ✅ | ✅ | 穩定 |
| `POST /api/chat/query` | ❌ | ✅ | ✅ | ✅ | v1.1.0 新增 |
| `GET /api/knowledge/*` | ❌ | ✅ | ✅ | ✅ | v1.1.0 新增 |
| `GET /api/settings/feature-flags` | ❌ | ✅ | ✅ | ✅ | v1.1.0 新增 |
| `GET /api/dashboard/*` | ✅ | ⚠️ | ⚠️ | ❌ | v1.1.0 廢棄，v1.3.0 移除 |
| `POST /api/rag/query` | ✅ | ⚠️ | ⚠️ | ❌ | v1.1.0 廢棄，v1.3.0 移除 |
| `GET /api/equipment-db/*` | ❌ | ❌ | ✅ | ✅ | v1.2.0 新增（Equipment CRUD）|

**符號說明：** ✅ 支援 | ⚠️ 廢棄（仍可用，shim 轉發）| ❌ 不支援

### Docker Compose 相容性

| 設定項目 | v1.0.0 | v1.1.0 | v1.2.0 | v2.0.0 |
|---------|--------|--------|--------|--------|
| 服務數量 | 6 | 7 | 7 | 8+ |
| 新增服務 | — | `model-init` | — | `postgres`, `redis`（計畫） |
| JSON 日誌 | ❌ | ✅ | ✅ | ✅ |
| Healthcheck（所有服務）| ⚠️ 部分 | ✅ | ✅ | ✅ |

### 環境變數相容性

| 變數 | v1.0.0 | v1.1.0 | v1.2.0 | 說明 |
|-----|--------|--------|--------|------|
| `DATABASE_URL` | ✅ | ✅ | ✅ | 格式不變 |
| `LLM_BASE_URL` | ✅ | ✅ | ✅ | 格式不變 |
| `MQTT_ENABLED` | ✅ | ✅ | ✅ | 格式不變 |
| `CHROMA_PERSIST_DIR` | ✅ | ✅ | ✅ | 格式不變 |
| `LINE_NOTIFY_TOKEN` | ❌ | ❌ | ✅ | v1.2.0 新增（可選） |
| `MQTT_TLS_ENABLED` | ❌ | ❌ | ✅ | v1.2.0 新增（可選） |

---

## 5. API 廢棄時程

### 廢棄端點清單

| 端點 | 廢棄版本 | 移除版本 | 替代端點 | 備注 |
|------|---------|---------|---------|------|
| `GET /api/dashboard/equipment` | v1.1.0 | v1.3.0 | `GET /api/equipment` | Shim 自動轉發 |
| `GET /api/dashboard/vhs` | v1.1.0 | v1.3.0 | `GET /api/vhs` | Shim 自動轉發 |
| `GET /api/dashboard/alerts` | v1.1.0 | v1.3.0 | `GET /api/alerts` | Shim 自動轉發 |
| `GET /api/dashboard/pipeline` | v1.1.0 | v1.3.0 | `GET /api/pipeline` | Shim 自動轉發 |
| `POST /api/rag/upload` | v1.1.0 | v1.3.0 | `POST /api/knowledge/documents/upload` | Shim 自動轉發 |
| `POST /api/rag/query` | v1.1.0 | v1.3.0 | `POST /api/chat/query` | Shim 自動轉發 |
| `GET /api/rag/documents` | v1.1.0 | v1.3.0 | `GET /api/knowledge/documents` | Shim 自動轉發 |

### 廢棄通知機制

v1.1.0 起，廢棄端點回應 Header 包含：

```
Deprecation: true
Sunset: Sat, 31 Dec 2026 00:00:00 GMT
Link: </api/equipment>; rel="successor-version"
X-Deprecated-Since: v1.1.0
X-Remove-At: v1.3.0
```

### 前端遷移指南

如果您的前端程式碼使用廢棄端點，請按以下步驟遷移：

```typescript
// 舊（廢棄）
const data = await fetch('/api/dashboard/equipment');
const vhsData = await fetch('/api/dashboard/vhs');
const answer = await fetch('/api/rag/query', { method: 'POST', body: ... });

// 新（v1.1.0+）
const data = await fetch('/api/equipment');
const vhsData = await fetch('/api/vhs');
const answer = await fetch('/api/chat/query', { method: 'POST', body: ... });
```

---

## 6. Feature Flag 推出時程

### 現行 Feature Flags（v1.1.0）

| Flag 鍵值 | 預設值 | 推出版本 | 說明 | 預計狀態 |
|----------|--------|---------|------|---------|
| `ff.auto_report` | `true` | v1.0.0 | VLM 分析後自動生成報告 | 永久啟用 |
| `ff.vlm_ocr` | `true` | v1.0.0 | 圖片 VLM OCR | 永久啟用 |
| `ff.mqtt_alert` | `true` | v1.0.0 | MQTT 閾值自動警報 | 永久啟用 |
| `ff.dark_mode` | `true` | v1.1.0 | 前端暗色主題 | 永久啟用 |
| `ff.line_notify` | `false` | v1.1.0 | LINE Notify 推播 | v1.2.0 全量啟用 |
| `ff.rag_rerank` | `false` (0%) | v1.1.0 | RAG 結果重排序 | v1.2.0 beta (10%) → v1.3.0 全量 |

### v1.2.0 Flag 推出計畫

```
ff.line_notify 推出時程：
  v1.1.0  → disabled (0%)     — 功能開發中
  v1.2.0-rc → enabled (10%)   — 內部測試（資訊部 5 人）
  v1.2.0  → enabled (50%)     — 灰度（班長級 / 50% 使用者）
  v1.2.0p1→ enabled (100%)    — 確認無問題後全量

ff.rag_rerank 推出時程：
  v1.1.0  → disabled (0%)     — 待 cross-encoder 模型評估
  v1.2.0  → enabled (10%)     — 評估準確率提升效果
  v1.3.0  → enabled (100%)    — 確認準確率提升 ≥ 5% 後全量
```

### Feature Flag 決策記錄

| Flag | 廢棄/移除時機 | 說明 |
|------|------------|------|
| `ff.auto_report` | 不廢棄 | 永久功能旗標，供管理員關閉 |
| `ff.line_notify` | 不廢棄 | 永久功能旗標，依工廠需求開關 |
| `ff.rag_rerank` | v1.3.0 後移除旗標 | 全量後直接預設開啟，不需 Flag |

---

## 7. 資料庫遷移策略

### v1.x Schema 演進原則

在 v1.x 週期，所有 DB Schema 變更遵循：
1. **只加不減**：不刪除現有欄位，只新增欄位
2. **新欄位必須 nullable** 或有合理預設值
3. **不修改欄位類型**（SQLite 限制）
4. `init_db()` 使用 `CREATE TABLE IF NOT EXISTS`，保護現有資料

### v1.2.0 預計 Schema 變更

```sql
-- 新增 Equipment 正式資料表
CREATE TABLE IF NOT EXISTS equipment (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    model        TEXT,
    location     TEXT,
    install_date TEXT,
    status       TEXT DEFAULT 'normal',
    tags         TEXT,  -- JSON array
    created_at   DATETIME,
    updated_at   DATETIME
);

-- mqtt_sensor_readings 新增 TTL 索引輔助欄位
-- （實際清理由 background task 執行 DELETE WHERE timestamp < ?）
```

### v2.0.0 PostgreSQL 遷移（見 §3.2）

```
SQLite WAL → Alembic 遷移 → PostgreSQL 15
ChromaDB  → 評估期 →→→→→→→ pgvector
```

---

## 附錄：整合測試環境

### 端到端測試命令

```bash
# v1.1.0 驗收測試清單

# 1. API Health
curl http://localhost/api/health

# 2. Feature Flags 自動植入
curl http://localhost/api/settings/feature-flags | python3 -m json.tool

# 3. VHS 分數查詢
curl "http://localhost/api/vhs/readings?equipment_id=EQ-001&days=7"

# 4. RAG 問答（需先上傳文件）
curl -X POST http://localhost/api/chat/query \
  -H "Content-Type: application/json" \
  -d '{"question": "壓縮機高溫如何處理？", "top_k": 3}'

# 5. 廢棄端點確認（應收到 Deprecation header）
curl -v http://localhost/api/dashboard/equipment 2>&1 | grep -i deprecation

# 6. KPI 報告
python scripts/kpi_report.py --days 7 --format table
```

---

*相關文件：[PROJECT_CHARTER.md](PROJECT_CHARTER.md) | [RISK_MATRIX.md](RISK_MATRIX.md) | [architecture/HIGH_LEVEL_ARCH.md](architecture/HIGH_LEVEL_ARCH.md)*
*ADR 文件：[adr/](adr/)*
