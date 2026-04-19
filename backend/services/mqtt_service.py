"""
services/mqtt_service.py — MQTT 訂閱服務
使用 aiomqtt 連接 Mosquitto Broker，接收感測器資料存入 SQLite

Topic 格式：xcloud/{device_id}/{sensor_type}
Payload 格式（JSON 或純數字）：
  JSON: {"value": 72.5, "unit": "°C", "quality": "good"}
  純數字: 72.5
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional
import uuid

import aiomqtt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from database import AsyncSessionLocal
from models.db_models import MqttDevice, MqttSensorReading
from config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# ── 全域狀態 ──────────────────────────────────────────────────────────
class MqttState:
    connected:     bool = False
    message_count: int  = 0
    start_time:    float = time.time()
    subscriptions: list[str] = []

mqtt_state = MqttState()

# ── Sensor 單位對應表 ─────────────────────────────────────────────────
SENSOR_UNITS: dict[str, str] = {
    "temperature":  "°C",
    "humidity":     "%RH",
    "pressure":     "bar",
    "vibration":    "mm/s",
    "rpm":          "RPM",
    "voltage":      "V",
    "current":      "A",
    "power":        "kW",
    "flow":         "L/min",
    "level":        "%",
    "status":       "",
    "co2":          "ppm",
    "noise":        "dB",
}


def _parse_payload(raw: str, sensor_type: str) -> tuple[Optional[float], str, str]:
    """解析 MQTT payload，回傳 (value, unit, quality)"""
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            value   = float(data.get("value", 0))
            unit    = data.get("unit", SENSOR_UNITS.get(sensor_type, ""))
            quality = data.get("quality", "good")
            return value, unit, quality
        elif isinstance(data, (int, float)):
            return float(data), SENSOR_UNITS.get(sensor_type, ""), "good"
    except (json.JSONDecodeError, ValueError, TypeError):
        try:
            return float(raw.strip()), SENSOR_UNITS.get(sensor_type, ""), "good"
        except ValueError:
            return None, "", "error"
    return None, "", "error"


async def _save_reading(device_id: str, topic: str, sensor_type: str,
                        raw_payload: str, value: Optional[float],
                        unit: str, quality: str) -> None:
    """將感測值存入 DB，並更新設備 last_seen / online"""
    async with AsyncSessionLocal() as session:
        try:
            now = datetime.now(timezone.utc)

            # 更新設備在線狀態
            await session.execute(
                update(MqttDevice)
                .where(MqttDevice.device_id == device_id)
                .values(online=True, last_seen=now)
            )

            # 新增讀值
            reading = MqttSensorReading(
                id=          str(uuid.uuid4()),
                device_id=   device_id,
                topic=       topic,
                sensor_type= sensor_type,
                raw_payload= raw_payload,
                value=       value,
                unit=        unit,
                quality=     quality,
                timestamp=   now,
            )
            session.add(reading)
            await session.commit()
        except Exception as e:
            await session.rollback()
            logger.error("Failed to save MQTT reading: %s", e)


async def _handle_message(message: aiomqtt.Message) -> None:
    """處理單條 MQTT 訊息"""
    topic_str  = str(message.topic)
    raw        = message.payload.decode("utf-8", errors="replace") if isinstance(message.payload, bytes) else str(message.payload)
    parts      = topic_str.split("/")

    # 預期格式：xcloud/{device_id}/{sensor_type}
    if len(parts) < 3:
        logger.debug("Skipping unexpected topic: %s", topic_str)
        return

    device_id   = parts[1]
    sensor_type = parts[2]
    value, unit, quality = _parse_payload(raw, sensor_type)

    mqtt_state.message_count += 1
    logger.debug("MQTT ← [%s] val=%s unit=%s quality=%s", topic_str, value, unit, quality)
    await _save_reading(device_id, topic_str, sensor_type, raw, value, unit, quality)


async def mqtt_listener() -> None:
    """
    主 MQTT 訂閱迴圈：連線 → 訂閱 → 持續接收
    斷線後自動重連（指數退避，最大 60 秒）
    """
    host     = settings.mqtt_broker_host
    port     = settings.mqtt_broker_port
    username = settings.mqtt_username or None
    password = settings.mqtt_password or None
    topic    = settings.mqtt_topic_filter  # 預設 "xcloud/#"
    client_id = f"xcloudvlm-backend-{uuid.uuid4().hex[:8]}"

    mqtt_state.subscriptions = [topic]
    retry_delay = 5

    logger.info("MQTT listener starting → %s:%d  topic=%s", host, port, topic)

    while True:
        try:
            async with aiomqtt.Client(
                hostname=  host,
                port=      port,
                username=  username,
                password=  password,
                identifier=client_id,
                keepalive= 60,
            ) as client:
                mqtt_state.connected = True
                retry_delay = 5
                logger.info("✅ MQTT connected to %s:%d", host, port)

                await client.subscribe(topic, qos=1)
                logger.info("Subscribed to %s", topic)

                async for message in client.messages:
                    await _handle_message(message)

        except aiomqtt.MqttError as exc:
            mqtt_state.connected = False
            logger.warning("MQTT connection lost: %s — retry in %ds", exc, retry_delay)
            await asyncio.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 60)

        except asyncio.CancelledError:
            logger.info("MQTT listener cancelled.")
            mqtt_state.connected = False
            break

        except Exception as exc:
            mqtt_state.connected = False
            logger.error("MQTT unexpected error: %s — retry in %ds", exc, retry_delay)
            await asyncio.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 60)


async def publish_message(host: str, port: int, topic: str, payload: str,
                          qos: int = 0, retain: bool = False,
                          username: Optional[str] = None,
                          password: Optional[str] = None) -> bool:
    """單次發佈訊息（用於測試）"""
    try:
        async with aiomqtt.Client(
            hostname= host,
            port=     port,
            username= username,
            password= password,
            identifier=f"xcloudvlm-pub-{uuid.uuid4().hex[:6]}",
        ) as client:
            await client.publish(topic, payload=payload.encode(), qos=qos, retain=retain)
        return True
    except Exception as exc:
        logger.error("MQTT publish failed: %s", exc)
        return False
