# xCloudVLMui Platform — CI/CD 流水線設計（CI/CD Pipeline Design）

| 欄位         | 內容                  |
|-------------|----------------------|
| **文件版本** | v1.1.0               |
| **建立日期** | 2026-04-12           |
| **最後更新** | 2026-04-12           |
| **負責人**   | 系統架構師 / IT 運維  |

---

## 目錄

1. [流水線總覽](#1-流水線總覽)
2. [CI 流水線設計（ci.yml）](#2-ci-流水線設計ciyml)
3. [Release 流水線設計（release.yml）](#3-release-流水線設計releaseyml)
4. [分支策略](#4-分支策略)
5. [品質門檻定義](#5-品質門檻定義)
6. [環境矩陣](#6-環境矩陣)
7. [Secrets 管理](#7-secrets-管理)
8. [失敗處理策略](#8-失敗處理策略)

---

## 1. 流水線總覽

```
開發者本機
    │  git push / PR
    ▼
┌─────────────────────────────────────────────────────────────┐
│              GitHub Actions — CI Pipeline                   │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ backend-lint │  │ backend-test │  │  coverage-report │  │
│  │              │  │              │  │                  │  │
│  │ Ruff + Black │  │ pytest       │  │ Upload Artifact  │  │
│  │ mypy         │  │ ≥ 70% cov    │  │                  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────────┘  │
│         │                 │                  │              │
│         └─────────────────┴──────────────────┘              │
│                           │                                 │
│  ┌──────────────┐         │         ┌──────────────────┐   │
│  │frontend-lint │         │         │   docker-build   │   │
│  │              │         │         │                  │   │
│  │ ESLint + TS  │         │         │ Build images     │   │
│  └──────┬───────┘         │         └──────┬───────────┘   │
│         │                 │                │               │
│         └─────────────────┴────────────────┘               │
│                           │                                 │
│                    ┌──────▼──────┐                          │
│                    │  ci-status  │                          │
│                    │  (全部通過) │                          │
│                    └─────────────┘                          │
└─────────────────────────────────────────────────────────────┘
    │  push tag v*.*.*
    ▼
┌─────────────────────────────────────────────────────────────┐
│              GitHub Actions — Release Pipeline              │
│                                                             │
│  validate-tag → build-push → create-release → summary      │
│                                                             │
│  映像推送：ghcr.io/{owner}/xcloudvlmui-{service}:{tag}     │
│  平台支援：linux/amd64 + linux/arm64                        │
└─────────────────────────────────────────────────────────────┘
    │  部署至 AIR-030
    ▼
docker compose pull && docker compose up -d
```

---

## 2. CI 流水線設計（ci.yml）

### 2.1 觸發條件

```yaml
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
  workflow_dispatch:   # 手動觸發
```

| 事件 | 觸發分支 | 說明 |
|------|---------|------|
| `push` | main, develop | 每次推送自動執行 |
| `pull_request` | main, develop | PR 開啟/更新時執行 |
| `workflow_dispatch` | 任意 | 手動觸發（除錯用） |

**並發控制**：同一 ref 的舊 run 自動取消，避免資源浪費：
```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

---

### 2.2 Jobs 依賴圖

```
backend-lint ──┐
               ├──→ ci-status（全部通過才算 CI ✅）
backend-test ──┤
               │
coverage-report（depends: backend-test）
               │
frontend-lint ─┤
               │
docker-build ──┘
```

---

### 2.3 Job 詳細設計

#### Job 1：backend-lint

| 項目 | 設定 |
|------|------|
| Runner | ubuntu-latest |
| Python | 3.11（pip cache） |
| 工作目錄 | `backend/` |
| 工具 | Ruff（Lint）, Black（Format）, mypy（型別）|
| 失敗策略 | Ruff/Black → 強制失敗；mypy → `continue-on-error: true`（v1.2.0 升為強制）|

**執行指令：**
```bash
ruff check . --output-format=github
black --check --diff .
mypy . --ignore-missing-imports --no-strict-optional
```

**v1.2.0 改進計畫：** 移除 mypy `continue-on-error`，強制型別檢查通過（TD-004）

---

#### Job 2：backend-test

| 項目 | 設定 |
|------|------|
| Runner | ubuntu-latest |
| Python | 3.11 |
| 工作目錄 | `backend/` |
| 測試框架 | pytest + pytest-asyncio + pytest-cov |
| 品質門檻 | 覆蓋率 ≥ 70%（`--cov-fail-under=70`）|

**環境變數（CI 隔離）：**
```yaml
env:
  DATABASE_URL:       sqlite+aiosqlite:///:memory:
  CHROMA_PERSIST_DIR: /tmp/chroma_test
  MQTT_ENABLED:       "false"
  LLM_BASE_URL:       http://localhost:8080
  NEXTAUTH_SECRET:    ci-test-secret
  ALLOWED_ORIGINS:    '["http://localhost:3000"]'
```

**執行指令：**
```bash
pytest tests/ -v \
  --cov=. --cov-report=xml --cov-report=term-missing \
  --cov-fail-under=70 \
  -p no:warnings
```

**v1.2.0 改進計畫：** 覆蓋率門檻提升至 70%（TD-003，目前 continue-on-error）

---

#### Job 3：coverage-report

| 項目 | 設定 |
|------|------|
| 依賴 | backend-test |
| 功能 | 上傳 coverage.xml 至 GitHub Artifacts |
| 保留時間 | 30 天 |

---

#### Job 4：frontend-lint

| 項目 | 設定 |
|------|------|
| Runner | ubuntu-latest |
| Node.js | 20（npm cache） |
| 工作目錄 | `frontend/` |
| 工具 | ESLint（`next lint`）, TypeScript（`tsc --noEmit`）|
| 失敗策略 | 任一失敗 → CI 阻斷 |

**執行指令：**
```bash
npm ci
npm run lint        # next lint
npm run type-check  # tsc --noEmit
```

---

#### Job 5：docker-build

| 項目 | 設定 |
|------|------|
| Runner | ubuntu-latest |
| 功能 | 驗證 backend + frontend Docker 映像可正確建置 |
| 是否推送 | ❌ 僅 `--load`（本地驗證），不推送 |
| 使用 | `docker/build-push-action@v6` |

**目的：** 確保 Dockerfile 沒有語法錯誤，依賴可正確解析。

---

#### Job 6：ci-status

| 項目 | 設定 |
|------|------|
| 依賴 | backend-lint, backend-test, frontend-lint, docker-build |
| 功能 | 全部 jobs 通過才輸出成功，提供 PR Status Check 參考 |

---

## 3. Release 流水線設計（release.yml）

### 3.1 觸發條件

```yaml
on:
  push:
    tags:
      - 'v*.*.*'    # Semantic Versioning：v1.1.0、v1.2.0 等
```

只有 `vMAJOR.MINOR.PATCH` 格式的 tag 才觸發 Release 流程。

---

### 3.2 Jobs 依賴圖

```
validate-tag → build-push → create-release → release-summary
```

---

### 3.3 Job 詳細設計

#### Job 1：validate-tag

驗證 tag 格式符合 `vX.Y.Z`，防止非 SemVer tag 觸發 Release。

---

#### Job 2：build-push

| 項目 | 設定 |
|------|------|
| Runner | ubuntu-latest |
| 建置目標 | backend + frontend |
| 目標平台 | `linux/amd64,linux/arm64`（multi-arch） |
| 容器倉庫 | GitHub Container Registry (GHCR) |
| 映像名稱格式 | `ghcr.io/{owner}/xcloudvlmui-{service}:{tag}` |
| Cache | GitHub Actions Cache（減少重複建置時間）|

**映像標籤策略：**
```
ghcr.io/{owner}/xcloudvlmui-backend:v1.1.0   ← 版本標籤
ghcr.io/{owner}/xcloudvlmui-backend:latest   ← 最新版本
ghcr.io/{owner}/xcloudvlmui-frontend:v1.1.0
ghcr.io/{owner}/xcloudvlmui-frontend:latest
```

**Required Secrets：**
- `GITHUB_TOKEN`（自動提供，GHCR 寫入權限）

---

#### Job 3：create-release

| 項目 | 設定 |
|------|------|
| 功能 | 從 `CHANGELOG.md` 提取對應版本變更內容 |
| 輸出 | GitHub Release（含 Release Notes）|
| 工具 | `actions/create-release` 或 `softprops/action-gh-release` |

---

#### Job 4：release-summary

輸出發佈摘要至 GitHub Actions Summary（映像名稱、平台、版本）。

---

## 4. 分支策略

```
main          ─── 生產就緒（只能透過 PR 合併）
  ├── develop ─── 開發整合分支（功能 PR 目標）
  │     ├── feature/{ticket}-{description}   功能開發
  │     ├── fix/{ticket}-{description}       Bug 修復
  │     ├── hotfix/{ticket}-{description}    緊急修復（可直接 → main）
  │     └── chore/{description}              維運/文件
  └── release/v{X.Y.Z}   發佈準備（凍結功能，只修 bug）
```

### 分支保護規則（Branch Protection）

| 分支 | 規則 |
|------|------|
| `main` | ① 至少 1 名 Reviewer 核准；② CI 全部 pass；③ 禁止 force push |
| `develop` | ① CI 全部 pass；② 禁止 force push |

---

## 5. 品質門檻定義

| 門檻 | 當前值 | 目標值（v1.2.0）| 阻斷條件 |
|------|--------|----------------|---------|
| 後端測試覆蓋率 | ≥ 50%（CI 當前）| ≥ 70% | 未達標阻斷 PR merge |
| mypy 型別錯誤 | continue-on-error | 0 errors | v1.2.0 升為強制 |
| Ruff Lint 錯誤 | 0 | 0 | 立即阻斷 |
| Black 格式錯誤 | 0 | 0 | 立即阻斷 |
| ESLint 錯誤 | 0 | 0 | 立即阻斷 |
| TypeScript 型別錯誤 | 0 | 0 | 立即阻斷 |
| Docker Build 失敗 | 0 | 0 | 立即阻斷 |

### v1.2.0 新增門檻

| 門檻 | 工具 | 說明 |
|------|------|------|
| 容器安全漏洞掃描 | Trivy | HIGH/CRITICAL CVE → 阻斷 Release |
| mypy 強制型別 | mypy --strict | 移除 continue-on-error（TD-004）|
| 覆蓋率門檻升至 70% | pytest-cov | 阻斷 PR merge（TD-003）|

---

## 6. 環境矩陣

| 環境 | 設定檔 | 用途 | 部署方式 |
|------|--------|------|---------|
| **本機開發（macOS）** | `docker-compose.mac.yml` | 開發測試 | `make dev` |
| **CI 測試** | GitHub Actions | 自動化驗證 | 自動觸發 |
| **生產（AIR-030）** | `docker-compose.yml` | 實際運行 | `make up` |
| **Release 映像倉庫** | GHCR | 版本交付 | `docker pull` |

---

## 7. Secrets 管理

| Secret 名稱 | 用途 | 存放位置 |
|------------|------|---------|
| `GITHUB_TOKEN` | GHCR 推送（自動提供）| GitHub Actions 內建 |
| `HF_TOKEN` | HuggingFace 模型下載（生產環境）| `.env`（不提交 Git）|
| `NEXTAUTH_SECRET` | JWT 簽名 | `.env.local`（不提交 Git）|
| `GOOGLE_CLIENT_*` | OAuth（若啟用）| `.env.local`（不提交 Git）|

### Secret 安全原則

1. **所有 Secrets 存放於 `.env` / `.env.local`**，已加入 `.gitignore`
2. **CI 環境使用 mock 值**（`ci-test-secret`），不注入真實 Secrets
3. **GHCR 推送使用 `GITHUB_TOKEN`**（自動短效令牌，無需手動管理）
4. **v1.2.0 加入 pre-commit secret scanning**（防止意外提交 TD-013）

---

## 8. 失敗處理策略

### CI 失敗分類

| 失敗類型 | 影響 | 處理方式 |
|---------|------|---------|
| Lint 失敗 | PR 阻斷 | 本機修正後重新 push |
| 測試失敗 | PR 阻斷 | 修正測試或業務邏輯 |
| 覆蓋率不足 | PR 阻斷（v1.2.0）| 補充測試案例 |
| Docker Build 失敗 | PR 阻斷 | 修正 Dockerfile 或依賴 |
| mypy 型別錯誤 | 警告（v1.1.0）/ 阻斷（v1.2.0+）| 修正型別標注 |

### Release 失敗處理

```
Tag 推送後 Release 失敗
  ├── validate-tag 失敗 → 刪除 tag，修正版本號後重推
  ├── build-push 失敗   → 檢查 Dockerfile；本機驗證後重推 tag
  └── create-release 失敗 → 手動在 GitHub 建立 Release
```

---

## 相關連結

| 文件 | 路徑 |
|------|------|
| CI 工作流實作 | `.github/workflows/ci.yml` |
| Release 工作流實作 | `.github/workflows/release.yml` |
| 分支命名規範 | `CONTRIBUTING.md §2` |
| 品質門檻 SLO | `docs/KPI_METRICS.md §3` |
| 技術債務（mypy / 覆蓋率）| `docs/CONTINUOUS_IMPROVEMENT.md §4` |

---

*相關文件：[CONTRIBUTING.md](../CONTRIBUTING.md) | [KPI_METRICS.md](KPI_METRICS.md) | [CONTINUOUS_IMPROVEMENT.md](CONTINUOUS_IMPROVEMENT.md)*
