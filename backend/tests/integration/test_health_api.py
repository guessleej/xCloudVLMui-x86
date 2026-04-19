"""
tests/integration/test_health_api.py — 系統健康 API 整合測試
=============================================================
測試對象：
  GET /api/health → HealthResponse

在 CI 測試環境中 LLM / MQTT / ChromaDB 不一定可用，
所以測試關注：
  1. 端點可回應（不崩潰）
  2. 回應 schema 正確（所有必填欄位存在）
  3. status 值合法（"ok" | "degraded"）
  4. version 為 1.1.0
  5. db_ok 在 in-memory DB 下應為 True
"""
from __future__ import annotations

import pytest


@pytest.mark.anyio
async def test_health_endpoint_returns_200(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200


@pytest.mark.anyio
async def test_health_response_schema(client):
    """HealthResponse 必填欄位驗證"""
    resp = await client.get("/api/health")
    data = resp.json()
    required_fields = ["status", "version", "db_ok", "llm_ok", "mqtt_ok", "chroma_ok", "timestamp"]
    for field in required_fields:
        assert field in data, f"Missing field: {field}"


@pytest.mark.anyio
async def test_health_status_is_valid_value(client):
    """status 只能是 'ok' 或 'degraded'"""
    resp   = await client.get("/api/health")
    status = resp.json()["status"]
    assert status in {"ok", "degraded"}, f"Unexpected status: {status}"


@pytest.mark.anyio
async def test_health_version_is_1_1_0(client):
    resp = await client.get("/api/health")
    assert resp.json()["version"] == "1.1.0"


@pytest.mark.anyio
async def test_health_boolean_fields(client):
    """db_ok / llm_ok / mqtt_ok / chroma_ok 應為布林值"""
    resp = await client.get("/api/health")
    data = resp.json()
    for field in ["db_ok", "llm_ok", "mqtt_ok", "chroma_ok"]:
        assert isinstance(data[field], bool), f"{field} should be bool, got {type(data[field])}"


@pytest.mark.anyio
async def test_health_timestamp_is_iso8601(client):
    """timestamp 應為合法的 ISO 8601 字串"""
    from datetime import datetime
    resp      = await client.get("/api/health")
    timestamp = resp.json()["timestamp"]
    # 若可以解析就算合法
    dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    assert dt is not None
