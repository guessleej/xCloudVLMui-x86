# xCloudVLMui Platform — 監控與可觀測性（Observability）

| 欄位         | 內容                  |
|-------------|----------------------|
| **文件版本** | v1.1.0               |
| **建立日期** | 2026-04-11           |
| **最後更新** | 2026-04-11           |
| **負責人**   | IT 運維 / 系統架構師  |

---

## 目錄

1. [可觀測性三大柱](#1-可觀測性三大柱)
2. [Logs — 結構化日誌](#2-logs--結構化日誌)
3. [Metrics — 指標端點](#3-metrics--指標端點)
4. [Traces — 關聯追蹤](#4-traces--關聯追蹤)
5. [Health Check 架構](#5-health-check-架構)
6. [告警規則定義](#6-告警規則定義)
7. [儀表板查詢手冊](#7-儀表板查詢手冊)
8. [監控容器部署](#8-監控容器部署)
9. [日誌保留策略](#9-日誌保留策略)

---

## 1. 可觀測性三大柱

```
┌─────────────────────────────────────────────────────────────────┐
│              xCloudVLMui Platform — Observability Stack         │
├─────────────────┬──────────────────────┬────────────────────────┤
│   📋 LOGS       │   📊 METRICS         │   🔍 TRACES            │
│                 │                      │                        │
│ • Docker JSON   │ • /metrics           │ • X-Request-ID header  │
│   stdout logs   │   (Prometheus)       │ • Syslog correlation   │
│ • syslog.db     │ • /api/health        │ • request_id 貫穿      │
│   (audit trail) │   (三合一健康)       │   所有 log 記錄        │
│ • 90天自動清理  │ • cAdvisor 容器指標  │                        │
│                 │   (Port 8091)        │                        │
├─────────────────┴──────────────────────┴────────────────────────┤
│   收集層：docker logs + prometheus scrape + syslog API          │
│   查詢層：kpi_report.py CLI + /api/health + 前端 Dashboard      │
│   告警層：MQTT 閾值告警 + Feature Flag ff.line_notify           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Logs — 結構化日誌

### 2.1 Docker JSON 容器日誌

所有服務使用統一的 `json-file` 日誌驅動（`docker-compose.yml` x-logging anchor）：

```yaml
x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"    # 單檔最大 10MB
    max-file: "5"      # 保留 5 個輪轉檔（總計最多 50MB/服務）
    labels: "service,version"
    env:    "APP_ENV,BUILD_VERSION"
```

**查詢指令：**

```bash
# 即時跟蹤後端日誌
docker compose logs -f backend

# 查看最後 200 行，含時間戳
docker compose logs --tail=200 --timestamps backend

# 所有服務同時輸出
docker compose logs -f --tail=50

# 過濾 ERROR 等級
docker compose logs backend 2>&1 | grep '"level":"ERROR"'

# 查詢特定 request_id
docker compose logs backend 2>&1 | grep '"request_id":"REQ-UUID-HERE"'
```

### 2.2 Syslog 審計資料庫（syslog.db）

FastAPI `SyslogMiddleware` 自動記錄所有 HTTP 寫入操作與錯誤：

| 欄位 | 說明 | 範例 |
|------|------|------|
| `request_id` | X-Request-ID（UUID v4）| `a1b2c3d4-...` |
| `level` | INFO / WARNING / ERROR | `ERROR` |
| `module` | 功能模組 | `mqtt`, `vlm`, `rag` |
| `action` | 操作識別 | `post.knowledge.upload` |
| `message` | HTTP 請求摘要 | `POST /api/vlm/capture → 200` |
| `ip_address` | 客戶端 IP | `192.168.1.100` |
| `status_code` | HTTP 狀態碼 | `200`, `500` |
| `duration_ms` | 請求處理時間 | `1523.4` |
| `created_at` | UTC 時間戳 | `2026-04-11T08:30:00Z` |

**記錄條件：**
- POST / PUT / PATCH / DELETE：全部記錄
- GET：僅記錄 4xx / 5xx 錯誤
- 跳過路徑：`/api/syslog`, `/docs`, `/redoc`, `/_next`, `/static`

**查詢 API：**
```bash
# 最近 100 筆 ERROR 日誌
GET /api/syslog?level=ERROR&limit=100

# 特定時間範圍
GET /api/syslog?start=2026-04-11T00:00:00Z&end=2026-04-11T23:59:59Z
```

**直接 SQLite 查詢：**
```bash
sqlite3 /data/syslog.db \
  "SELECT request_id, module, action, status_code, duration_ms, created_at
   FROM syslog_entries
   WHERE level='ERROR' AND created_at > datetime('now', '-24 hours')
   ORDER BY created_at DESC LIMIT 50;"
```

### 2.3 日誌等級說明

| 等級 | 觸發條件 | 對應行動 |
|------|---------|---------|
| `ERROR` | HTTP 5xx、非預期例外 | 立即查看，可能需要重啟服務 |
| `WARNING` | HTTP 4xx（客戶端錯誤）| 監控頻率，排查使用者操作問題 |
| `INFO` | 正常寫入操作 | 定期審閱，確認業務流程正常 |

---

## 3. Metrics — 指標端點

### 3.1 Prometheus Metrics 端點

**端點：** `GET /metrics`（Port 8000，由 Nginx 代理至 Port 80）

**技術：** `prometheus-fastapi-instrumentator` 自動插樁

```bash
# 查看所有指標
curl http://localhost/metrics

# 過濾 HTTP 請求指標
curl -s http://localhost/metrics | grep http_requests
```

### 3.2 關鍵指標清單

#### HTTP 請求指標（自動收集）

| 指標名稱 | 類型 | 說明 |
|---------|------|------|
| `http_requests_total` | Counter | 請求總數，標籤：method, handler, status |
| `http_request_duration_seconds` | Histogram | 請求處理時間分佈（p50/p95/p99）|
| `http_request_size_bytes` | Histogram | 請求 body 大小 |
| `http_response_size_bytes` | Histogram | 回應 body 大小 |

#### 業務指標（自定義，v1.2.0 規劃）

| 指標名稱 | 類型 | 說明 |
|---------|------|------|
| `vlm_inference_duration_seconds` | Histogram | VLM 單次推論時間 |
| `vlm_inference_total` | Counter | VLM 推論總次數 |
| `mqtt_messages_received_total` | Counter | MQTT 訊息接收總數 |
| `mqtt_alerts_created_total` | Counter | MQTT 閾值警報觸發次數 |
| `rag_query_duration_seconds` | Histogram | RAG 查詢時間 |
| `chroma_documents_total` | Gauge | ChromaDB 文件總數 |

### 3.3 Health Check 指標

**端點：** `GET /api/health`

```json
{
  "status": "ok",
  "version": "1.1.0",
  "db_ok": true,
  "llm_ok": true,
  "mqtt_ok": true,
  "chroma_ok": true,
  "timestamp": "2026-04-11T08:30:00Z"
}
```

| `status` 值 | 說明 | 建議行動 |
|------------|------|---------|
| `"ok"` | 所有服務正常 | 無 |
| `"degraded"` | 一個或多個服務異常 | 立即排查對應的 `*_ok: false` 欄位 |

### 3.4 cAdvisor 容器資源指標

**端點：** `http://AIR-030-IP:8091`（cAdvisor Web UI）

| 監控項目 | 對應風險 | 告警閾值 |
|---------|---------|---------|
| `container_memory_usage_bytes` | R001 (VRAM/RAM) | > 55GB（總 64GB 的 85%） |
| `container_cpu_usage_seconds_total` | 效能 | 持續 > 90% CPU |
| `container_fs_usage_bytes` | R005 (磁碟) | > 55GB（總 64GB eMMC 的 85%） |

```bash
# 查看所有容器 memory 使用量
curl -s "http://localhost:8091/metrics" | grep 'container_memory_usage_bytes{.*xcloud'
```

---

## 4. Traces — 關聯追蹤

### 4.1 X-Request-ID 機制

每個 HTTP 請求由 `SyslogMiddleware` 自動注入/傳播 `X-Request-ID`：

```
請求進入 → SyslogMiddleware
  ├─ 讀取請求 Header: X-Request-ID（若存在則沿用，若無則生成 UUID v4）
  ├─ 注入至 request.state.request_id（供下游 Handler 使用）
  ├─ 寫入 syslog_entries.request_id
  └─ 注入至 Response Header: X-Request-ID（回傳給客戶端）
```

### 4.2 跨服務追蹤

```bash
# 前端 → Nginx → Backend 的完整請求鏈
# 客戶端收到的 Response Header:
X-Request-ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890

# 用此 ID 查詢所有相關日誌
curl "http://localhost/api/syslog?request_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

### 4.3 在 Service 層使用 request_id

```python
# router 中傳遞 request_id 給 service
from fastapi import Request

@router.post("/capture")
async def vlm_capture(request: Request, db: AsyncSession = Depends(get_db)):
    request_id = getattr(request.state, "request_id", None)
    result = await vlm_service.analyze(db, request_id=request_id)
    return result
```

---

## 5. Health Check 架構

### 5.1 多層健康探測

```
外部監控 → GET /api/health（Nginx :80）
            │
            ├─ [1] SQLite：SELECT 1（< 100ms 預期）
            ├─ [2] llama.cpp：GET http://llama-cpp:8080/health
            ├─ [3] MQTT：TCP connect mosquitto:1883（timeout 2s）
            └─ [4] ChromaDB：chroma_is_healthy()（同步呼叫）
```

### 5.2 Docker Healthcheck 矩陣

| 服務 | 探測方式 | Interval | Timeout | 啟動緩衝 |
|------|---------|---------|---------|---------|
| mosquitto | `mosquitto_pub` publish | 15s | 5s | 10s |
| llama-cpp | `curl /health` | 20s | 10s | 120s |
| vlm-webui | `curl /` | 30s | 10s | 20s |
| backend | `curl /api/health` | 20s | 10s | 30s |
| frontend | `curl :3000` | 20s | 10s | 15s |
| nginx | `wget /api/health` | 30s | 5s | 10s |
| cadvisor | `curl :8080/healthz` | 30s | 5s | 10s |

### 5.3 快速狀態查詢

```bash
# 全服務健康狀態一覽
docker compose ps

# 後端三合一健康
curl -s http://localhost/api/health | python3 -m json.tool

# 特定服務健康歷史
docker inspect xcloud-backend | python3 -c "
import sys, json
data = json.load(sys.stdin)[0]
state = data['State']
print('Status:', state['Status'])
print('Health:', state.get('Health', {}).get('Status'))
"
```

---

## 6. 告警規則定義

### 6.1 系統級告警（連結 RISK_MATRIX.md）

| 告警 | 觸發條件 | 風險 ID | 緊急程度 | 回應動作 |
|------|---------|---------|---------|---------|
| **VRAM 使用超標** | container_memory > 55GB | R001 | 🔴 Critical | 降低 `--ctx-size`；重啟 llama-cpp |
| **磁碟空間告警** | eMMC 使用率 > 85% | R005 | 🔴 Critical | 執行 `kpi_report.py`；清理舊資料 |
| **llama.cpp 無回應** | `/api/health` → `llm_ok: false` | R004 | 🟠 High | `docker compose restart llama-cpp` |
| **MQTT Broker 離線** | `/api/health` → `mqtt_ok: false` | R003 | 🟠 High | `docker compose restart mosquitto` |
| **ChromaDB 損毀** | `/api/health` → `chroma_ok: false` | R007 | 🟠 High | 從備份還原；重建索引 |
| **SQLite 鎖競爭** | 日誌出現 `database is locked` | R002 | 🟡 Medium | 確認並發查詢數；啟用 `busy_timeout` |

### 6.2 業務級告警（MQTT 感測器）

| 告警等級 | 觸發條件 | 通知方式 |
|---------|---------|---------|
| `critical` | 超出 `max_value` / `min_value` | `/api/alerts` 建立警報 + LINE Notify（ff.line_notify 啟用時）|
| `elevated` | 超出 `warn_max` / `warn_min` | `/api/alerts` 建立警報 |
| `moderate` | 正常波動超出軟閾值 | 僅記錄，不推播 |

### 6.3 SLO 告警閾值

| SLO 指標 | 目標值 | 告警觸發條件 |
|---------|--------|-----------|
| API Uptime | ≥ 99%（月均）| 月可用率 < 99% |
| VLM 推論 p95 | ≤ 30 秒 | p95 > 30 秒持續 3 次 |
| MQTT 警報延遲 | ≤ 5 秒 | 端對端延遲 > 5 秒 |
| RAG Top-3 相關率 | ≥ 80% | QA 評估低於 80% |

---

## 7. 儀表板查詢手冊

### 7.1 KPI 報告腳本

```bash
# 完整 KPI 報告（表格格式）
python scripts/kpi_report.py --days 7 --format table

# JSON 格式（供程式解析）
python scripts/kpi_report.py --days 30 --format json --out /tmp/kpi.json

# CSV 格式（供 Excel 分析）
python scripts/kpi_report.py --days 30 --format csv --out /tmp/kpi.csv

# 指定資料庫路徑
python scripts/kpi_report.py \
  --db /data/xcloudvlm.db \
  --syslog /data/syslog.db \
  --days 7
```

### 7.2 常用監控查詢

```bash
# 今日警報統計
sqlite3 /data/xcloudvlm.db \
  "SELECT level, COUNT(*) as cnt FROM equipment_alerts
   WHERE date(created_at) = date('now') GROUP BY level;"

# 最近 1 小時 MQTT 訊息量
sqlite3 /data/xcloudvlm.db \
  "SELECT device_id, COUNT(*) as msgs FROM mqtt_sensor_readings
   WHERE timestamp > datetime('now', '-1 hour') GROUP BY device_id;"

# VLM 推論平均延遲（從 syslog）
sqlite3 /data/syslog.db \
  "SELECT AVG(duration_ms), MAX(duration_ms), COUNT(*)
   FROM syslog_entries
   WHERE action LIKE '%vlm%' AND created_at > datetime('now', '-24 hours');"

# 錯誤率（最近 24h）
sqlite3 /data/syslog.db \
  "SELECT
     COUNT(CASE WHEN status_code >= 500 THEN 1 END) * 100.0 / COUNT(*) as error_rate_pct
   FROM syslog_entries
   WHERE created_at > datetime('now', '-24 hours');"
```

### 7.3 Prometheus 查詢範例（v1.2.0 規劃）

```promql
# 請求成功率（5分鐘）
rate(http_requests_total{status=~"2.."}[5m]) /
rate(http_requests_total[5m])

# VLM 推論 p95 延遲
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{handler="/api/vlm/capture"}[10m]))

# MQTT 訊息接收速率
rate(mqtt_messages_received_total[5m])
```

---

## 8. 監控容器部署

### 8.1 cAdvisor（已整合至 docker-compose.yml）

cAdvisor 提供容器層級的 CPU / 記憶體 / 磁碟 / 網路監控，
特別對應 **R001（VRAM 耗盡）** 和 **R005（磁碟空間耗盡）** 兩大高風險項目。

- **Web UI：** `http://AIR-030-IP:8091`
- **Metrics：** `http://AIR-030-IP:8091/metrics`（Prometheus 格式）

### 8.2 資源使用估算（AIR-030 可用性評估）

| 服務 | RAM 使用 | CPU | 說明 |
|------|---------|-----|------|
| cAdvisor | ~50MB | 低 | 輕量，不影響主服務 |
| Prometheus（v2.0.0）| ~256MB | 低 | v2.0.0 多廠房後引入 |
| Grafana（v2.0.0）| ~128MB | 低 | v2.0.0 多廠房後引入 |

> AIR-030 共 64GB RAM，cAdvisor 50MB 佔 0.08%，可安全運行。

### 8.3 v2.0.0 完整監控 Stack（規劃）

```yaml
# 未來 v2.0.0 規劃（多廠房聯網監控）
services:
  prometheus:
    image: prom/prometheus:v2.52
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
    ports: ["9090:9090"]

  grafana:
    image: grafana/grafana:10.4
    ports: ["3001:3000"]
    volumes:
      - ./monitoring/grafana/dashboards:/var/lib/grafana/dashboards

  loki:
    image: grafana/loki:3.0
    ports: ["3100:3100"]
```

---

## 9. 日誌保留策略

| 日誌來源 | 保留期 | 清理機制 | 設定位置 |
|---------|--------|---------|---------|
| Docker JSON logs | 最多 50MB/服務（5×10MB）| Docker 自動輪轉 | docker-compose.yml `x-logging` |
| syslog.db | 90 天 | `syslog_cleanup_task`（每 24h 執行）| `services/syslog_service.py` |
| mqtt_sensor_readings | 180 天 | background task（v1.2.0 實作）| `main.py` lifespan（規劃中）|
| cAdvisor metrics | 記憶體中，重啟清空 | — | cAdvisor 無持久化 |
| kpi_report.py 輸出 | 手動管理 | — | `--out` 參數指定路徑 |

### 緊急磁碟空間釋放

```bash
# 查看各容器日誌大小
du -sh /var/lib/docker/containers/*/

# 強制清理（保留最新 1 個輪轉檔）
docker compose stop
truncate -s 0 /var/lib/docker/containers/<id>/<id>-json.log
docker compose up -d

# 查看 syslog.db 大小
sqlite3 /data/syslog.db "SELECT COUNT(*), MIN(created_at), MAX(created_at) FROM syslog_entries;"

# 手動清理 syslog（保留最近 30 天）
sqlite3 /data/syslog.db \
  "DELETE FROM syslog_entries WHERE created_at < datetime('now', '-30 days');"
sqlite3 /data/syslog.db "VACUUM;"
```

---

*相關文件：[KPI_METRICS.md](KPI_METRICS.md) | [RISK_MATRIX.md](RISK_MATRIX.md) | [CONTINUOUS_IMPROVEMENT.md](CONTINUOUS_IMPROVEMENT.md)*
*架構文件：[architecture/HIGH_LEVEL_ARCH.md](architecture/HIGH_LEVEL_ARCH.md)*
