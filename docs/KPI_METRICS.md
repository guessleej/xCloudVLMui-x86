# xCloudVLMui Platform — 關鍵績效指標（KPI Metrics）

| 欄位         | 內容                  |
|-------------|----------------------|
| **文件版本** | v1.1.0               |
| **建立日期** | 2026-04-11           |
| **最後更新** | 2026-04-11           |
| **負責人**   | PM / 系統架構師 / QA  |

---

## 目錄

1. [KPI 框架設計](#1-kpi-框架設計)
2. [業務 KPI（對應 PROJECT_CHARTER 目標）](#2-業務-kpi對應-project_charter-目標)
3. [技術 SLO 定義](#3-技術-slo-定義)
4. [可量測指標清單（Metrics Registry）](#4-可量測指標清單metrics-registry)
5. [KPI 量測方法](#5-kpi-量測方法)
6. [每週 KPI 報告流程](#6-每週-kpi-報告流程)
7. [KPI 儀表板規格](#7-kpi-儀表板規格)
8. [KPI 審查與改進觸發](#8-kpi-審查與改進觸發)

---

## 1. KPI 框架設計

```
業務目標（PROJECT_CHARTER）
        │
        ▼
  關鍵成果（KR）— 量化的成功標準
        │
        ▼
  可量測指標（Metrics）— 技術層可採集
        │
        ▼
  SLO / SLA — 服務等級承諾
        │
        ▼
  告警閾值（OBSERVABILITY.md §6）
```

### KPI 評分週期

| 週期 | 評分方式 | 輸出物 |
|------|---------|--------|
| **每日** | `kpi_report.py --days 1` 自動執行 | syslog + SQLite |
| **每週** | `kpi_report.py --days 7` 週報 | Markdown 報告 |
| **每月** | 全指標回顧 + RISK_MATRIX 更新 | 月度 KPI Report |
| **每版本** | 版本交付前驗收測試 | Sprint Review |

---

## 2. 業務 KPI（對應 PROJECT_CHARTER 目標）

### B1 — 減少設備非計畫性停機（目標：≥ 30%）

| 指標 | 公式 | 量測來源 | 目標 | 狀態 |
|------|------|---------|------|------|
| **未計畫停機次數** | 月統計計數 | `equipment_alerts` WHERE level='critical' AND source='unplanned' | 月均降低 ≥ 30% | 🔄 基線建立中（v1.1.0） |
| **平均警報解除時間（MTTR）** | `AVG(resolved_at - created_at)` WHERE resolved=true | `equipment_alerts` | < 4 小時 | 🔄 量測中 |
| **預防性維修率** | 預防性工單 / 全部工單 × 100% | `reports` WHERE source='pdm-inspection' | > 60% | 🔄 量測中 |

**量測查詢：**
```sql
-- 月度非計畫停機警報數
SELECT strftime('%Y-%m', created_at) as month,
       COUNT(*) as unplanned_critical
FROM equipment_alerts
WHERE level = 'critical'
GROUP BY month
ORDER BY month DESC LIMIT 12;

-- MTTR 計算
SELECT AVG((julianday(resolved_at) - julianday(created_at)) * 24) as avg_mttr_hours
FROM equipment_alerts
WHERE resolved = TRUE
  AND created_at > datetime('now', '-30 days');
```

---

### B2 — 提升巡檢效率（目標：縮短 ≥ 50%）

| 指標 | 公式 | 量測來源 | 目標 | 狀態 |
|------|------|---------|------|------|
| **VLM 自動巡檢次數** | 週統計 COUNT | `reports` WHERE source='vlm-diagnosis' | ≥ 10 次/週 | ✅ 已量測 |
| **VLM 推論延遲 p95** | histogram_quantile(0.95) | syslog `duration_ms` WHERE action LIKE '%vlm%' | ≤ 30 秒 | 🔄 量測中 |
| **VHS 評分吻合率** | 人工比對樣本 | 人工評估（30 筆樣本）| ≥ 85% | 📋 季度評估 |
| **人工巡檢時間節省** | (人工時間 - VLM 時間) / 人工時間 | 現場工程師回報 | ≥ 50% | 📋 季度評估 |

**量測查詢：**
```sql
-- VLM 推論次數（每週）
SELECT strftime('%Y-W%W', created_at) as week,
       COUNT(*) as vlm_count
FROM reports
WHERE source = 'vlm-diagnosis'
GROUP BY week
ORDER BY week DESC LIMIT 12;

-- VLM 推論延遲 p95（syslog）
SELECT
  (SELECT duration_ms FROM syslog_entries
   WHERE action LIKE '%vlm%' AND status_code = 200
   ORDER BY duration_ms
   LIMIT 1 OFFSET CAST(0.95 * (
     SELECT COUNT(*) FROM syslog_entries
     WHERE action LIKE '%vlm%' AND status_code = 200
   ) AS INTEGER)) as p95_ms;
```

---

### B3 — 建立設備健康知識庫（目標：≥ 20 份 SOP，嵌入率 ≥ 95%）

| 指標 | 公式 | 量測來源 | 目標 | 狀態 |
|------|------|---------|------|------|
| **知識文件總數** | COUNT | `rag_documents` | ≥ 20 份 | 🔄 量測中 |
| **向量嵌入率** | embedded=TRUE / total × 100% | `rag_documents` | ≥ 95% | 🔄 量測中 |
| **RAG 問答相關率** | Top-3 相關 / 總查詢 × 100% | QA 評估集（20 題）| ≥ 80% | 📋 月度評估 |
| **向量庫文件塊數** | ChromaDB collection count | `kpi_report.py` | > 500 塊 | 🔄 量測中 |

**量測查詢：**
```sql
-- 知識庫狀態
SELECT
  COUNT(*) as total_docs,
  SUM(CASE WHEN embedded = TRUE THEN 1 ELSE 0 END) as embedded_docs,
  SUM(CASE WHEN embedded = TRUE THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as embed_rate_pct,
  SUM(chunk_count) as total_chunks
FROM rag_documents;
```

---

### B4 — 即時感測器警報（目標：延遲 ≤ 5 秒）

| 指標 | 公式 | 量測來源 | 目標 | 狀態 |
|------|------|---------|------|------|
| **MQTT 端對端警報延遲** | 感測器 publish → DB INSERT 時間差 | `mqtt_sensor_readings` timestamp vs created_at | ≤ 5 秒 | ✅ 已量測 |
| **感測器在線率** | online=TRUE / total × 100% | `mqtt_devices` | ≥ 95% | 🔄 量測中 |
| **MQTT 訊息品質（QoS 1）** | quality='good' / total × 100% | `mqtt_sensor_readings` | ≥ 99% | 🔄 量測中 |
| **警報誤報率** | 人工確認「誤報」/ 全部 critical 警報 | 人工標記 | < 5% | 📋 月度評估 |

**量測查詢：**
```sql
-- MQTT 訊息品質分佈
SELECT quality, COUNT(*) as cnt,
       COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() as pct
FROM mqtt_sensor_readings
WHERE timestamp > datetime('now', '-24 hours')
GROUP BY quality;

-- 感測器在線率
SELECT
  COUNT(CASE WHEN online = TRUE THEN 1 END) * 100.0 / COUNT(*) as online_rate_pct
FROM mqtt_devices;
```

---

### B5 — 維保工單數位化（目標：100% 系統工單，v2.0.0）

| 指標 | 公式 | 量測來源 | 目標版本 | 狀態 |
|------|------|---------|---------|------|
| **系統工單總數** | COUNT | `reports` WHERE is_deleted=FALSE | 持續增長 | ✅ 已量測 |
| **報告完整率** | markdown_content NOT NULL / total × 100% | `reports` | ≥ 90% | 🔄 量測中 |
| **平均報告產生時間** | VLM 觸發 → 報告完成 | syslog duration_ms | < 60 秒 | 🔄 量測中 |

---

## 3. 技術 SLO 定義

> SLO（Service Level Objective）= 可量測的服務等級目標

| SLO ID | 指標 | 量測方法 | 目標值 | 量測窗口 | 告警閾值 |
|--------|------|---------|--------|---------|---------|
| **SLO-01** | API Uptime | `/api/health` 成功率 | ≥ 99% | 月均 | < 99% |
| **SLO-02** | VLM 推論延遲 p95 | syslog duration_ms p95 | ≤ 30 秒 | 24 小時滑動 | > 30s 連續 3 次 |
| **SLO-03** | MQTT 警報延遲 | 端對端延遲測試 | ≤ 5 秒 | 即時 | > 5s |
| **SLO-04** | RAG 查詢延遲 p95 | syslog duration_ms p95 | ≤ 10 秒 | 24 小時滑動 | > 10s 連續 3 次 |
| **SLO-05** | 測試覆蓋率 | pytest-cov | ≥ 70% | 每次 CI | < 70% 阻斷 PR |
| **SLO-06** | CI 通過率 | GitHub Actions | 100% | 每次 PR | 任何失敗 = 阻斷 merge |
| **SLO-07** | SQLite 回應時間 | SELECT 1 latency | < 100ms | 每次健康檢查 | > 1s |

### SLO 錯誤預算計算

```
SLO-01 (Uptime 99% 月均):
  每月允許停機時間 = 30天 × 24小時 × 60分鐘 × (1 - 0.99) = 432 分鐘 / 月
  ≈ 7.2 小時 / 月

如果超出錯誤預算 → 凍結新功能開發，優先修復穩定性
```

---

## 4. 可量測指標清單（Metrics Registry）

### 系統指標

| 指標 ID | 名稱 | 類型 | 來源 | 更新頻率 |
|---------|------|------|------|---------|
| M-001 | API 請求總數 | Counter | Prometheus `/metrics` | 即時 |
| M-002 | API 請求延遲分佈 | Histogram | Prometheus `/metrics` | 即時 |
| M-003 | API 錯誤率 (5xx) | Gauge | syslog.db 計算 | 每小時 |
| M-004 | 容器記憶體使用量 | Gauge | cAdvisor :8091 | 即時 |
| M-005 | eMMC 磁碟使用量 | Gauge | cAdvisor :8091 | 5 分鐘 |
| M-006 | 服務健康狀態 | Gauge (0/1) | `/api/health` | 20 秒 |

### 業務指標

| 指標 ID | 名稱 | 類型 | 來源 | 更新頻率 |
|---------|------|------|------|---------|
| M-101 | 設備警報總數（依等級）| Counter | `equipment_alerts` | 即時 |
| M-102 | 警報解除率 | Gauge | `equipment_alerts` 計算 | 每日 |
| M-103 | VHS 平均分（依設備）| Gauge | `vhs_readings` | 每次更新 |
| M-104 | VLM 推論次數 | Counter | `reports` | 即時 |
| M-105 | MQTT 訊息接收量 | Counter | `mqtt_sensor_readings` | 即時 |
| M-106 | MQTT 訊息品質率 | Gauge | `mqtt_sensor_readings` 計算 | 每小時 |
| M-107 | RAG 文件數 / 塊數 | Gauge | `rag_documents` | 每次上傳 |
| M-108 | 知識庫嵌入率 | Gauge | `rag_documents` 計算 | 每次上傳 |
| M-109 | 報告產生總數 | Counter | `reports` | 即時 |
| M-110 | 系統錯誤率（24h）| Gauge | `syslog_entries` 計算 | 每小時 |

---

## 5. KPI 量測方法

### 5.1 kpi_report.py 自動收集

```bash
# 完整週報（7天）
python scripts/kpi_report.py \
  --db /data/xcloudvlm.db \
  --syslog /data/syslog.db \
  --days 7 \
  --format table

# 輸出範例：
# ┌─────────────────────────────────────────────┐
# │  xCloudVLMui Platform KPI Report            │
# │  Period: 2026-04-04 → 2026-04-11 (7 days)  │
# ├─────────────────┬──────────┬────────────────┤
# │ Metric          │ Value    │ Target         │
# ├─────────────────┼──────────┼────────────────┤
# │ Total Reports   │ 42       │ ≥ 10/week      │
# │ VLM Inference   │ 28       │ ≥ 10/week      │
# │ Alert Count     │ 5        │ ↓ vs prev week │
# │ Alert Resolved  │ 80.0%    │ ≥ 80%          │
# │ MQTT Quality    │ 99.2%    │ ≥ 99%          │
# │ RAG Docs        │ 23       │ ≥ 20           │
# │ Error Rate      │ 0.3%     │ < 1%           │
# └─────────────────┴──────────┴────────────────┘
```

### 5.2 GitHub Actions 覆蓋率 KPI

```yaml
# ci.yml backend-test job 輸出
# Coverage: 73% (目標 ≥ 70%)
# Coverage Report: artifacts/coverage-report/
```

### 5.3 手動 QA 評估（月度）

| 評估項目 | 方法 | 頻率 | 負責人 |
|---------|------|------|--------|
| VHS 評分吻合率 | 30 筆人工 vs VLM 比對 | 月度 | QA + AI 工程師 |
| RAG 問答相關率 | 20 題評估集 | 月度 | QA + AI 工程師 |
| 使用者滿意度 | 現場工程師問卷 | 季度 | PM |

---

## 6. 每週 KPI 報告流程

```
每週一 09:00（自動）
    │
    ├─ [1] kpi_report.py 執行
    │      python scripts/kpi_report.py --days 7 --format json
    │
    ├─ [2] KPI 指標比對
    │      對比上週數值，計算趨勢（↑↓→）
    │
    ├─ [3] 閾值告警判斷
    │      任一 SLO 未達標 → 開 GitHub Issue（label: kpi-alert）
    │
    └─ [4] RISK_MATRIX 更新（月度）
           調整 R001/R005 等動態風險機率分數
```

### 週報模板

```markdown
## KPI 週報 — Week YYYY-WXX

### 📊 本週摘要
- API Uptime: XX.X% (目標 ≥ 99%)
- VLM 推論次數: XX 次 (目標 ≥ 10 次/週)
- 警報解除率: XX.X% (目標 ≥ 80%)
- MQTT 訊息品質: XX.X% (目標 ≥ 99%)
- 測試覆蓋率: XX% (目標 ≥ 70%)

### 🔴 需要關注
<!-- 未達目標的指標 -->

### ✅ 本週達成
<!-- 符合目標的指標 -->

### 📋 下週行動
<!-- 改進行動項目 -->
```

---

## 7. KPI 儀表板規格

### 7.1 前端 Dashboard 頁面規格

**URL：** `/main/dashboard`（現有頁面）

| 區塊 | 指標 | 視覺化 | 資料來源 |
|------|------|--------|---------|
| 頂部卡片 | 設備總數、今日警報、VLM 次數、知識庫文件 | 數值卡片 | `/api/equipment`, `/api/alerts`, `/api/reports` |
| VHS 趨勢 | 各設備健康分數 7 天趨勢 | 折線圖 | `/api/vhs/readings` |
| 警報分佈 | 近 7 天警報 by 等級 | 長條圖 | `/api/alerts/stats` |
| MQTT 即時 | 感測器讀值最新狀態 | 儀表板 | `/api/mqtt/readings` |
| 系統健康 | db/llm/mqtt/chroma 狀態 | 燈號 | `/api/health` |

### 7.2 前端 KPI 頁面（v1.2.0 新增規劃）

**URL：** `/main/kpi`（規劃中）

| 區塊 | 指標 | 說明 |
|------|------|------|
| SLO 達標率 | 各 SLO 當月達標/未達標 | 進度條 |
| 業務目標進度 | B1-B5 完成度 | 甘特圖 |
| 系統效能趨勢 | API 延遲 30 天趨勢 | 折線圖 |
| 測試覆蓋率歷史 | 每次 CI 覆蓋率 | 面積圖 |

---

## 8. KPI 審查與改進觸發

### 觸發改進行動的 KPI 閾值

| KPI | 正常 | 警告（黃）| 告急（紅）| 行動 |
|-----|------|---------|---------|------|
| API Uptime | ≥ 99% | 98–99% | < 98% | 紅：立即排查；加入 RISK_MATRIX |
| VLM 推論 p95 | ≤ 30s | 30–60s | > 60s | 黃：優化 prompt；紅：降低 ctx-size |
| 測試覆蓋率 | ≥ 70% | 60–70% | < 60% | 黃：補測試；紅：阻斷 PR merge |
| 磁碟使用率 | < 70% | 70–85% | > 85% | 黃：清理計畫；紅：立即清理 |
| MQTT 品質率 | ≥ 99% | 95–99% | < 95% | 黃：查閱 Broker 日誌；紅：重啟 Broker |
| 警報誤報率 | < 5% | 5–10% | > 10% | 黃：調整閾值；紅：關閉自動警報 |

### KPI → CONTINUOUS_IMPROVEMENT 循環

```
KPI 未達標
    │
    ├─ 開立 GitHub Issue（label: kpi-alert, improvement）
    ├─ 更新 RISK_MATRIX.md 對應風險分數
    ├─ 納入下一個 Sprint 改進 Backlog
    └─ Sprint Retrospective 討論根因
         └─ 參見 CONTINUOUS_IMPROVEMENT.md
```

---

*相關文件：[PROJECT_CHARTER.md](PROJECT_CHARTER.md) | [RISK_MATRIX.md](RISK_MATRIX.md) | [OBSERVABILITY.md](OBSERVABILITY.md) | [CONTINUOUS_IMPROVEMENT.md](CONTINUOUS_IMPROVEMENT.md)*
*量測工具：[../../scripts/kpi_report.py](../../scripts/kpi_report.py)*
