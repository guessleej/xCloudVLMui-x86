## 📝 變更說明（Summary）

> 簡短描述此 PR 的目的與內容（1–3 句話）

<!-- 
例：新增 /api/equipment/{id}/vhs 端點，支援設備 VHS 分數查詢與趨勢圖資料，
並修正 equipment_id 索引缺失導致的慢查詢問題。
-->

---

## 🔗 關聯議題（Linked Issues）

Closes #<!-- issue number -->

---

## 🗂️ 變更類型（Change Type）

<!-- 勾選所有適用項目 -->

- [ ] 🐛 Bug Fix（修正現有功能的問題）
- [ ] ✨ New Feature（新增功能）
- [ ] ♻️ Refactor（重構，不改變外部行為）
- [ ] 📄 Documentation（僅文件變更）
- [ ] 🧪 Tests（新增或修改測試）
- [ ] 🔧 Chore（建置工具、CI/CD、依賴更新）
- [ ] ⚡ Performance（效能改善）
- [ ] 🔒 Security（安全性修補）
- [ ] 💥 Breaking Change（不向下相容的變更）

---

## 🧪 測試計畫（Test Plan）

<!-- 描述如何驗證此變更是正確的 -->

- [ ] 新增 / 更新 unit tests（`pytest tests/unit/`）
- [ ] 新增 / 更新 integration tests（`pytest tests/integration/`）
- [ ] 手動測試（請說明步驟）：

```
# 測試步驟（如有）
1. 
2. 
3. 
```

- [ ] 測試覆蓋率維持 ≥ 70%（`pytest --cov`）

---

## 📋 合併前檢查清單（Pre-Merge Checklist）

### 程式碼品質
- [ ] `ruff check backend/` 無 error
- [ ] `black --check backend/` 格式符合
- [ ] `mypy backend/` 無型別錯誤
- [ ] `npm run lint` 前端 lint 通過
- [ ] `npx tsc --noEmit` TypeScript 型別檢查通過

### 功能正確性
- [ ] CI 所有 jobs 均為綠燈（✅）
- [ ] 新 API 端點已更新 OpenAPI schema（`/docs` 可正確顯示）
- [ ] 資料庫 schema 變更已更新 `db_models.py` 對應的 `Mapped` 欄位
- [ ] 向後相容性：現有 API 不受影響（或已提供 deprecation shim）

### 文件
- [ ] 重大變更已更新 `CHANGELOG.md`（Unreleased 區段）
- [ ] 新 ADR 決策已記錄至 `docs/adr/ADR-XXX-*.md`（如適用）
- [ ] 環境變數新增已更新 `.env.example`

### 安全性
- [ ] 無機密資料（token、密碼、金鑰）硬編碼在程式碼中
- [ ] 輸入驗證已到位（Pydantic schemas 或前端 zod schema）
- [ ] 新依賴套件已確認 License 相容（Apache 2.0 / MIT / BSD）

---

## 🖼️ 畫面截圖（Screenshots）

<!-- 如有 UI 變更，請附上 Before / After 截圖 -->

| Before | After |
|--------|-------|
|        |       |

---

## 📌 備注（Notes for Reviewers）

<!-- 需要特別說明的設計決策、已知限制、或請求 reviewer 重點審查的部分 -->

---

> **Reviewer 指引**：請確認程式碼符合 [CONTRIBUTING.md](../CONTRIBUTING.md) 規範。
> 如有疑問請在對應程式碼行留言，不要直接修改。
