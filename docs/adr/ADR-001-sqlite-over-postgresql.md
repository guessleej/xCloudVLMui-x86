# ADR-001：選用 SQLite 而非 PostgreSQL 作為主資料庫

| 欄位       | 內容                                                         |
|-----------|--------------------------------------------------------------|
| **狀態**  | ✅ 已採納（Accepted）                                         |
| **日期**  | 2025-12-01                                                   |
| **決策者** | 架構師、後端工程師                                            |
| **關聯**  | ADR-003（ChromaDB）、docker-compose.yml `backend-data` volume |

---

## 背景與問題

xCloudVLMui Platform 部署於 **Advantech AIR-030（Jetson AGX Orin 64GB）** 工業邊緣計算主機。
此裝置在產線環境中單機獨立運作，無法依賴外部網路或雲端資料庫服務。

系統需要：
- 持久化設備警報、VHS 評分、維修報告、RAG 文件索引、MQTT 感測器閾值
- 支援中低並發 API 查詢（工廠內儀表板，< 10 同時使用者）
- 容器部署最小化，不增加額外服務

---

## 評估的方案

### 方案 A：SQLite（aiosqlite + SQLAlchemy async）

**優點：**
- 零基礎設施額外成本；資料以單一 `.db` 檔儲存在 `backend-data` volume
- 完整的 ACID 交易支援，WAL 模式下讀寫效能優異
- Python ecosystem 原生支援（stdlib + aiosqlite async adapter）
- 備份只需 `cp xcloudvlm.db xcloudvlm.db.bak`

**缺點：**
- 不支援多機橫向擴展（單節點限制）
- 高並發寫入（> 100 TPS）效能瓶頸
- 缺乏內建 CDC（Change Data Capture）

### 方案 B：PostgreSQL + pgvector

**優點：**
- 工業級並發支援，可橫向擴展
- pgvector 可統一向量搜尋與業務資料庫
- 豐富的 JSON 操作能力

**缺點：**
- 需額外 Docker 服務（+1 container，+256MB+ 記憶體）
- AIR-030 已受 llama.cpp GPU 記憶體佔用限制
- 設定、備份、版本升級複雜度顯著提高
- 工廠單機部署無需多節點一致性保證

### 方案 C：TiDB Serverless（雲端）

**缺點：**
- 強依賴外部網路，不符合離線工廠環境要求
- 資料主權與安全性問題

---

## 決策

**選用 SQLite（方案 A）。**

理由：

1. **工業邊緣場景資料量低**：AIR-030 管理 ≤ 50 台設備，每台每日最多數百筆感測器讀值。
   SQLite WAL 模式可輕鬆承受此負載。

2. **最低基礎設施複雜度**：工廠環境優先可靠性。每減少一個 Docker service 就減少一個故障點。

3. **備份簡單**：`rsync xcloudvlm.db` 即完成備份，符合製造業 MES 備份要求。

4. **向量資料庫獨立處理**：語意搜尋由 ChromaDB 負責（見 ADR-003），
   SQLite 僅儲存結構化業務資料，避免 pgvector 的額外複雜度。

---

## 後果與限制

- ✅ 容器服務數維持 7 個，符合 AIR-030 資源預算
- ✅ 系統可在無網路環境下完整運作
- ⚠️ 若未來需支援 > 5 個廠房聯網監控，**v2.0.0 應遷移至 PostgreSQL**
- ⚠️ 需定期監控 DB 檔案大小（`scripts/kpi_report.py` 報告包含 DB size）
- 📋 感測器時序資料（MQTT readings）應設定 TTL 清理（90 天），
  防止 DB 膨脹（見 P3-2 syslog_cleanup_task）

---

## 後續行動

- [ ] v1.2.0：實作 `mqtt_sensor_readings` 180 天 TTL 清理
- [ ] v2.0.0 評估：若並發使用者 > 50 或設備 > 200 台，觸發 PostgreSQL 遷移
