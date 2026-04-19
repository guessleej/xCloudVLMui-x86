# Contributing to xCloudVLMui Platform

| 欄位         | 內容         |
|-------------|-------------|
| **文件版本** | v1.1.0       |
| **建立日期** | 2026-04-11   |
| **適用版本** | v1.1.0+      |

感謝您對 xCloudVLMui Platform 的貢獻！本文件說明開發流程、命名規範與提交標準。

---

## 目錄

1. [開發環境設置](#1-開發環境設置)
2. [分支命名規範](#2-分支命名規範)
3. [Commit 訊息規範（Conventional Commits）](#3-commit-訊息規範conventional-commits)
4. [Pull Request 流程](#4-pull-request-流程)
5. [程式碼審查清單](#5-程式碼審查清單)
6. [後端開發指南](#6-後端開發指南)
7. [前端開發指南](#7-前端開發指南)
8. [測試規範](#8-測試規範)
9. [文件規範](#9-文件規範)

---

## 1. 開發環境設置

### 先決條件

| 工具 | 最低版本 | 用途 |
|------|---------|------|
| Python | 3.11 | 後端開發 |
| Node.js | 20 LTS | 前端開發 |
| Docker | 24.0 | 容器化部署 |
| Docker Compose | 2.24 | 服務編排 |
| Git | 2.40 | 版本控制 |

### 後端設置

```bash
# 1. 建立虛擬環境
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 2. 安裝開發依賴
pip install -r requirements.txt
pip install -r requirements-dev.txt

# 3. 設定環境變數
cp ../.env.example ../.env
# 編輯 .env，填入必要設定

# 4. 安裝 pre-commit hooks
cd ..
pip install pre-commit
pre-commit install
pre-commit install --hook-type commit-msg
```

### 前端設置

```bash
cd frontend
npm ci
cp .env.local.example .env.local
# 編輯 .env.local，設定 NEXTAUTH_SECRET 等
```

### 本地啟動（Docker Compose）

```bash
# 完整服務啟動（首次需下載模型，約 2.5GB）
docker compose up -d

# 僅啟動後端服務（不含 llama.cpp，適合後端開發）
docker compose up -d backend frontend nginx mosquitto

# 查看日誌
docker compose logs -f backend
```

---

## 2. 分支命名規範

所有開發工作必須在獨立分支進行，**禁止直接提交至 `main` 分支**。

### 分支前綴

| 前綴 | 用途 | 範例 |
|------|------|------|
| `feat/` | 新功能開發 | `feat/mqtt-tls-support` |
| `fix/` | Bug 修正 | `fix/sqlite-lock-timeout` |
| `chore/` | 建置工具、依賴更新、CI/CD | `chore/update-ruff-v0.5` |
| `docs/` | 僅文件變更 | `docs/add-api-usage-guide` |
| `refactor/` | 重構（不改變外部行為） | `refactor/vhs-service-spr` |
| `test/` | 新增或修改測試 | `test/mqtt-service-unit` |
| `perf/` | 效能改善 | `perf/chroma-batch-embed` |
| `security/` | 安全性修補 | `security/jwt-expiry-check` |

### 命名規則

- 全小寫，使用 `-` 分隔詞語（kebab-case）
- 描述要具體，避免 `fix-bug`、`update` 等模糊名稱
- 若有對應 Issue，建議加入 issue 編號：`feat/42-line-notify`

```bash
# 正確
git checkout -b feat/equipment-db-crud
git checkout -b fix/87-chroma-index-rebuild
git checkout -b docs/risk-matrix-v1.1

# 錯誤
git checkout -b feature_new        # 使用 _ 而非 -
git checkout -b Fix-Bug-123        # 大寫
git checkout -b my-branch          # 語意不明
```

---

## 3. Commit 訊息規範（Conventional Commits）

本專案遵循 [Conventional Commits v1.0.0](https://www.conventionalcommits.org/zh-hant/v1.0.0/) 規範。
CHANGELOG 由 CI 從 commit 訊息自動產生。

### 格式

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### Type 清單

| Type | 觸發 CHANGELOG 章節 | 說明 |
|------|-------------------|------|
| `feat` | ✅ Features | 新功能 |
| `fix` | ✅ Bug Fixes | Bug 修正 |
| `perf` | ✅ Performance | 效能改善 |
| `refactor` | — | 重構（不含新功能或 bug 修正） |
| `docs` | — | 文件變更 |
| `test` | — | 測試相關 |
| `chore` | — | 建置工具、依賴更新 |
| `ci` | — | CI/CD 設定 |
| `style` | — | 格式調整（不影響邏輯） |
| `revert` | ✅ Reverts | 還原前一個 commit |

**破壞性變更**：在 footer 加上 `BREAKING CHANGE:` 或在 type 後加 `!`

### Scope 建議

| Scope | 說明 |
|-------|------|
| `backend` | 後端（FastAPI）整體 |
| `frontend` | 前端（Next.js）整體 |
| `equipment` | equipment router/service |
| `vhs` | VHS 評分相關 |
| `alerts` | 警報系統 |
| `mqtt` | MQTT 服務 |
| `rag` | RAG / 知識庫 |
| `vlm` | VLM 視覺推論 |
| `llm` | llama.cpp 整合 |
| `db` | 資料庫模型 / migration |
| `ci` | CI/CD workflows |
| `docker` | Docker Compose 設定 |
| `docs` | 文件 |

### 範例

```bash
# 新功能
feat(mqtt): add TLS support for Mosquitto broker (port 8883)

# Bug 修正
fix(vhs): prevent division by zero when equipment has no readings

# 重構（不含功能變更）
refactor(rag): extract chunk extraction logic to _shared_data.py

# 文件
docs(adr): add ADR-005 for MQTT TLS decision

# 破壞性變更
feat(api)!: rename /api/rag/query to /api/chat/query

BREAKING CHANGE: The /api/rag/query endpoint is removed. Use /api/chat/query instead.
Deprecation shim available until v1.3.0.

# 簡短修正
fix(db): add busy_timeout pragma to prevent SQLite lock errors
```

### 禁止的 commit 訊息

```bash
# ❌ 模糊不清
git commit -m "fix"
git commit -m "update code"
git commit -m "WIP"
git commit -m "asdf"

# ❌ 未遵循格式（大寫開頭、沒有 type）
git commit -m "Added new feature"
git commit -m "Fixed bug #123"
```

---

## 4. Pull Request 流程

### 開啟 PR 前的自我檢查

```bash
# 後端
cd backend
ruff check .
black --check .
mypy .
pytest tests/ -v --cov=. --cov-report=term-missing

# 前端
cd frontend
npm run lint
npx tsc --noEmit
npm run build
```

### PR 流程

```
feature branch → PR → Code Review → CI pass → Merge to main
```

1. **開啟 PR**
   - 使用 `.github/PULL_REQUEST_TEMPLATE.md` 填寫說明
   - 關聯對應 Issue（`Closes #XXX`）
   - 指派至少 1 位 Reviewer

2. **CI 自動檢查**（所有 jobs 必須通過）
   - `backend-lint`：Ruff + Black + mypy
   - `backend-test`：pytest（覆蓋率 ≥ 70%）
   - `frontend-lint`：ESLint + tsc
   - `docker-build`：確認 Docker image 可成功建置

3. **Code Review**
   - 至少 1 位 Reviewer 核准（approve）
   - 所有 Review 留言需回應或解決後才能 merge

4. **Merge 策略**
   - 使用 **Squash and Merge**（保持 main branch history 乾淨）
   - Merge commit 訊息格式：`type(scope): description (#PR號)`

5. **Merge 後**
   - 刪除 feature branch
   - 確認 CHANGELOG.md `[Unreleased]` 區段已記錄

### Draft PR

尚未完成的 PR 請使用 **Draft PR** 狀態，避免被誤 merge。
Draft PR 不會觸發 Code Review 請求，但仍會執行 CI。

---

## 5. 程式碼審查清單

### Reviewer 應確認

#### 正確性
- [ ] 邏輯正確，沒有明顯的邊界條件錯誤
- [ ] 非同步函數（`async def`）已正確 `await`
- [ ] 例外處理（`try/except`）不過度捕獲，且有適當的 logging

#### 架構
- [ ] 遵循 SRP（單一職責原則）— 每個 router 只負責一個資源域
- [ ] 使用 Adapter 介面（`adapters/base.py`）而非直接呼叫第三方服務
- [ ] 新 API 端點有對應的 Pydantic request/response schema

#### 效能
- [ ] SQLite 查詢有適當的 `index=True`
- [ ] 批次操作使用 `executemany` 或 SQLAlchemy bulk 方法
- [ ] 避免 N+1 查詢（使用 `selectin` 或 `joined` load）

#### 安全性
- [ ] 輸入驗證完整（Pydantic validator）
- [ ] 無硬編碼機密
- [ ] SQL 查詢使用參數化（SQLAlchemy ORM 已預設）

#### 測試
- [ ] 新功能有對應的 unit test
- [ ] Bug fix 有對應的 regression test

---

## 6. 後端開發指南

### 新增 Router 步驟

1. 在 `backend/routers/` 建立新檔案 `{resource}.py`
2. 定義 `router = APIRouter(prefix="/api/{resource}", tags=["{resource}"])`
3. 在 `backend/main.py` import 並掛載
4. 更新 `backend/routers/__init__.py`

### Service 層原則

- 所有業務邏輯放在 `backend/services/{resource}_service.py`
- Router 只負責 HTTP 接收/回應，不含業務邏輯
- Service 使用 `AsyncSession` 參數，不使用全域 session

### DB 操作規範

```python
# ✅ 正確：使用 Depends(get_db) 注入 session
@router.get("/{id}")
async def get_equipment(id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Equipment).where(Equipment.id == id))
    eq = result.scalar_one_or_none()
    if eq is None:
        raise HTTPException(status_code=404, detail="Equipment not found")
    return eq

# ❌ 錯誤：使用全域或模組級 session
from database import engine
async with AsyncSession(engine) as db:  # 不要這樣做
    ...
```

### Feature Flag 使用

```python
# 在 service 中讀取 feature flag
from services.feature_flag_service import is_enabled

async def send_alert(db: AsyncSession, alert: EquipmentAlert) -> None:
    if await is_enabled(db, "ff.line_notify"):
        await _send_line_notification(alert)
```

---

## 7. 前端開發指南

### 目錄結構

```
frontend/src/
├── app/                    # Next.js 14 App Router 頁面
│   ├── (dashboard)/        # 路由群組（不影響 URL）
│   └── api/                # API Routes（NextAuth 等）
├── components/
│   ├── ui/                 # Radix UI + Tailwind 基礎元件
│   └── features/           # 業務功能元件
├── lib/
│   ├── api/                # API 呼叫函數（fetcher）
│   └── utils.ts            # 工具函數
└── types/                  # TypeScript 型別定義
```

### API 呼叫規範

```typescript
// ✅ 使用集中的 fetcher，不在元件中直接 fetch
// lib/api/equipment.ts
export async function getEquipmentList(): Promise<Equipment[]> {
  const res = await fetch('/api/equipment');
  if (!res.ok) throw new Error('Failed to fetch equipment');
  return res.json();
}

// 元件中
const { data, error } = useSWR('/api/equipment', getEquipmentList);
```

### 元件規範

- Server Components 優先（`async` 元件，無 `use client`）
- 需要互動的元件才加 `'use client'`
- Props 使用 TypeScript interface 定義，不用 `any`

---

## 8. 測試規範

### 後端測試結構

```
backend/tests/
├── unit/
│   ├── test_equipment_service.py    # Service 層單元測試
│   ├── test_mqtt_service.py
│   ├── test_rag_service.py
│   └── test_vhs_service.py
├── integration/
│   ├── test_equipment_api.py        # API 端到端測試（含 DB）
│   ├── test_alerts_api.py
│   └── test_chat_api.py
└── conftest.py                      # pytest fixtures
```

### 測試命名規範

```python
# 格式：test_{功能}_{場景}_{預期結果}
def test_create_equipment_valid_payload_returns_201():
    ...

def test_get_vhs_readings_empty_db_returns_empty_list():
    ...

def test_mqtt_threshold_exceeded_creates_alert():
    ...
```

### 非同步測試

```python
import pytest

@pytest.mark.asyncio
async def test_rag_query_returns_sources(async_db_session):
    result = await rag_query(async_db_session, "壓縮機異音")
    assert len(result.sources) > 0
    assert result.latency_ms < 30_000  # 30 秒上限
```

### 覆蓋率目標

| 模組 | 目標覆蓋率 |
|------|-----------|
| `services/` | ≥ 80% |
| `routers/` | ≥ 70% |
| `models/` | ≥ 60% |
| 整體 | ≥ 70% |

---

## 9. 文件規範

### 何時需要更新文件

| 變更類型 | 需更新的文件 |
|---------|------------|
| 新 API 端點 | OpenAPI（自動）+ README（如有重大變更） |
| 架構決策 | `docs/adr/ADR-XXX-*.md` |
| 新功能上線 | `CHANGELOG.md` Unreleased 區段 |
| 版本發布 | `CHANGELOG.md`（release.yml 自動處理） |
| 風險識別 | `docs/RISK_MATRIX.md` |
| 環境變數 | `.env.example` |

### ADR 撰寫時機

以下情況**必須**新增 ADR（架構決策記錄）：
- 選擇或替換核心技術（資料庫、框架、AI 模型）
- 變更 API 設計原則（RESTful → GraphQL 等）
- 決定不使用某個方案的原因
- 有明確技術債務需要記錄

ADR 範本位於：`docs/adr/ADR-001-sqlite-over-postgresql.md`

---

*本文件依據 [Conventional Commits](https://www.conventionalcommits.org/) 與 [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow) 制定。*
*如有疑問，請在 GitHub Discussions 或 Issue 中提出。*
