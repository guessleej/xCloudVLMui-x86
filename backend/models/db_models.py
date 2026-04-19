"""
db_models.py — SQLAlchemy ORM 資料表定義
"""
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import (
    String, Float, Integer, Boolean, Text,
    DateTime, ForeignKey, JSON,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id:            Mapped[str]            = mapped_column(String(64),  primary_key=True)
    name:          Mapped[Optional[str]]  = mapped_column(String(128), nullable=True)
    email:         Mapped[Optional[str]]  = mapped_column(String(256), nullable=True, index=True)
    image:         Mapped[Optional[str]]  = mapped_column(Text,        nullable=True)
    provider:      Mapped[Optional[str]]  = mapped_column(String(32),  nullable=True)
    provider_id:   Mapped[Optional[str]]  = mapped_column(String(128), nullable=True)
    created_at:    Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=_now)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    reports: Mapped[list["Report"]] = relationship("Report", back_populates="user", lazy="selectin")


class Report(Base):
    __tablename__ = "reports"

    id:               Mapped[str]           = mapped_column(String(64),   primary_key=True)
    user_id:          Mapped[Optional[str]] = mapped_column(String(64),   ForeignKey("users.id"), nullable=True)
    title:            Mapped[str]           = mapped_column(String(256))
    equipment_id:     Mapped[Optional[str]] = mapped_column(String(64),   nullable=True, index=True)
    equipment_name:   Mapped[Optional[str]] = mapped_column(String(128),  nullable=True)
    risk_level:       Mapped[str]           = mapped_column(String(16),   default="moderate")
    source:           Mapped[str]           = mapped_column(String(32),   default="manual")  # vlm-diagnosis | pdm-inspection | manual
    raw_vlm_json:     Mapped[Optional[dict]] = mapped_column(JSON,        nullable=True)
    markdown_content: Mapped[Optional[str]] = mapped_column(Text,         nullable=True)
    created_at:       Mapped[datetime]      = mapped_column(DateTime(timezone=True), default=_now, index=True)
    updated_at:       Mapped[datetime]      = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    is_deleted:       Mapped[bool]          = mapped_column(Boolean,      default=False)

    user: Mapped[Optional["User"]] = relationship("User", back_populates="reports")


class RagDocument(Base):
    """上傳的維修手冊 / 歷史工單文件"""
    __tablename__ = "rag_documents"

    id:          Mapped[str]            = mapped_column(String(64),  primary_key=True)
    filename:    Mapped[str]            = mapped_column(String(256))
    file_type:   Mapped[str]            = mapped_column(String(16),  default="pdf")
    file_size:   Mapped[Optional[int]]  = mapped_column(Integer,     nullable=True)
    description: Mapped[Optional[str]]  = mapped_column(Text,        nullable=True)
    chunk_count: Mapped[int]            = mapped_column(Integer,     default=0)
    embedded:    Mapped[bool]           = mapped_column(Boolean,     default=False)
    created_at:  Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=_now)


import uuid as _uuid

class SystemSettings(Base):
    """系統設定（鍵值對存儲）"""
    __tablename__ = "system_settings"

    id:          Mapped[str]           = mapped_column(String(64),  primary_key=True, default=lambda: str(_uuid.uuid4()))
    key:         Mapped[str]           = mapped_column(String(128), unique=True, nullable=False, index=True)
    value:       Mapped[Optional[str]] = mapped_column(Text,        nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text,        nullable=True)
    updated_at:  Mapped[datetime]      = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class FeatureFlag(Base):
    """
    功能開關（Feature Flags）
    ============================
    用於控制功能的漸進式推出（Rollout）與 A/B 實驗。
    透過 GET/PUT /api/settings/feature-flags 管理。

    欄位說明：
      key         — 旗標唯一識別碼（例：ff.line_notify）
      enabled     — 是否啟用
      rollout_pct — 推出百分比（0–100；100 = 全量；未來擴充用）
      description — 功能說明
      extra_config — JSON 格式的額外設定（如 webhook URL、threshold 等）
    """
    __tablename__ = "feature_flags"

    id:           Mapped[str]            = mapped_column(String(64),  primary_key=True, default=lambda: str(_uuid.uuid4()))
    key:          Mapped[str]            = mapped_column(String(128), unique=True, nullable=False, index=True)
    enabled:      Mapped[bool]           = mapped_column(Boolean,     default=False, nullable=False)
    rollout_pct:  Mapped[int]            = mapped_column(Integer,     default=100, nullable=False)  # 0–100
    description:  Mapped[Optional[str]]  = mapped_column(Text,        nullable=True)
    extra_config: Mapped[Optional[dict]] = mapped_column("metadata", JSON, nullable=True)  # DB 欄位名保持 metadata
    updated_at:  Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    created_at:  Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=_now)


class MqttDevice(Base):
    """MQTT 感應器設備登錄"""
    __tablename__ = "mqtt_devices"

    id:           Mapped[str]            = mapped_column(String(64),  primary_key=True, default=lambda: str(_uuid.uuid4()))
    device_id:    Mapped[str]            = mapped_column(String(128), unique=True, nullable=False, index=True)
    name:         Mapped[str]            = mapped_column(String(256), nullable=False)
    device_type:  Mapped[str]            = mapped_column(String(64),  default="sensor")
    location:     Mapped[Optional[str]]  = mapped_column(String(256), nullable=True)
    topic_prefix: Mapped[str]            = mapped_column(String(256), nullable=False)  # e.g. xcloud/compressor_01
    description:  Mapped[Optional[str]]  = mapped_column(Text,        nullable=True)
    online:       Mapped[bool]           = mapped_column(Boolean,     default=False)
    last_seen:    Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at:   Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=_now)

    readings: Mapped[list["MqttSensorReading"]] = relationship("MqttSensorReading", back_populates="device", lazy="selectin", cascade="all, delete-orphan")


class MqttSensorReading(Base):
    """MQTT 感測器讀值（時序資料）"""
    __tablename__ = "mqtt_sensor_readings"

    id:          Mapped[str]            = mapped_column(String(64),  primary_key=True, default=lambda: str(_uuid.uuid4()))
    device_id:   Mapped[str]            = mapped_column(String(128), ForeignKey("mqtt_devices.device_id"), nullable=False, index=True)
    topic:       Mapped[str]            = mapped_column(String(256), nullable=False, index=True)
    sensor_type: Mapped[str]            = mapped_column(String(64),  nullable=False, index=True)  # temperature | vibration | pressure | rpm...
    raw_payload: Mapped[Optional[str]]  = mapped_column(Text,        nullable=True)
    value:       Mapped[Optional[float]] = mapped_column(Float,      nullable=True)
    unit:        Mapped[Optional[str]]  = mapped_column(String(32),  nullable=True)
    quality:     Mapped[str]            = mapped_column(String(16),  default="good")  # good | stale | error
    timestamp:   Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=_now, index=True)

    device: Mapped["MqttDevice"] = relationship("MqttDevice", back_populates="readings")


class VhsReading(Base):
    """設備 VHS 分數歷史紀錄（來自 VLM 推論、人工輸入或初始種子資料）"""
    __tablename__ = "vhs_readings"

    id:           Mapped[str]            = mapped_column(String(64),  primary_key=True, default=lambda: str(_uuid.uuid4()))
    equipment_id: Mapped[str]            = mapped_column(String(64),  nullable=False, index=True)
    score:        Mapped[float]          = mapped_column(Float,       nullable=False)          # 0.0 – 100.0
    source:       Mapped[str]            = mapped_column(String(16),  default="manual")        # vlm | manual | seed
    notes:        Mapped[Optional[str]]  = mapped_column(Text,        nullable=True)
    recorded_at:  Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=_now, index=True)
    created_at:   Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=_now)


class EquipmentAlert(Base):
    """設備異常警報（持久化至 SQLite）"""
    __tablename__ = "equipment_alerts"

    id:             Mapped[str]           = mapped_column(String(64),  primary_key=True, default=lambda: str(_uuid.uuid4()))
    equipment_id:   Mapped[str]           = mapped_column(String(64),  nullable=False, index=True)
    equipment_name: Mapped[str]           = mapped_column(String(128), nullable=False)
    level:          Mapped[str]           = mapped_column(String(16),  default="moderate")  # critical | elevated | moderate | low
    message:        Mapped[str]           = mapped_column(Text,        nullable=False)
    resolved:       Mapped[bool]          = mapped_column(Boolean,     default=False, index=True)
    resolved_at:    Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at:     Mapped[datetime]      = mapped_column(DateTime(timezone=True), default=_now, index=True)


class MqttAlertThreshold(Base):
    """MQTT 感測器警報閾值設定"""
    __tablename__ = "mqtt_alert_thresholds"

    id:          Mapped[str]           = mapped_column(String(64),  primary_key=True, default=lambda: str(_uuid.uuid4()))
    device_id:   Mapped[str]           = mapped_column(String(128), ForeignKey("mqtt_devices.device_id"), nullable=False, index=True)
    sensor_type: Mapped[str]           = mapped_column(String(64),  nullable=False)
    min_value:   Mapped[Optional[float]] = mapped_column(Float,     nullable=True)
    max_value:   Mapped[Optional[float]] = mapped_column(Float,     nullable=True)
    warn_min:    Mapped[Optional[float]] = mapped_column(Float,     nullable=True)
    warn_max:    Mapped[Optional[float]] = mapped_column(Float,     nullable=True)
    unit:        Mapped[Optional[str]] = mapped_column(String(32),  nullable=True)
    enabled:     Mapped[bool]          = mapped_column(Boolean,     default=True)
    created_at:  Mapped[datetime]      = mapped_column(DateTime(timezone=True), default=_now)
    updated_at:  Mapped[datetime]      = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class VisionSession(Base):
    """視覺分析會話（YOLO + VLM 合併結果）

    四種模式：
      equipment — 設備巡檢（yolo26n detect + VLM，記錄 vhs_score）
      people    — 人員辨識（yolo26n-pose + VLM，記錄 pose_keypoints）
      events    — 事件偵測（yolo26n detect + SORT tracking + VLM，記錄 track_history）
      objects   — 物品辨識（yolo26n detect + VLM，記錄 five_s_score）
    """
    __tablename__ = "vision_sessions"

    id:             Mapped[str]            = mapped_column(String(64),   primary_key=True, default=lambda: str(_uuid.uuid4()))
    mode:           Mapped[str]            = mapped_column(String(32),   nullable=False, index=True)
    equipment_id:   Mapped[Optional[str]]  = mapped_column(String(64),   nullable=True,  index=True)

    # VLM 分析
    vlm_prompt:     Mapped[Optional[str]]  = mapped_column(Text,         nullable=True)
    vlm_result:     Mapped[Optional[str]]  = mapped_column(Text,         nullable=True)
    risk_level:     Mapped[Optional[str]]  = mapped_column(String(16),   nullable=True)   # critical|elevated|moderate|low
    vhs_score:      Mapped[Optional[int]]  = mapped_column(Integer,      nullable=True)   # Equipment: 0–100
    five_s_score:   Mapped[Optional[int]]  = mapped_column(Integer,      nullable=True)   # Objects: 5–25

    # YOLO 偵測
    yolo_model:     Mapped[str]            = mapped_column(String(64),   default="yolo26n")
    yolo_task:      Mapped[str]            = mapped_column(String(32),   default="detect")  # detect|pose|track
    detections:     Mapped[Optional[list]] = mapped_column(JSON,         nullable=True)    # [{classId,label,conf,x,y,w,h,risk,category}]
    person_count:   Mapped[int]            = mapped_column(Integer,      default=0)
    vehicle_count:  Mapped[int]            = mapped_column(Integer,      default=0)
    hazard_count:   Mapped[int]            = mapped_column(Integer,      default=0)

    # 模式專屬資料
    pose_keypoints: Mapped[Optional[list]] = mapped_column(JSON,         nullable=True)   # People: [{personIdx, keypoints:[{name,x,y,v}×17]}]
    track_history:  Mapped[Optional[list]] = mapped_column(JSON,         nullable=True)   # Events: [{trackId, classId, label, x,y,w,h, age, hits}]
    segment_counts: Mapped[Optional[dict]] = mapped_column(JSON,         nullable=True)   # Objects: {className: count}

    # 媒體（縮圖）
    thumbnail:      Mapped[Optional[str]]  = mapped_column(Text,         nullable=True)   # base64 data URL（≤40KB）

    # 計時
    duration_ms:    Mapped[Optional[int]]  = mapped_column(Integer,      nullable=True)   # VLM 推論耗時

    created_at:     Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=_now, index=True)


class ChatHistory(Base):
    """知識庫問答歷史紀錄（每次 RAG 問答自動儲存）"""
    __tablename__ = "chat_history"

    id:           Mapped[str]            = mapped_column(String(64),  primary_key=True, default=lambda: str(_uuid.uuid4()))
    session_id:   Mapped[Optional[str]]  = mapped_column(String(64),  nullable=True,  index=True)  # 同一會話的群組 ID
    question:     Mapped[str]            = mapped_column(Text,        nullable=False)
    answer:       Mapped[str]            = mapped_column(Text,        nullable=False)
    sources:      Mapped[Optional[list]] = mapped_column(JSON,        nullable=True)    # [{filename, chunk_index, score, preview}]
    latency_ms:   Mapped[Optional[int]]  = mapped_column(Integer,     nullable=True)
    notes:        Mapped[Optional[str]]  = mapped_column(Text,        nullable=True)    # 使用者備註（可修改）
    is_deleted:   Mapped[bool]           = mapped_column(Boolean,     default=False,    index=True)
    created_at:   Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=_now, index=True)
    updated_at:   Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class TrainedModel(Base):
    """視覺推論模型登錄表（ONNX 模型管理）

    task_type 枚舉：
      detect   — 物件偵測 (yolo26n)          輸出 [1,300,6]
      pose     — 姿態估計 (yolo26n-pose)      輸出 [1,300,57]
      segment  — 實例分割 (yolo26n-seg)       輸出 [1,300,38+] + proto masks
      classify — 影像分類 (yolo26n-cls)       輸出 [1,num_classes]
      obb      — 旋轉框偵測 (yolo26n-obb)     輸出 [1,300,7]

    model_format 枚舉：
      e2e         — E2E One-to-One Head（YOLO26 預設，內建 NMS）
      traditional — 傳統 head [1,84,8400]（YOLO11/v8 格式）
    """
    __tablename__ = "trained_models"

    id:               Mapped[str]            = mapped_column(String(64),   primary_key=True, default=lambda: str(_uuid.uuid4()))
    name:             Mapped[str]            = mapped_column(String(256),  nullable=False)
    description:      Mapped[Optional[str]]  = mapped_column(Text,         nullable=True)

    # 任務與檔案
    task_type:        Mapped[str]            = mapped_column(String(32),   nullable=False, index=True)  # detect|pose|segment|classify|obb
    model_filename:   Mapped[str]            = mapped_column(String(256),  nullable=False)              # 相對於 /public/models/
    model_size_mb:    Mapped[Optional[float]] = mapped_column(Float,       nullable=True)
    model_format:     Mapped[str]            = mapped_column(String(32),   default="e2e")               # e2e|traditional
    output_shape:     Mapped[Optional[str]]  = mapped_column(String(64),   nullable=True)              # "[1,300,6]"
    input_size:       Mapped[int]            = mapped_column(Integer,      default=640)                 # 輸入邊長（px）

    # 類別
    num_classes:      Mapped[int]            = mapped_column(Integer,      default=80)
    class_names:      Mapped[Optional[list]] = mapped_column(JSON,         nullable=True)              # ["person","bicycle",…]
    dataset_name:     Mapped[Optional[str]]  = mapped_column(String(128),  nullable=True)              # "COCO" | "custom"

    # 狀態
    is_active:        Mapped[bool]           = mapped_column(Boolean,      default=False, index=True)  # 該 task_type 當前啟用
    is_builtin:       Mapped[bool]           = mapped_column(Boolean,      default=False)              # 系統預設，不可刪除
    source:           Mapped[str]            = mapped_column(String(64),   default="ultralytics")      # ultralytics|custom|fine-tuned
    base_model:       Mapped[Optional[str]]  = mapped_column(String(64),   nullable=True)              # "yolo26n"|"yolo11n"|…

    # 效能指標
    metrics:          Mapped[Optional[dict]] = mapped_column(JSON,         nullable=True)              # {mAP:40.9, precision:87, latency_ms:56}

    # 備註與時間
    notes:            Mapped[Optional[str]]  = mapped_column(Text,         nullable=True)
    created_at:       Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=_now, index=True)
    updated_at:       Mapped[datetime]       = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
