# Changelog — xCloudVLMui Platform

本專案遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-TW/)
與 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/) 規範。

格式說明：
- **Added**    — 新功能
- **Changed**  — 現有功能變更
- **Deprecated** — 即將移除的功能
- **Removed**  — 已移除的功能
- **Fixed**    — 錯誤修正
- **Security** — 安全性相關修正

---

## [Unreleased]

### Added
- 待規劃：Equipment DB 資料表（替換靜態 Mock）
- 待規劃：LINE Notify 整合輸出通道
- 待規劃：前端路由遷移至 v1.1.0 新 API 端點

---

## [1.1.0] — 2026-04-10

### Added — P0 架構修正

- **MQTT Broker 服務宣告**：`docker-compose.yml` 新增 `eclipse-mosquitto:2.0` 服務，
  修正先前 `mqtt_broker_host: mqtt-broker` 指向不存在容器的錯誤
- **MQTT Named Volumes**：新增 `mosquitto-data`、`mosquitto-log` 具名掛載，確保資料持久化
- **健康檢查強化**：`GET /api/health` 改為三合一真實探測
  - `db_ok`：aiosqlite `SELECT 1`（不再硬編碼 True）
  - `llm_ok`：HTTP GET llama.cpp `/health`
  - `mqtt_ok`：TCP asyncio.open_connection 到 Mosquitto Broker
  - `chroma_ok`：ChromaDB 本機可用性
- **HealthResponse 新增 `mqtt_ok` 欄位**：schemas.py 版本與新欄位同步

### Changed — P0 正名與版本統一

- **專案正名為「xCloudVLMui Platform」**，以下 6 處同步更新：
  - `docker-compose.yml` → `name: xcloudvlmui-platform`
  - `backend/config.py` → `app_name = "xCloudVLMui Platform"`
  - `backend/main.py` → FastAPI title 與所有字串
  - `backend/.env.example` → `APP_NAME=xCloudVLMui Platform`
  - `frontend/package.json` → `"name": "xcloudvlmui-platform"`
  - `Makefile` → 標題列與 help 文字
- **版本號統一為 `1.1.0`**：
  - `backend/main.py` FastAPI `version="1.1.0"`
  - `backend/models/schemas.py` `HealthResponse.version` 預設值
  - `frontend/package.json` `"version": "1.1.0"`

### Added — P1 架構重構

- **`backend/routers/_shared_data.py`**：抽取 dashboard.py 的 Mock 設備資料與 DB 種子函式，
  供多個 Router 共用（消除重複）
- **`backend/routers/equipment.py`**：設備管理路由（`/api/equipment`），單一職責
  - `GET /api/equipment` — 設備清單
  - `GET /api/equipment/summary` — 統計摘要
  - `GET /api/equipment/{id}` — 單一設備
- **`backend/routers/vhs.py`**：VHS 健康評分路由（`/api/vhs`）
  - `GET /api/vhs/trend/{equipment_id}` — 14 天趨勢（DB-first + estimated fallback）
  - `POST /api/vhs/readings` — 寫入 VHS 評分
- **`backend/routers/alerts.py`**：設備警報 CRUD（`/api/alerts`）
  - 完整 CRUD + PATCH resolve（含 409 衝突保護）
  - 依嚴重度（critical > elevated > moderate > low）排序
- **`backend/routers/pipeline.py`**：管線狀態路由（`/api/pipeline`）
  - `GET /api/pipeline/status` — asyncio.gather 並行探測，四段即時狀態
- **`backend/routers/knowledge.py`**：知識文件管理路由（`/api/knowledge`）
  - 文字文件與圖片（OCR）上傳、列表、刪除
- **`backend/routers/chat.py`**：RAG 問答路由（`/api/chat`）
  - `POST /api/chat/query` — 語意搜尋 + Gemma 4 E4B 生成回答
- **`backend/adapters/`**：適配器層（Adapter Layer）
  - `base.py` — `ISensorAdapter` / `ILLMAdapter` / `IVectorStoreAdapter` Protocol 定義
  - `llama_cpp_adapter.py` — llama.cpp REST API 適配器
  - `mqtt_adapter.py` — Eclipse Mosquitto MQTT 適配器（含 TCP Probe）
  - `chroma_adapter.py` — ChromaDB 向量資料庫適配器
- **`backend/tests/`**：測試目錄結構
  - `conftest.py` — pytest fixture（in-memory SQLite、AsyncClient）
  - `unit/test_vhs.py` — VHS 評分純函式單元測試（7 cases）
  - `unit/test_alerts.py` — 警報 CRUD 單元測試（10 cases）
  - `integration/test_equipment_api.py` — 設備 API 整合測試（8 cases）
  - `integration/test_health_api.py` — 健康檢查 API 整合測試（6 cases）
- **`backend/requirements-dev.txt`**：開發與測試依賴
- **`backend/pyproject.toml`**：Ruff + Black + mypy 設定

### Deprecated

- **`/api/dashboard/*`**：所有 dashboard 路由已棄用，由對應新路由取代，
  將於 **v1.3.0** 移除
- **`/api/rag/*`**：RAG 舊路由已棄用，改用 `/api/knowledge` 與 `/api/chat`，
  將於 **v1.3.0** 移除

### Fixed

- 修正 `backend/config.py` 中 `mqtt_broker_host` 預設值由 `mqtt-broker`
  改為 `mosquitto`，與 docker-compose.yml 容器名稱一致
- 修正 `asyncio` 模組原本在 lifespan 內部條件式 import，改為模組頂層 import，
  確保 health_check TCP 探測可正確使用

---

## [1.0.0] — 初始版本

### Added

- AIR-030 工廠設備健康管理平台基礎架構
- 7 服務 Docker Compose 部署（model-init / llama-cpp / vlm-webui / backend / frontend / nginx）
- FastAPI + SQLAlchemy async 後端（aiosqlite + Pydantic v2）
- Next.js 14 App Router 前端 + NextAuth OAuth 認證
- ChromaDB 本機 RAG 知識庫
- MQTT 感測器資料收集（aiomqtt + 指數退避重連）
- VLM 視覺問答（llama.cpp OpenAI-compatible API）
- 設備健康分數（VHS）趨勢追蹤

---

[Unreleased]: https://github.com/guessleej/xCloudVLMui/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/guessleej/xCloudVLMui/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/guessleej/xCloudVLMui/releases/tag/v1.0.0
