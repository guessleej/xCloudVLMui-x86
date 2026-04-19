// types/index.ts — 全域型別定義（對齊後端 schemas.py）

// ── NextAuth 擴展 ─────────────────────────────────────────────────────
import "next-auth";
declare module "next-auth" {
  interface Session {
    accessToken?: string;
    user: {
      name?:       string | null;
      email?:      string | null;
      image?:      string | null;
      provider?:   string;
      providerId?: string;
    };
  }
}

// ── 設備狀態 ──────────────────────────────────────────────────────────
export type EquipmentStatus = "normal" | "warning" | "critical" | "offline";
export type RiskLevel       = "low" | "moderate" | "elevated" | "critical";

export interface Equipment {
  id:               string;
  name:             string;
  type:             string;
  location:         string;
  status:           EquipmentStatus;
  vhs_score:        number;
  active_alerts:    number;
  last_inspection?: string;  // ISO8601
}

export interface EquipmentSummary {
  total:    number;
  normal:   number;
  warning:  number;
  critical: number;
  offline:  number;
}

// ── VHS 趨勢 ──────────────────────────────────────────────────────────
export type VhsSource = "vlm" | "manual" | "seed" | "estimated";

export interface VhsDataPoint {
  timestamp:     string;       // 顯示用標籤（如 "04/06"）
  score:         number;       // 0–100
  equipment_id:  string;
  source:        VhsSource;    // 資料來源
  reading_count: number;       // 當日記錄筆數（0 = 估算）
}

export interface VhsTrendMeta {
  equipment_id:   string;
  days:           number;
  real_days:      number;      // 有 DB 真實記錄的天數
  estimated_days: number;      // 補算天數
  data:           VhsDataPoint[];
}

// ── 警報 ──────────────────────────────────────────────────────────────
export interface Alert {
  id:             string;
  equipment_id:   string;
  equipment_name: string;
  level:          RiskLevel;
  message:        string;
  created_at:     string;  // ISO8601
  resolved:       boolean;
}

// ── 報告 ──────────────────────────────────────────────────────────────
export interface Report {
  id:               string;
  title:            string;
  equipment_id?:    string;
  equipment_name?:  string;
  risk_level:       RiskLevel;
  source:           string;   // vlm-diagnosis | pdm-inspection | manual
  markdown_content?: string;
  created_at:       string;
  updated_at?:      string;
}

export interface VlmSessionCapture {
  session_id:        string;
  source:            string;
  captured_at:       string;
  title?:            string;
  risk_level?:       string;
  markdown_content?: string;
  raw_vlm_json?:     Record<string, unknown>;
}

// ── RAG ──────────────────────────────────────────────────────────────
export interface RagSource {
  filename: string;
  page?:    number;
  score?:   number;
}

export interface RagMessage {
  id:          string;
  role:        "user" | "assistant";
  content:     string;
  sources?:    RagSource[];
  created_at:  string;
}

export interface RagDocument {
  id:          string;
  filename:    string;
  file_type:   string;
  file_size?:  number;
  description?: string;
  chunk_count: number;
  embedded:    boolean;
  created_at:  string;
}

// ── 系統設定 ─────────────────────────────────────────────────────────
export interface SystemSettings {
  ocr_engine:        string;   // "vlm" | "disabled"
  embed_model_url:   string;
  embed_model_name:  string;
  llm_model_url:     string;
  llm_model_name:    string;
  chunk_size:        number;
  chunk_overlap:     number;
  rag_top_k:         number;
}

export interface SystemSettingsUpdate {
  ocr_engine?:        string;
  embed_model_url?:   string;
  embed_model_name?:  string;
  llm_model_url?:     string;
  llm_model_name?:    string;
  chunk_size?:        number;
  chunk_overlap?:     number;
  rag_top_k?:         number;
}

// ── MQTT ─────────────────────────────────────────────────────────────
export interface MqttDevice {
  id:           string;
  device_id:    string;
  name:         string;
  device_type:  string;
  location?:    string;
  topic_prefix: string;
  description?: string;
  online:       boolean;
  last_seen?:   string;
  created_at:   string;
}

export interface MqttSensorReading {
  id:          string;
  device_id:   string;
  topic:       string;
  sensor_type: string;
  value?:      number;
  unit?:       string;
  quality:     string;
  timestamp:   string;
}

export interface MqttLatestReading {
  device_id:   string;
  device_name: string;
  topic:       string;
  sensor_type: string;
  value?:      number;
  unit?:       string;
  quality:     string;
  timestamp:   string;
}

export interface MqttBrokerStatus {
  connected:       boolean;
  broker_host:     string;
  broker_port:     number;
  client_id:       string;
  subscriptions:   string[];
  message_count:   number;
  uptime_seconds:  number;
}

export interface MqttDeviceCreate {
  device_id:    string;
  name:         string;
  device_type:  string;
  location?:    string;
  topic_prefix: string;
  description?: string;
}

export interface MqttThreshold {
  id:          string;
  device_id:   string;
  sensor_type: string;
  min_value?:  number;
  max_value?:  number;
  warn_min?:   number;
  warn_max?:   number;
  unit?:       string;
  enabled:     boolean;
  created_at:  string;
  updated_at:  string;
}

export interface MqttDeviceDetail {
  id:            string;
  device_id:     string;
  name:          string;
  device_type:   string;
  location?:     string;
  topic_prefix:  string;
  description?:  string;
  online:        boolean;
  last_seen?:    string;
  created_at:    string;
  reading_count: number;
  sensor_types:  string[];
  thresholds:    MqttThreshold[];
}

export interface MqttChartPoint {
  timestamp: string;
  value?:    number;
  quality:   string;
}

// ── Pipeline Status ───────────────────────────────────────────────────
export type PipelineStageStatus = "online" | "offline" | "warning" | "unknown";
export type PipelineOverall     = "online" | "degraded" | "offline";

export interface PipelineStage {
  stage:        number;
  key:          string;
  label:        string;
  subtitle:     string;
  status:       PipelineStageStatus;
  status_label: string;
  metrics:      Record<string, string>;
  checked_at:   string;
}

export interface PipelineStatus {
  stages:     PipelineStage[];
  overall:    PipelineOverall;
  checked_at: string;
}

// ── Trained Model ────────────────────────────────────────────────────
export type YoloTaskType = "detect" | "pose" | "segment" | "classify" | "obb";
export type ModelFormat  = "e2e" | "traditional";

export interface TrainedModel {
  id:               string;
  name:             string;
  description?:     string;
  task_type:        YoloTaskType;
  model_filename:   string;
  model_size_mb?:   number;
  model_format:     ModelFormat;
  output_shape?:    string;
  input_size:       number;
  num_classes:      number;
  class_names?:     string[];
  dataset_name?:    string;
  is_active:        boolean;
  is_builtin:       boolean;
  source:           string;
  base_model?:      string;
  metrics?:         Record<string, number>;
  notes?:           string;
  created_at:       string;
  updated_at:       string;
}

export interface TrainedModelListResponse {
  total: number;
  items: TrainedModel[];
}

export interface ActiveModelsResponse {
  models: Record<YoloTaskType, TrainedModel>;
}

// ── Chat History ─────────────────────────────────────────────────────
export interface ChatHistoryItem {
  id:          string;
  session_id?: string;
  question:    string;
  answer:      string;
  sources?:    RagSource[];
  latency_ms?: number;
  notes?:      string;
  created_at:  string;
  updated_at:  string;
}

export interface ChatHistoryListResponse {
  total: number;
  items: ChatHistoryItem[];
}

// ── 事件中心 / Syslog ─────────────────────────────────────────────────
export interface SysLog {
  id:          number;
  timestamp:   string;
  level:       "INFO" | "WARNING" | "ERROR" | "CRITICAL" | "DEBUG";
  module:      string;
  action:      string;
  message:     string;
  detail?:     string | null;
  ip_address?: string | null;
  status_code?: number | null;
  duration_ms?: number | null;
  user_id?:    string | null;
}

export interface SysLogStats {
  total:               number;
  by_level:            Record<string, number>;
  by_module:           Record<string, number>;
  recent_errors_24h:   number;
  recent_warnings_24h: number;
}
