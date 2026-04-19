"""
schemas.py — Pydantic v2 請求/回應 Schema
"""
from __future__ import annotations
from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, Field
import uuid


# ── 通用 ──────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status:       str            # "ok" | "degraded"
    version:      str = "1.1.0"
    llm_ok:       bool = False
    chroma_ok:    bool = False
    db_ok:        bool = False
    mqtt_ok:      bool = False
    timestamp:    datetime


# ── Equipment ─────────────────────────────────────────────────────────

class EquipmentOut(BaseModel):
    id:               str
    name:             str
    type:             str
    location:         str
    status:           str          # normal | warning | critical | offline
    vhs_score:        float = 0.0
    active_alerts:    int   = 0
    last_inspection:  Optional[str] = None


class EquipmentSummary(BaseModel):
    total:    int
    normal:   int
    warning:  int
    critical: int
    offline:  int


class VhsDataPoint(BaseModel):
    timestamp:    str           # 顯示用標籤 "MM/DD"
    score:        float         # 0–100（當日平均或唯一值）
    equipment_id: str
    source:       str = "estimated"   # vlm | manual | seed | estimated（DB 無資料時補算）
    reading_count: int = 0            # 當日有幾筆真實記錄（0 = 估算）


class VhsReadingCreate(BaseModel):
    equipment_id: str
    score:        float = Field(..., ge=0.0, le=100.0)
    source:       str   = "manual"   # vlm | manual
    notes:        Optional[str] = None
    recorded_at:  Optional[datetime] = None   # 未填則用 server time


class VhsReadingOut(BaseModel):
    id:           str
    equipment_id: str
    score:        float
    source:       str
    notes:        Optional[str] = None
    recorded_at:  datetime
    created_at:   datetime

    model_config = {"from_attributes": True}


class VhsTrendMeta(BaseModel):
    equipment_id:   str
    days:           int
    real_days:      int    # 有真實 DB 記錄的天數
    estimated_days: int    # 補算天數
    data:           list[VhsDataPoint]


# ── Pipeline Status ───────────────────────────────────────────────────

class PipelineStageOut(BaseModel):
    stage:        int           # 1–4
    key:          str           # vision | inference | rag | output
    label:        str
    subtitle:     str
    status:       str           # online | offline | warning | unknown
    status_label: str           # 線上 | 離線 | 警告 | 未知
    metrics:      dict[str, str]  # 顯示用 KV（全為 str，前端直接渲染）
    checked_at:   datetime

class PipelineStatusOut(BaseModel):
    stages:       list[PipelineStageOut]
    overall:      str           # online | degraded | offline
    checked_at:   datetime


class AlertOut(BaseModel):
    id:             str
    equipment_id:   str
    equipment_name: str
    level:          str   # critical | elevated | moderate | low
    message:        str
    created_at:     datetime
    resolved:       bool = False
    resolved_at:    Optional[datetime] = None

    model_config = {"from_attributes": True}


class AlertCreate(BaseModel):
    equipment_id:   str
    equipment_name: str
    level:          str = "moderate"
    message:        str


# ── Reports ───────────────────────────────────────────────────────────

class ReportCreate(BaseModel):
    title:            str
    equipment_id:     Optional[str] = None
    equipment_name:   Optional[str] = None
    risk_level:       str           = "moderate"
    source:           str           = "manual"
    raw_vlm_json:     Optional[dict[str, Any]] = None
    markdown_content: Optional[str] = None


class ReportOut(BaseModel):
    id:               str
    title:            str
    equipment_id:     Optional[str] = None
    equipment_name:   Optional[str] = None
    risk_level:       str
    source:           str
    markdown_content: Optional[str] = None
    is_deleted:       bool          = False
    created_at:       datetime
    updated_at:       datetime

    class Config:
        from_attributes = True


class VlmSessionCapture(BaseModel):
    """VLM WebUI 巡檢結束後，前端呼叫此 API 觸發報告產生"""
    session_id:       str
    source:           str = "vlm-webui"
    captured_at:      str
    title:            Optional[str]           = None   # 自訂報告標題
    risk_level:       Optional[str]           = None   # 前端推算的風險等級
    markdown_content: Optional[str]           = None   # 若提供則直接存入，不再轉換
    raw_vlm_json:     Optional[dict[str, Any]] = None


# ── RAG ───────────────────────────────────────────────────────────────

class RagSource(BaseModel):
    filename: str
    page:     Optional[int]   = None
    score:    Optional[float] = None


class RagQueryRequest(BaseModel):
    question:   str
    session_id: Optional[str] = None
    top_k:      int = 5


class RagQueryResponse(BaseModel):
    answer:     str
    sources:    list[RagSource] = []
    latency_ms: int = 0


class RagDocumentOut(BaseModel):
    id:          str
    filename:    str
    file_type:   str
    file_size:   Optional[int] = None
    description: Optional[str] = None
    chunk_count: int
    embedded:    bool
    created_at:  datetime

    class Config:
        from_attributes = True


# ── Auth ──────────────────────────────────────────────────────────────

class UserUpsert(BaseModel):
    """NextAuth callback 呼叫，同步使用者資料"""
    id:          str
    name:        Optional[str] = None
    email:       Optional[str] = None
    image:       Optional[str] = None
    provider:    Optional[str] = None
    provider_id: Optional[str] = None


class UserOut(BaseModel):
    id:          str
    name:        Optional[str] = None
    email:       Optional[str] = None
    image:       Optional[str] = None
    provider:    Optional[str] = None
    created_at:  datetime

    class Config:
        from_attributes = True


# ── Settings ──────────────────────────────────────────────────────────

class SettingItem(BaseModel):
    key:         str
    value:       Optional[str] = None
    description: Optional[str] = None


class SettingsOut(BaseModel):
    ocr_engine:        str   = "vlm"          # vlm | disabled
    embed_model_url:   str   = ""
    embed_model_name:  str   = "gemma-4-e4b-it"
    llm_model_url:     str   = ""
    llm_model_name:    str   = "gemma-4-e4b-it"
    chunk_size:        int   = 800
    chunk_overlap:     int   = 100
    rag_top_k:         int   = 5


class SettingsUpdate(BaseModel):
    ocr_engine:        Optional[str] = None
    embed_model_url:   Optional[str] = None
    embed_model_name:  Optional[str] = None
    llm_model_url:     Optional[str] = None
    llm_model_name:    Optional[str] = None
    chunk_size:        Optional[int] = None
    chunk_overlap:     Optional[int] = None
    rag_top_k:         Optional[int] = None


# ── Feature Flags ─────────────────────────────────────────────────────

class FeatureFlagOut(BaseModel):
    id:          str
    key:         str
    enabled:     bool
    rollout_pct: int                          = 100
    description: Optional[str]               = None
    # ORM 屬性名為 extra_config（metadata 是 SQLAlchemy 保留名），
    # 透過 validation_alias 從 ORM 讀取，序列化仍輸出為 metadata
    metadata:    Optional[dict[str, Any]]    = Field(None, validation_alias="extra_config")
    updated_at:  datetime
    created_at:  datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class FeatureFlagUpdate(BaseModel):
    enabled:     Optional[bool]              = None
    rollout_pct: Optional[int]               = Field(None, ge=0, le=100)
    description: Optional[str]              = None
    metadata:    Optional[dict[str, Any]]   = None


class FeatureFlagBulkResponse(BaseModel):
    """GET /api/settings/feature-flags 回應：所有旗標的 key→enabled 快照"""
    flags:       list[FeatureFlagOut]
    # 便利欄位：key → bool，供前端快速查詢
    enabled_map: dict[str, bool]


class ImageUploadOut(BaseModel):
    id:          str
    filename:    str
    file_type:   str
    file_size:   Optional[int] = None
    ocr_text:    Optional[str] = None
    chunk_count: int
    embedded:    bool
    created_at:  datetime

    class Config:
        from_attributes = True


# ── MQTT ──────────────────────────────────────────────────────────────

class MqttDeviceCreate(BaseModel):
    device_id:    str
    name:         str
    device_type:  str = "sensor"
    location:     Optional[str] = None
    topic_prefix: str
    description:  Optional[str] = None


class MqttDeviceUpdate(BaseModel):
    name:         Optional[str] = None
    device_type:  Optional[str] = None
    location:     Optional[str] = None
    topic_prefix: Optional[str] = None
    description:  Optional[str] = None


class MqttDeviceOut(BaseModel):
    id:           str
    device_id:    str
    name:         str
    device_type:  str
    location:     Optional[str] = None
    topic_prefix: str
    description:  Optional[str] = None
    online:       bool
    last_seen:    Optional[datetime] = None
    created_at:   datetime

    class Config:
        from_attributes = True


class MqttSensorReadingOut(BaseModel):
    id:          str
    device_id:   str
    topic:       str
    sensor_type: str
    value:       Optional[float] = None
    unit:        Optional[str] = None
    quality:     str
    timestamp:   datetime

    class Config:
        from_attributes = True


class MqttLatestReading(BaseModel):
    device_id:   str
    device_name: str
    topic:       str
    sensor_type: str
    value:       Optional[float] = None
    unit:        Optional[str] = None
    quality:     str
    timestamp:   str


class MqttBrokerStatus(BaseModel):
    connected:    bool
    broker_host:  str
    broker_port:  int
    client_id:    str
    subscriptions: list[str]
    message_count: int
    uptime_seconds: float


class MqttPublishRequest(BaseModel):
    topic:   str
    payload: str
    qos:     int = 0
    retain:  bool = False


class MqttThresholdCreate(BaseModel):
    sensor_type: str
    min_value:   Optional[float] = None
    max_value:   Optional[float] = None
    warn_min:    Optional[float] = None
    warn_max:    Optional[float] = None
    unit:        Optional[str]   = None
    enabled:     bool = True

class MqttThresholdOut(BaseModel):
    id:          str
    device_id:   str
    sensor_type: str
    min_value:   Optional[float] = None
    max_value:   Optional[float] = None
    warn_min:    Optional[float] = None
    warn_max:    Optional[float] = None
    unit:        Optional[str]   = None
    enabled:     bool
    created_at:  datetime
    updated_at:  datetime
    class Config:
        from_attributes = True

class MqttDeviceDetail(BaseModel):
    id:           str
    device_id:    str
    name:         str
    device_type:  str
    location:     Optional[str] = None
    topic_prefix: str
    description:  Optional[str] = None
    online:       bool
    last_seen:    Optional[datetime] = None
    created_at:   datetime
    reading_count: int = 0
    sensor_types:  list[str] = []
    thresholds:    list[MqttThresholdOut] = []

class MqttChartPoint(BaseModel):
    timestamp: datetime
    value:     Optional[float] = None
    quality:   str = "good"


# ── Vision Session ────────────────────────────────────────────────────

class VisionDetectionItem(BaseModel):
    """單一 YOLO 偵測項目"""
    class_id:   int
    label:      str             # 中文名稱
    label_en:   str             # 英文名稱
    confidence: float
    x: float; y: float         # 左上角，正規化 0–1
    w: float; h: float         # 寬高，正規化 0–1
    risk:       str             # critical|warning|safe|info
    category:   str             # personnel|vehicle|hazard|equipment|product|other
    track_id:   Optional[int] = None   # Events 模式 SORT track ID

class VisionPoseKeypoint(BaseModel):
    """單一姿態關鍵點"""
    name:       str    # nose/left_eye/right_eye/left_ear/right_ear/…
    x:          float  # 正規化 0–1
    y:          float  # 正規化 0–1
    visibility: float  # 0–1

class VisionPosePerson(BaseModel):
    """單人姿態資料"""
    person_idx:  int
    confidence:  float
    keypoints:   list[VisionPoseKeypoint]  # 17 個關鍵點

class VisionSessionCreate(BaseModel):
    mode:           str                             # equipment|people|events|objects
    equipment_id:   Optional[str]         = None
    vlm_prompt:     Optional[str]         = None
    vlm_result:     Optional[str]         = None
    risk_level:     Optional[str]         = None
    vhs_score:      Optional[int]         = None
    five_s_score:   Optional[int]         = None
    yolo_model:     str                   = "yolo26n"
    yolo_task:      str                   = "detect"
    detections:     Optional[list[dict]]  = None
    person_count:   int                   = 0
    vehicle_count:  int                   = 0
    hazard_count:   int                   = 0
    pose_keypoints: Optional[list[dict]]  = None
    track_history:  Optional[list[dict]]  = None
    segment_counts: Optional[dict]        = None
    thumbnail:      Optional[str]         = None
    duration_ms:    Optional[int]         = None

class VisionSessionOut(BaseModel):
    id:             str
    mode:           str
    equipment_id:   Optional[str]   = None
    vlm_result:     Optional[str]   = None
    risk_level:     Optional[str]   = None
    vhs_score:      Optional[int]   = None
    five_s_score:   Optional[int]   = None
    yolo_model:     str
    yolo_task:      str
    detections:     Optional[list]  = None
    person_count:   int
    vehicle_count:  int
    hazard_count:   int
    pose_keypoints: Optional[list]  = None
    track_history:  Optional[list]  = None
    segment_counts: Optional[dict]  = None
    thumbnail:      Optional[str]   = None
    duration_ms:    Optional[int]   = None
    created_at:     datetime
    model_config = {"from_attributes": True}

class VisionStats(BaseModel):
    total_sessions:    int
    by_mode:           dict[str, int]
    by_risk:           dict[str, int]
    avg_vhs_score:     Optional[float]  = None
    recent_hazards_24h: int
    total_person_detections: int


# ── Chat History ───────────────────────────────────────────────────────

class ChatHistorySource(BaseModel):
    filename:    Optional[str]  = None
    chunk_index: Optional[int]  = None
    score:       Optional[float] = None
    preview:     Optional[str]  = None

class ChatHistoryOut(BaseModel):
    id:          str
    session_id:  Optional[str]  = None
    question:    str
    answer:      str
    sources:     Optional[list] = None
    latency_ms:  Optional[int]  = None
    notes:       Optional[str]  = None
    created_at:  datetime
    updated_at:  datetime
    model_config = {"from_attributes": True}

class ChatHistoryUpdate(BaseModel):
    notes:    Optional[str]  = None    # 使用者備註（可空字串表示清除）

class ChatHistoryListResponse(BaseModel):
    total:  int
    items:  list[ChatHistoryOut]


# ── Trained Model ─────────────────────────────────────────────────────

class TrainedModelCreate(BaseModel):
    name:             str
    description:      Optional[str]          = None
    task_type:        str                     # detect|pose|segment|classify|obb
    model_filename:   str
    model_size_mb:    Optional[float]         = None
    model_format:     str                     = "e2e"
    output_shape:     Optional[str]           = None
    input_size:       int                     = 640
    num_classes:      int                     = 80
    class_names:      Optional[list[str]]     = None
    dataset_name:     Optional[str]           = None
    is_active:        bool                    = False
    source:           str                     = "custom"
    base_model:       Optional[str]           = None
    metrics:          Optional[dict]          = None
    notes:            Optional[str]           = None

class TrainedModelUpdate(BaseModel):
    name:             Optional[str]           = None
    description:      Optional[str]           = None
    model_filename:   Optional[str]           = None
    model_size_mb:    Optional[float]         = None
    model_format:     Optional[str]           = None
    output_shape:     Optional[str]           = None
    input_size:       Optional[int]           = None
    num_classes:      Optional[int]           = None
    class_names:      Optional[list[str]]     = None
    dataset_name:     Optional[str]           = None
    is_active:        Optional[bool]          = None
    source:           Optional[str]           = None
    base_model:       Optional[str]           = None
    metrics:          Optional[dict]          = None
    notes:            Optional[str]           = None

class TrainedModelOut(BaseModel):
    id:               str
    name:             str
    description:      Optional[str]   = None
    task_type:        str
    model_filename:   str
    model_size_mb:    Optional[float] = None
    model_format:     str
    output_shape:     Optional[str]   = None
    input_size:       int
    num_classes:      int
    class_names:      Optional[list]  = None
    dataset_name:     Optional[str]   = None
    is_active:        bool
    is_builtin:       bool
    source:           str
    base_model:       Optional[str]   = None
    metrics:          Optional[dict]  = None
    notes:            Optional[str]   = None
    created_at:       datetime
    updated_at:       datetime
    model_config = {"from_attributes": True}

class TrainedModelListResponse(BaseModel):
    total:  int
    items:  list[TrainedModelOut]

class ActiveModelsResponse(BaseModel):
    """各 task_type 目前啟用的模型映射"""
    models: dict[str, TrainedModelOut]   # {"detect": ..., "pose": ...}
