/**
 * lib/api.ts
 * 前端 API 客戶端 — 呼叫 FastAPI backend (:8000)
 * 後端路由前綴：/api/（見 routers/*.py）
 */
import axios from "axios";
import { getSession } from "next-auth/react";
import type { VlmSessionCapture } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 90_000,
  headers: { "Content-Type": "application/json" },
});

// 自動帶入 NextAuth session token
apiClient.interceptors.request.use(async (config) => {
  const session = await getSession();
  if (session?.accessToken) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return config;
});

// ── Dashboard ──────────────────────────────────────────────────────
export const dashboardApi = {
  /** 設備狀態統計 */
  getSummary: () =>
    apiClient.get("/api/dashboard/summary"),
  /** 所有設備列表 */
  getEquipment: () =>
    apiClient.get("/api/dashboard/equipment"),
  /** 警報 Feed（預設只回傳未解決；include_resolved=true 含已解決） */
  getAlerts: (includeResolved = false, equipmentId?: string) =>
    apiClient.get("/api/dashboard/alerts", {
      params: {
        include_resolved: includeResolved,
        ...(equipmentId ? { equipment_id: equipmentId } : {}),
      },
    }),
  /** 新增警報 */
  createAlert: (payload: {
    equipment_id: string;
    equipment_name: string;
    level: string;
    message: string;
  }) => apiClient.post("/api/dashboard/alerts", payload),
  /** 標記警報已解決 */
  resolveAlert: (alertId: string) =>
    apiClient.patch(`/api/dashboard/alerts/${alertId}/resolve`),
  /** 刪除警報 */
  deleteAlert: (alertId: string) =>
    apiClient.delete(`/api/dashboard/alerts/${alertId}`),
  /** 指定設備 VHS 趨勢（含 meta：real_days / estimated_days）*/
  getVhsTrend: (equipmentId: string, days = 14) =>
    apiClient.get(`/api/dashboard/vhs-trend/${equipmentId}?days=${days}`),
  /** 記錄 VHS 分數（手動 或 VLM 推論後呼叫）*/
  recordVhsReading: (payload: {
    equipment_id: string;
    score: number;
    source?: string;
    notes?: string;
  }) => apiClient.post("/api/dashboard/vhs-readings", payload),
  /** 四段式巡檢管線即時狀態 */
  getPipelineStatus: () =>
    apiClient.get("/api/dashboard/pipeline-status"),
};

// ── Reports ────────────────────────────────────────────────────────
export const reportsApi = {
  /** 報告列表 */
  list: (limit = 50, offset = 0) =>
    apiClient.get(`/api/reports/?limit=${limit}&offset=${offset}`),
  /** 單筆報告 */
  getById: (id: string) =>
    apiClient.get(`/api/reports/${id}`),
  /** 建立報告 */
  create: (payload: Record<string, unknown>) =>
    apiClient.post("/api/reports/", payload),
  /** 刪除報告 */
  delete: (id: string) =>
    apiClient.delete(`/api/reports/${id}`),
  /** 下載 MD */
  download: (id: string) =>
    apiClient.get(`/api/reports/${id}/download`, { responseType: "blob" }),
  /** VLM 巡檢結束後觸發存報告 */
  captureVlmSession: (payload: VlmSessionCapture) =>
    apiClient.post("/api/reports/capture-vlm-session", payload),
};

// ── RAG ────────────────────────────────────────────────────────────
export const ragApi = {
  /** 語意問答（走 /api/chat/query 自動存歷史）*/
  query: (payload: { question: string; session_id?: string; top_k?: number }) =>
    apiClient.post("/api/chat/query", payload),
  /** 文件列表 */
  listDocuments: () =>
    apiClient.get("/api/rag/documents"),
  /** 上傳文件（multipart） */
  uploadDocument: (form: FormData) =>
    apiClient.post("/api/rag/documents/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    }),
  /** 刪除文件 */
  deleteDocument: (docId: string) =>
    apiClient.delete(`/api/rag/documents/${docId}`),
  /** 上傳圖片（OCR → 嵌入） */
  uploadImage: (form: FormData) =>
    apiClient.post("/api/rag/documents/upload-image", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 180_000,  // OCR 需要較長時間
    }),
};

// ── Chat History ───────────────────────────────────────────────────
export const chatHistoryApi = {
  /** 查詢歷史列表 */
  list: (params?: { session_id?: string; q?: string; limit?: number; offset?: number }) =>
    apiClient.get("/api/chat/history", { params }),
  /** 修改備註 */
  updateNotes: (id: string, notes: string) =>
    apiClient.patch(`/api/chat/history/${id}`, { notes }),
  /** 刪除單筆 */
  delete: (id: string) =>
    apiClient.delete(`/api/chat/history/${id}`),
  /** 清空全部（或指定 session） */
  clearAll: (sessionId?: string) =>
    apiClient.delete("/api/chat/history", { params: sessionId ? { session_id: sessionId } : {} }),
};

// ── Model Registry ─────────────────────────────────────────────────
export const modelsApi = {
  /** 列出所有模型 */
  list: (params?: { task_type?: string; is_active?: boolean }) =>
    apiClient.get("/api/models", { params }),
  /** 取得各任務當前啟用模型 */
  getActive: () =>
    apiClient.get("/api/models/active"),
  /** 取得單一模型 */
  get: (id: string) =>
    apiClient.get(`/api/models/${id}`),
  /** 新增模型 */
  create: (payload: Record<string, unknown>) =>
    apiClient.post("/api/models", payload),
  /** 修改模型 */
  update: (id: string, payload: Record<string, unknown>) =>
    apiClient.patch(`/api/models/${id}`, payload),
  /** 刪除模型 */
  delete: (id: string) =>
    apiClient.delete(`/api/models/${id}`),
  /** 啟用模型（同時停用同類型其他模型）*/
  activate: (id: string) =>
    apiClient.post(`/api/models/${id}/activate`),
};

// ── VLM ────────────────────────────────────────────────────────────
export const vlmApi = {
  /** 檢查 llama.cpp 推論引擎狀態 */
  status: () =>
    apiClient.get("/api/vlm/status"),
  /**
   * 單次圖文診斷（HTTP POST，非串流）
   * WebSocket 串流版本由 components/vlm/camera-stream.tsx 直接管理
   */
  diagnose: (payload: {
    prompt:        string;
    image_base64?: string;
    max_tokens?:   number;
    temperature?:  number;
  }) => apiClient.post("/api/vlm/diagnose", payload),
};

/**
 * 取得 VLM WebSocket 串流端點 URL
 * 優先使用 NEXT_PUBLIC_WS_URL，否則從 window.location 推導（同源 Nginx 代理）
 * 開發環境直連後端：設定 NEXT_PUBLIC_WS_URL=ws://localhost:8000
 */
export function getVlmWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:8000/api/vlm/ws";
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  if (explicit) return explicit.replace(/\/$/, "") + "/api/vlm/ws";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/vlm/ws`;
}

// ── Auth ────────────────────────────────────────────────────────────
export const authApi = {
  /** NextAuth signIn callback 後同步使用者至後端 SQLite */
  syncUser: (userData: Record<string, unknown>) =>
    apiClient.post("/api/auth/sync-user", userData),
};

// ── Health ──────────────────────────────────────────────────────────
export const healthApi = {
  check: () => apiClient.get("/api/health"),
};

// ── Settings ──────────────────────────────────────────────────────────
export const settingsApi = {
  /** 取得系統設定 */
  get: () =>
    apiClient.get("/api/settings"),
  /** 更新系統設定 */
  update: (payload: Record<string, unknown>) =>
    apiClient.put("/api/settings", payload),
  /** 重置為預設值 */
  reset: () =>
    apiClient.post("/api/settings/reset"),
};

// ── MQTT ────────────────────────────────────────────────────────────
export const mqttApi = {
  /** Broker 連線狀態 */
  status: () =>
    apiClient.get("/api/mqtt/status"),
  /** 所有已登錄設備 */
  listDevices: () =>
    apiClient.get("/api/mqtt/devices"),
  /** 新增設備 */
  createDevice: (payload: Record<string, unknown>) =>
    apiClient.post("/api/mqtt/devices", payload),
  /** 更新設備 */
  updateDevice: (deviceId: string, payload: Record<string, unknown>) =>
    apiClient.put(`/api/mqtt/devices/${deviceId}`, payload),
  /** 刪除設備 */
  deleteDevice: (deviceId: string) =>
    apiClient.delete(`/api/mqtt/devices/${deviceId}`),
  /** 指定設備讀值 */
  getReadings: (deviceId: string, sensorType?: string, limit = 100) =>
    apiClient.get(`/api/mqtt/devices/${deviceId}/readings`, {
      params: { sensor_type: sensorType, limit },
    }),
  /** 所有設備最新讀值 */
  getLatestReadings: () =>
    apiClient.get("/api/mqtt/readings/latest"),
  /** 發佈測試訊息 */
  publish: (topic: string, payload: string, qos = 0) =>
    apiClient.post("/api/mqtt/publish", { topic, payload, qos }),
};

// Additional MQTT device management APIs
export const mqttDeviceApi = {
  /** 設備詳情（含統計與閾值） */
  getDetail: (deviceId: string) =>
    apiClient.get(`/api/mqtt/devices/${deviceId}/detail`),
  /** 圖表歷史資料 */
  getChart: (deviceId: string, sensorType: string, limit = 60) =>
    apiClient.get(`/api/mqtt/devices/${deviceId}/readings/chart`, {
      params: { sensor_type: sensorType, limit },
    }),
  /** 列出閾值 */
  listThresholds: (deviceId: string) =>
    apiClient.get(`/api/mqtt/devices/${deviceId}/thresholds`),
  /** 新增閾值 */
  createThreshold: (deviceId: string, payload: Record<string, unknown>) =>
    apiClient.post(`/api/mqtt/devices/${deviceId}/thresholds`, payload),
  /** 刪除閾值 */
  deleteThreshold: (deviceId: string, thresholdId: string) =>
    apiClient.delete(`/api/mqtt/devices/${deviceId}/thresholds/${thresholdId}`),
};

// ── 事件中心 API ──────────────────────────────────────────────────────
export const syslogApi = {
  /** 查詢日誌列表（支援 level / module / search / since_h 過濾） */
  list: (params?: {
    level?:   string;
    module?:  string;
    search?:  string;
    since_h?: number;
    limit?:   number;
    offset?:  number;
  }) => apiClient.get("/api/syslog/", { params }),

  /** 統計摘要 */
  stats: () => apiClient.get("/api/syslog/stats"),

  /** 最近 N 筆事件 */
  recent: (limit = 50) => apiClient.get("/api/syslog/recent", { params: { limit } }),

  /** 清除過期日誌 */
  clear: (beforeDays = 30) =>
    apiClient.delete("/api/syslog/", { params: { before_days: beforeDays } }),
};
