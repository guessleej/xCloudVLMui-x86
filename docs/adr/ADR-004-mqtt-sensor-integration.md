# ADR-004：選用 MQTT（Mosquitto）而非 WebSocket / HTTP Polling 作為感測器資料協議

| 欄位       | 內容                                                              |
|-----------|-------------------------------------------------------------------|
| **狀態**  | ✅ 已採納（Accepted）                                              |
| **日期**  | 2026-01-10                                                        |
| **決策者** | 架構師、嵌入式工程師、後端工程師                                   |
| **關聯**  | ADR-001（SQLite）、docker-compose.yml `mosquitto`、services/mqtt_service.py |

---

## 背景與問題

工廠設備（壓縮機、冷卻塔、馬達驅動器等）透過感測器持續產生：
- 溫度、壓力、振動、轉速、電流等時序資料
- 閾值警報觸發事件

需要選擇一種感測器資料傳輸協議，滿足：
- **低延遲**：異常事件需在數秒內傳達後端
- **低頻寬**：工廠內網可能有頻寬限制
- **高可靠性**：感測器訊息不能遺失（尤其是警報）
- **邊緣部署**：Broker 在 AIR-030 本機執行，不依賴雲端

---

## 評估的方案

### 方案 A：MQTT（Eclipse Mosquitto + aiomqtt）

**優點：**
- **工業 IoT 標準協議**：廣泛使用於 PLC、感測器網關、工業控制系統
- **極低頻寬開銷**：MQTT header 最小 2 bytes，適合大量感測器高頻傳輸
- **QoS 等級**：
  - QoS 0（At most once）：溫度等容錯性高的數據
  - QoS 1（At least once）：警報事件（確保送達）
  - QoS 2（Exactly once）：關鍵指令
- **Topic 結構**：`xcloud/{device_id}/{sensor_type}` 語意清晰，支援萬用字元訂閱
- **Eclipse Mosquitto**：輕量（< 10MB），ARM64 官方支援，WebSocket bridge（port 9001）

**缺點：**
- 需維護 Broker（額外 Docker service）
- Broker 為單點故障（邊緣場景可接受）
- 不原生支援請求-回應模式

### 方案 B：HTTP Polling（後端定期主動拉取）

**優點：**
- 無需額外 Broker
- 感測器端只需 HTTP server

**缺點：**
- **延遲高**：polling interval 決定最小延遲（1 秒 polling = 最多 1 秒延遲）
- **頻寬浪費**：無新資料時仍發送請求
- **感測器端需實作 HTTP server**：成本高於 MQTT publisher

### 方案 C：WebSocket（長連線推送）

**優點：**
- 全雙工低延遲
- 瀏覽器原生支援

**缺點：**
- **工業感測器通常不支援 WebSocket**（MCU/PLC firmware 限制）
- 連線中斷後重連邏輯需自行實作
- 不具 QoS 保障機制

### 方案 D：AMQP（RabbitMQ）

**優點：**
- 企業級訊息佇列，豐富的路由規則
- 高可靠性訊息投遞

**缺點：**
- RabbitMQ 資源需求顯著高於 Mosquitto（JVM based）
- 工業設備端 AMQP client library 稀少
- 本場景複雜度過高

---

## 決策

**選用 MQTT + Eclipse Mosquitto（方案 A）。**

理由：

1. **工業 IoT 事實標準**：工廠設備、PLC 網關、感測器模組普遍支援 MQTT client，
   可直接接入無需額外 adapter。

2. **資源效率最佳**：Mosquitto < 10MB 記憶體，對比 RabbitMQ（200MB+）差距顯著。
   AIR-030 資源預算用於 llama.cpp 推論。

3. **可靠性保障**：
   - 警報事件使用 QoS 1，確保至少送達一次
   - Mosquitto 持久化訊息至 `mosquitto-data` volume（`persistence true`）
   - 後端 `aiomqtt` listener 實作指數退避重連（5s→60s）

4. **WebSocket Bridge**：port 9001 提供 MQTT over WebSocket，
   前端儀表板可直接訂閱感測器即時資料，無需後端中繼。

5. **Topic 語意化**：`xcloud/AIR-030-01/temperature` 結構清晰，
   支援萬用字元 `xcloud/#` 一次訂閱所有設備。

---

## 系統設計

```
感測器 / PLC
  → MQTT Publish (QoS 0/1)
  → Mosquitto Broker (port 1883)
  → aiomqtt listener (backend)
  → _parse_payload() → _save_reading() → SQLite
  → _check_threshold() → EquipmentAlert
```

**Topic 格式**：`xcloud/{device_id}/{sensor_type}`
- device_id：例 `AIR-030-01`（對應 MqttDevice.device_id）
- sensor_type：`temperature` | `pressure` | `vibration` | `rpm` | `current`

---

## 後果與限制

- ✅ 感測器資料寫入延遲 < 500ms（QoS 0 UDP-like）
- ✅ 警報事件不遺失（QoS 1 + Mosquitto persistence）
- ✅ 前端可透過 WebSocket 直連 Mosquitto（port 9001）訂閱即時資料
- ⚠️ Mosquitto 為單點故障；工廠斷電後重啟恢復需 ≤ 30 秒
  （已設定 `restart: unless-stopped` + healthcheck）
- ⚠️ 感測器時序資料 180 天後應清理（防 SQLite 膨脹）
- 📋 `MQTT_ENABLED=false` 環境變數可停用 MQTT（測試 / CI 用）

---

## 後續行動

- [ ] v1.2.0：實作 `mqtt_sensor_readings` 180 天 TTL 自動清理
- [ ] v1.2.0：新增 MQTT over TLS（port 8883）支援，保護感測器資料傳輸
- [ ] v2.0.0：若設備 > 200 台，評估 EMQX Cluster 取代 Mosquitto 單節點
