"""
routers/mqtt.py — MQTT 設備管理 & 感測器資料 API

Endpoints:
  GET  /api/mqtt/status                    Broker 連線狀態
  GET  /api/mqtt/devices                   所有已登錄設備
  POST /api/mqtt/devices                   新增設備
  PUT  /api/mqtt/devices/{device_id}       更新設備
  DELETE /api/mqtt/devices/{device_id}     刪除設備
  GET  /api/mqtt/devices/{device_id}/readings   指定設備讀值（分頁）
  GET  /api/mqtt/readings/latest           所有設備最新讀值
  POST /api/mqtt/publish                   發佈測試訊息
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.db_models import MqttDevice, MqttSensorReading
from models.schemas import (
    MqttDeviceCreate, MqttDeviceUpdate, MqttDeviceOut,
    MqttSensorReadingOut, MqttLatestReading,
    MqttBrokerStatus, MqttPublishRequest,
    MqttThresholdCreate, MqttThresholdOut, MqttDeviceDetail, MqttChartPoint,
)
from services.mqtt_service import mqtt_state, publish_message
from config import get_settings

router   = APIRouter(prefix="/api/mqtt", tags=["mqtt"])
settings = get_settings()


# ── 狀態 ──────────────────────────────────────────────────────────────
@router.get("/status", response_model=MqttBrokerStatus)
async def get_broker_status():
    """取得 MQTT Broker 連線狀態"""
    return MqttBrokerStatus(
        connected=      mqtt_state.connected,
        broker_host=    settings.mqtt_broker_host,
        broker_port=    settings.mqtt_broker_port,
        client_id=      "xcloudvlm-backend",
        subscriptions=  mqtt_state.subscriptions,
        message_count=  mqtt_state.message_count,
        uptime_seconds= round(time.time() - mqtt_state.start_time, 1),
    )


# ── 設備 CRUD ─────────────────────────────────────────────────────────
@router.get("/devices", response_model=list[MqttDeviceOut])
async def list_devices(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MqttDevice).order_by(MqttDevice.created_at.desc()))
    return result.scalars().all()


@router.post("/devices", response_model=MqttDeviceOut, status_code=201)
async def create_device(body: MqttDeviceCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(
        select(MqttDevice).where(MqttDevice.device_id == body.device_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Device ID '{body.device_id}' already exists")

    device = MqttDevice(
        id=           str(uuid.uuid4()),
        device_id=    body.device_id,
        name=         body.name,
        device_type=  body.device_type,
        location=     body.location,
        topic_prefix= body.topic_prefix,
        description=  body.description,
    )
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return device


@router.put("/devices/{device_id}", response_model=MqttDeviceOut)
async def update_device(device_id: str, body: MqttDeviceUpdate,
                         db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MqttDevice).where(MqttDevice.device_id == device_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    for field, val in body.model_dump(exclude_none=True).items():
        setattr(device, field, val)

    await db.commit()
    await db.refresh(device)
    return device


@router.delete("/devices/{device_id}", status_code=204)
async def delete_device(device_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MqttDevice).where(MqttDevice.device_id == device_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    await db.delete(device)
    await db.commit()


# ── 讀值查詢 ──────────────────────────────────────────────────────────
@router.get("/devices/{device_id}/readings", response_model=list[MqttSensorReadingOut])
async def get_device_readings(
    device_id:   str,
    sensor_type: Optional[str] = Query(None),
    limit:       int           = Query(100, ge=1, le=1000),
    offset:      int           = Query(0, ge=0),
    db:          AsyncSession  = Depends(get_db),
):
    q = select(MqttSensorReading).where(
        MqttSensorReading.device_id == device_id
    )
    if sensor_type:
        q = q.where(MqttSensorReading.sensor_type == sensor_type)
    q = q.order_by(desc(MqttSensorReading.timestamp)).limit(limit).offset(offset)

    result = await db.execute(q)
    rows = result.scalars().all()
    return [
        MqttSensorReadingOut(
            id=          r.id,
            device_id=   r.device_id,
            topic=       r.topic,
            sensor_type= r.sensor_type,
            value=       r.value,
            unit=        r.unit,
            quality=     r.quality,
            timestamp=   r.timestamp.isoformat(),
        ) for r in rows
    ]


@router.get("/readings/latest", response_model=list[MqttLatestReading])
async def get_latest_readings(db: AsyncSession = Depends(get_db)):
    """每個 topic 的最新讀值（用於 Dashboard 即時顯示）"""
    # 每個 (device_id, sensor_type) 取最新一筆
    subq = (
        select(
            MqttSensorReading.device_id,
            MqttSensorReading.sensor_type,
            func.max(MqttSensorReading.timestamp).label("max_ts"),
        )
        .group_by(MqttSensorReading.device_id, MqttSensorReading.sensor_type)
        .subquery()
    )

    q = (
        select(MqttSensorReading, MqttDevice.name.label("device_name"))
        .join(
            subq,
            (MqttSensorReading.device_id == subq.c.device_id)
            & (MqttSensorReading.sensor_type == subq.c.sensor_type)
            & (MqttSensorReading.timestamp == subq.c.max_ts),
        )
        .join(MqttDevice, MqttDevice.device_id == MqttSensorReading.device_id)
        .order_by(MqttSensorReading.device_id, MqttSensorReading.sensor_type)
    )

    result = await db.execute(q)
    rows   = result.all()

    return [
        MqttLatestReading(
            device_id=   r.MqttSensorReading.device_id,
            device_name= r.device_name,
            topic=       r.MqttSensorReading.topic,
            sensor_type= r.MqttSensorReading.sensor_type,
            value=       r.MqttSensorReading.value,
            unit=        r.MqttSensorReading.unit,
            quality=     r.MqttSensorReading.quality,
            timestamp=   r.MqttSensorReading.timestamp.isoformat(),
        )
        for r in rows
    ]


# ── 測試發佈 ──────────────────────────────────────────────────────────
@router.post("/publish")
async def test_publish(body: MqttPublishRequest):
    """發佈測試訊息到 Broker（用於驗證連線）"""
    ok = await publish_message(
        host=     settings.mqtt_broker_host,
        port=     settings.mqtt_broker_port,
        topic=    body.topic,
        payload=  body.payload,
        qos=      body.qos,
        retain=   body.retain,
        username= settings.mqtt_username or None,
        password= settings.mqtt_password or None,
    )
    if not ok:
        raise HTTPException(status_code=503, detail="MQTT publish failed — check broker connection")
    return {"ok": True, "topic": body.topic}


# ── 設備詳情 ──────────────────────────────────────────────────────────
@router.get("/devices/{device_id}/detail", response_model=MqttDeviceDetail)
async def get_device_detail(device_id: str, db: AsyncSession = Depends(get_db)):
    """取得設備詳情 + 統計資訊 + 閾值設定"""
    from models.db_models import MqttAlertThreshold

    result = await db.execute(select(MqttDevice).where(MqttDevice.device_id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    # 讀值統計
    count_result = await db.execute(
        select(func.count()).where(MqttSensorReading.device_id == device_id)
    )
    reading_count = count_result.scalar_one()

    # 感測器類型列表
    types_result = await db.execute(
        select(MqttSensorReading.sensor_type).where(
            MqttSensorReading.device_id == device_id
        ).distinct()
    )
    sensor_types = [r[0] for r in types_result.all()]

    # 警報閾值
    thresh_result = await db.execute(
        select(MqttAlertThreshold).where(MqttAlertThreshold.device_id == device_id)
    )
    thresholds = thresh_result.scalars().all()

    return MqttDeviceDetail(
        id=           device.id,
        device_id=    device.device_id,
        name=         device.name,
        device_type=  device.device_type,
        location=     device.location,
        topic_prefix= device.topic_prefix,
        description=  device.description,
        online=       device.online,
        last_seen=    device.last_seen.isoformat() if device.last_seen else None,
        created_at=   device.created_at.isoformat(),
        reading_count= reading_count,
        sensor_types=  sensor_types,
        thresholds=[
            MqttThresholdOut(
                id=          t.id,
                device_id=   t.device_id,
                sensor_type= t.sensor_type,
                min_value=   t.min_value,
                max_value=   t.max_value,
                warn_min=    t.warn_min,
                warn_max=    t.warn_max,
                unit=        t.unit,
                enabled=     t.enabled,
                created_at=  t.created_at.isoformat(),
                updated_at=  t.updated_at.isoformat(),
            ) for t in thresholds
        ],
    )


@router.get("/devices/{device_id}/readings/chart", response_model=list[MqttChartPoint])
async def get_device_chart(
    device_id:   str,
    sensor_type: str = Query(...),
    limit:       int = Query(60, ge=10, le=500),
    db:          AsyncSession = Depends(get_db),
):
    """取得圖表用的歷史讀值（時序）"""
    result = await db.execute(
        select(MqttSensorReading)
        .where(
            MqttSensorReading.device_id   == device_id,
            MqttSensorReading.sensor_type == sensor_type,
        )
        .order_by(desc(MqttSensorReading.timestamp))
        .limit(limit)
    )
    rows = list(reversed(result.scalars().all()))
    return [
        MqttChartPoint(
            timestamp= r.timestamp.strftime("%H:%M:%S"),
            value=     r.value,
            quality=   r.quality,
        ) for r in rows
    ]


# ── 閾值 CRUD ─────────────────────────────────────────────────────────
@router.get("/devices/{device_id}/thresholds", response_model=list[MqttThresholdOut])
async def list_thresholds(device_id: str, db: AsyncSession = Depends(get_db)):
    from models.db_models import MqttAlertThreshold
    result = await db.execute(
        select(MqttAlertThreshold).where(MqttAlertThreshold.device_id == device_id)
    )
    rows = result.scalars().all()
    return [
        MqttThresholdOut(
            id=          t.id, device_id=t.device_id, sensor_type=t.sensor_type,
            min_value=t.min_value, max_value=t.max_value,
            warn_min=t.warn_min, warn_max=t.warn_max,
            unit=t.unit, enabled=t.enabled,
            created_at=t.created_at.isoformat(), updated_at=t.updated_at.isoformat(),
        ) for t in rows
    ]


@router.post("/devices/{device_id}/thresholds", response_model=MqttThresholdOut, status_code=201)
async def create_threshold(
    device_id: str, body: MqttThresholdCreate, db: AsyncSession = Depends(get_db)
):
    from models.db_models import MqttAlertThreshold
    t = MqttAlertThreshold(
        id=str(uuid.uuid4()), device_id=device_id,
        sensor_type=body.sensor_type,
        min_value=body.min_value, max_value=body.max_value,
        warn_min=body.warn_min, warn_max=body.warn_max,
        unit=body.unit, enabled=body.enabled,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return MqttThresholdOut(
        id=t.id, device_id=t.device_id, sensor_type=t.sensor_type,
        min_value=t.min_value, max_value=t.max_value,
        warn_min=t.warn_min, warn_max=t.warn_max,
        unit=t.unit, enabled=t.enabled,
        created_at=t.created_at.isoformat(), updated_at=t.updated_at.isoformat(),
    )


@router.delete("/devices/{device_id}/thresholds/{threshold_id}", status_code=204)
async def delete_threshold(device_id: str, threshold_id: str, db: AsyncSession = Depends(get_db)):
    from models.db_models import MqttAlertThreshold
    result = await db.execute(
        select(MqttAlertThreshold).where(
            MqttAlertThreshold.id == threshold_id,
            MqttAlertThreshold.device_id == device_id,
        )
    )
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Threshold not found")
    await db.delete(t)
    await db.commit()
