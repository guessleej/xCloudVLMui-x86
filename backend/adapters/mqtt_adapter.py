"""
adapters/mqtt_adapter.py — Eclipse Mosquitto MQTT 適配器
==========================================================
封裝 aiomqtt 客戶端，提供重連邏輯與訊息發布介面。
實作 ISensorAdapter Protocol。

設定（來自 config.Settings）：
  mqtt_broker_host  — Broker 主機名稱（預設 mosquitto）
  mqtt_broker_port  — Broker 連接埠（預設 1883）
  mqtt_username     — 認證帳號（可選）
  mqtt_password     — 認證密碼（可選）
"""
from __future__ import annotations

import asyncio
import logging
from typing import Callable, Awaitable

from config import get_settings

logger    = logging.getLogger(__name__)
_settings = get_settings()


class MqttAdapter:
    """
    aiomqtt 非同步 MQTT 適配器。

    使用方式：
        adapter = MqttAdapter()
        await adapter.connect()
        await adapter.publish("xcloud/AIR-030/temperature", "72.5")
        await adapter.disconnect()
    """

    def __init__(
        self,
        host:     str = "",
        port:     int = 0,
        username: str = "",
        password: str = "",
    ) -> None:
        self._host     = host     or _settings.mqtt_broker_host
        self._port     = port     or _settings.mqtt_broker_port
        self._username = username or _settings.mqtt_username
        self._password = password or _settings.mqtt_password
        self._client   = None
        self._connected = False

    # ── ISensorAdapter Protocol 實作 ──────────────────────────────────

    async def connect(self) -> None:
        """建立 MQTT 連線（使用 aiomqtt）"""
        try:
            import aiomqtt  # type: ignore[import]
        except ImportError:
            raise RuntimeError(
                "aiomqtt 未安裝。請執行：pip install aiomqtt"
            )

        kwargs: dict = {"hostname": self._host, "port": self._port}
        if self._username:
            kwargs["username"] = self._username
        if self._password:
            kwargs["password"] = self._password

        self._client    = aiomqtt.Client(**kwargs)
        self._connected = True
        logger.info("MqttAdapter connected → %s:%d", self._host, self._port)

    async def disconnect(self) -> None:
        """關閉 MQTT 連線"""
        self._connected = False
        self._client    = None
        logger.info("MqttAdapter disconnected.")

    async def publish(self, topic: str, payload: str | bytes, qos: int = 0) -> None:
        """發布訊息至指定主題"""
        if not self._connected or self._client is None:
            raise RuntimeError("MqttAdapter: 尚未連線，請先呼叫 connect()")
        async with self._client as c:
            await c.publish(topic, payload=payload, qos=qos)

    async def subscribe(self, topic: str, qos: int = 0) -> None:
        """訂閱指定主題（需在 async with client 上下文中使用）"""
        if not self._connected or self._client is None:
            raise RuntimeError("MqttAdapter: 尚未連線，請先呼叫 connect()")
        async with self._client as c:
            await c.subscribe(topic, qos=qos)

    def is_connected(self) -> bool:
        """回傳目前連線狀態"""
        return self._connected

    # ── 便利方法：TCP Probe ───────────────────────────────────────────

    @staticmethod
    async def tcp_probe(host: str = "", port: int = 0, timeout: float = 2.0) -> bool:
        """
        使用 TCP 連線探測 Broker 可用性（不需完整 MQTT 握手）。
        適合 /api/health 輕量健康探測。
        """
        _host = host or _settings.mqtt_broker_host
        _port = port or _settings.mqtt_broker_port
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(_host, _port),
                timeout=timeout,
            )
            writer.close()
            await writer.wait_closed()
            return True
        except Exception:
            return False
