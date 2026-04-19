"""
tests/unit/test_alerts.py — 警報路由單元測試
=============================================
測試對象：
  - GET  /api/alerts       — 列表查詢（過濾、排序）
  - POST /api/alerts       — 新增警報
  - PATCH /api/alerts/{id}/resolve — 解除警報
  - DELETE /api/alerts/{id}        — 刪除警報

使用 conftest.py 的 client fixture（in-memory SQLite，不啟動外部服務）。
"""
from __future__ import annotations

import pytest
import pytest_asyncio


# ── Helpers ──────────────────────────────────────────────────────────

def _alert_payload(
    equipment_id:   str = "AIR-030-01",
    equipment_name: str = "壓縮機 #1",
    level:          str = "critical",
    message:        str = "測試警報訊息",
) -> dict:
    return {
        "equipment_id":   equipment_id,
        "equipment_name": equipment_name,
        "level":          level,
        "message":        message,
    }


# ── POST /api/alerts ─────────────────────────────────────────────────

@pytest.mark.anyio
async def test_create_alert_returns_201(client):
    resp = await client.post("/api/alerts", json=_alert_payload())
    assert resp.status_code == 201
    data = resp.json()
    assert data["equipment_id"] == "AIR-030-01"
    assert data["level"]        == "critical"
    assert data["resolved"]     is False
    assert "id" in data


@pytest.mark.anyio
async def test_create_alert_resolved_false_by_default(client):
    resp = await client.post("/api/alerts", json=_alert_payload(level="moderate"))
    assert resp.json()["resolved"] is False
    assert resp.json()["resolved_at"] is None


# ── GET /api/alerts ──────────────────────────────────────────────────

@pytest.mark.anyio
async def test_get_alerts_empty_list(client):
    """種子資料植入前（DB 為空），回傳空列表或種子資料"""
    resp = await client.get("/api/alerts")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.anyio
async def test_get_alerts_returns_only_unresolved_by_default(client):
    """預設只回傳未解決警報"""
    # 建立 2 筆警報
    r1 = await client.post("/api/alerts", json=_alert_payload(level="critical"))
    r2 = await client.post("/api/alerts", json=_alert_payload(level="low"))
    alert_id = r1.json()["id"]

    # 解除第 1 筆
    await client.patch(f"/api/alerts/{alert_id}/resolve")

    # 不帶 include_resolved → 只回傳未解決
    resp = await client.get("/api/alerts")
    ids  = [a["id"] for a in resp.json()]
    assert alert_id not in ids


@pytest.mark.anyio
async def test_get_alerts_include_resolved(client):
    """include_resolved=true 時回傳所有警報"""
    r1 = await client.post("/api/alerts", json=_alert_payload(level="critical"))
    alert_id = r1.json()["id"]
    await client.patch(f"/api/alerts/{alert_id}/resolve")

    resp = await client.get("/api/alerts", params={"include_resolved": "true"})
    ids  = [a["id"] for a in resp.json()]
    assert alert_id in ids


@pytest.mark.anyio
async def test_get_alerts_filter_by_level(client):
    """level 過濾器應只回傳指定等級警報"""
    await client.post("/api/alerts", json=_alert_payload(level="critical"))
    await client.post("/api/alerts", json=_alert_payload(level="low"))

    resp = await client.get("/api/alerts", params={"level": "critical"})
    for alert in resp.json():
        assert alert["level"] == "critical"


# ── PATCH /api/alerts/{id}/resolve ──────────────────────────────────

@pytest.mark.anyio
async def test_resolve_alert_sets_resolved_true(client):
    r    = await client.post("/api/alerts", json=_alert_payload())
    _id  = r.json()["id"]
    resp = await client.patch(f"/api/alerts/{_id}/resolve")
    assert resp.status_code == 200
    data = resp.json()
    assert data["resolved"]     is True
    assert data["resolved_at"]  is not None


@pytest.mark.anyio
async def test_resolve_already_resolved_returns_409(client):
    """重複解除應回傳 409 Conflict"""
    r   = await client.post("/api/alerts", json=_alert_payload())
    _id = r.json()["id"]
    await client.patch(f"/api/alerts/{_id}/resolve")
    resp = await client.patch(f"/api/alerts/{_id}/resolve")
    assert resp.status_code == 409


@pytest.mark.anyio
async def test_resolve_nonexistent_alert_returns_404(client):
    resp = await client.patch("/api/alerts/nonexistent-id/resolve")
    assert resp.status_code == 404


# ── DELETE /api/alerts/{id} ──────────────────────────────────────────

@pytest.mark.anyio
async def test_delete_alert_returns_204(client):
    r    = await client.post("/api/alerts", json=_alert_payload())
    _id  = r.json()["id"]
    resp = await client.delete(f"/api/alerts/{_id}")
    assert resp.status_code == 204


@pytest.mark.anyio
async def test_delete_alert_removes_from_db(client):
    r   = await client.post("/api/alerts", json=_alert_payload())
    _id = r.json()["id"]
    await client.delete(f"/api/alerts/{_id}")
    # 刪除後 GET 單筆應 404
    resp = await client.get(f"/api/alerts/{_id}")
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_delete_nonexistent_alert_returns_404(client):
    resp = await client.delete("/api/alerts/nonexistent-id")
    assert resp.status_code == 404
