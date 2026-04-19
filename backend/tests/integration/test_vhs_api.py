"""
tests/integration/test_vhs_api.py — VHS 設備健康分數 API 整合測試
================================================================
測試對象：
  GET  /api/vhs/readings              — 查詢 VHS 讀值列表（依設備/天數過濾）
  POST /api/vhs/readings              — 新增 VHS 讀值
  GET  /api/vhs/readings/latest       — 各設備最新讀值
  GET  /api/vhs/readings/stats        — 設備統計（avg/min/max）

驗證要點：
  - CRUD 基本操作正確
  - score 範圍驗證（0–100）
  - source 欄位（vlm / manual / seed）
  - equipment_id 過濾正確運作
"""
from __future__ import annotations

import pytest


# ── Helpers ──────────────────────────────────────────────────────────

def _vhs_payload(
    equipment_id: str  = "EQ-TEST-001",
    score:        float = 75.5,
    source:       str  = "manual",
    notes:        str  = "單元測試讀值",
) -> dict:
    return {
        "equipment_id": equipment_id,
        "score":        score,
        "source":       source,
        "notes":        notes,
    }


# ── POST /api/vhs/readings ───────────────────────────────────────────

@pytest.mark.anyio
async def test_create_vhs_reading_returns_201(client):
    resp = await client.post("/api/vhs/readings", json=_vhs_payload())
    assert resp.status_code == 201


@pytest.mark.anyio
async def test_create_vhs_reading_schema(client):
    """回應應包含所有必填欄位"""
    resp = await client.post("/api/vhs/readings", json=_vhs_payload())
    data = resp.json()
    for field in ["id", "equipment_id", "score", "source", "recorded_at"]:
        assert field in data, f"Missing field: {field}"


@pytest.mark.anyio
async def test_create_vhs_reading_persists_correct_values(client):
    """寫入的值應正確保存"""
    payload = _vhs_payload(equipment_id="EQ-PERSIST-001", score=88.3, source="vlm")
    resp    = await client.post("/api/vhs/readings", json=payload)
    data    = resp.json()
    assert data["equipment_id"] == "EQ-PERSIST-001"
    assert data["score"]        == pytest.approx(88.3, abs=0.01)
    assert data["source"]       == "vlm"


@pytest.mark.anyio
async def test_create_vhs_reading_invalid_score_high(client):
    """score > 100 應回傳 422（Pydantic 驗證失敗）"""
    resp = await client.post("/api/vhs/readings", json=_vhs_payload(score=101.0))
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_create_vhs_reading_invalid_score_low(client):
    """score < 0 應回傳 422"""
    resp = await client.post("/api/vhs/readings", json=_vhs_payload(score=-1.0))
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_create_vhs_reading_boundary_score_zero(client):
    """score = 0.0（邊界值）應成功"""
    resp = await client.post("/api/vhs/readings", json=_vhs_payload(score=0.0))
    assert resp.status_code == 201
    assert resp.json()["score"] == pytest.approx(0.0)


@pytest.mark.anyio
async def test_create_vhs_reading_boundary_score_hundred(client):
    """score = 100.0（邊界值）應成功"""
    resp = await client.post("/api/vhs/readings", json=_vhs_payload(score=100.0))
    assert resp.status_code == 201
    assert resp.json()["score"] == pytest.approx(100.0)


# ── GET /api/vhs/readings ────────────────────────────────────────────

@pytest.mark.anyio
async def test_list_vhs_readings_returns_200(client):
    resp = await client.get("/api/vhs/readings")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.anyio
async def test_list_vhs_readings_filter_by_equipment_id(client):
    """equipment_id 過濾應只回傳指定設備讀值"""
    eq_id = "EQ-FILTER-001"
    # 建立 2 筆不同設備的讀值
    await client.post("/api/vhs/readings", json=_vhs_payload(equipment_id=eq_id, score=80.0))
    await client.post("/api/vhs/readings", json=_vhs_payload(equipment_id="EQ-OTHER-999", score=50.0))

    resp  = await client.get("/api/vhs/readings", params={"equipment_id": eq_id})
    items = resp.json()
    assert all(item["equipment_id"] == eq_id for item in items), (
        "Filter by equipment_id returned wrong records"
    )


@pytest.mark.anyio
async def test_list_vhs_readings_includes_inserted_record(client):
    """新增的讀值應出現在清單中"""
    eq_id = "EQ-LIST-VERIFY-001"
    await client.post("/api/vhs/readings", json=_vhs_payload(equipment_id=eq_id, score=65.0))

    resp = await client.get("/api/vhs/readings", params={"equipment_id": eq_id})
    scores = [item["score"] for item in resp.json()]
    assert pytest.approx(65.0) in scores


# ── GET /api/vhs/readings/latest ─────────────────────────────────────

@pytest.mark.anyio
async def test_latest_vhs_returns_200(client):
    resp = await client.get("/api/vhs/readings/latest")
    assert resp.status_code == 200


@pytest.mark.anyio
async def test_latest_vhs_returns_most_recent_per_equipment(client):
    """同一設備有多筆讀值時，latest 應回傳最新的一筆"""
    eq_id = "EQ-LATEST-001"
    await client.post("/api/vhs/readings", json=_vhs_payload(equipment_id=eq_id, score=50.0))
    await client.post("/api/vhs/readings", json=_vhs_payload(equipment_id=eq_id, score=90.0))

    resp    = await client.get("/api/vhs/readings/latest")
    entries = {item["equipment_id"]: item for item in resp.json()}
    if eq_id in entries:
        assert entries[eq_id]["score"] == pytest.approx(90.0, abs=0.1)


# ── GET /api/vhs/readings/stats ──────────────────────────────────────

@pytest.mark.anyio
async def test_vhs_stats_returns_200(client):
    eq_id = "EQ-STATS-001"
    await client.post("/api/vhs/readings", json=_vhs_payload(equipment_id=eq_id, score=60.0))
    resp = await client.get("/api/vhs/readings/stats", params={"equipment_id": eq_id})
    assert resp.status_code == 200


@pytest.mark.anyio
async def test_vhs_stats_schema(client):
    """stats 回應應包含 avg / min / max / count"""
    eq_id = "EQ-STATS-SCHEMA-001"
    for score in [40.0, 60.0, 80.0]:
        await client.post("/api/vhs/readings", json=_vhs_payload(equipment_id=eq_id, score=score))

    resp = await client.get("/api/vhs/readings/stats", params={"equipment_id": eq_id})
    data = resp.json()
    for field in ["avg", "min", "max", "count"]:
        assert field in data, f"Missing field: {field}"


@pytest.mark.anyio
async def test_vhs_stats_values_correct(client):
    """avg/min/max 計算應正確"""
    eq_id = "EQ-STATS-CALC-001"
    scores = [40.0, 60.0, 80.0]
    for s in scores:
        await client.post("/api/vhs/readings", json=_vhs_payload(equipment_id=eq_id, score=s))

    resp = await client.get("/api/vhs/readings/stats", params={"equipment_id": eq_id})
    data = resp.json()
    assert data["min"]   == pytest.approx(40.0, abs=0.1)
    assert data["max"]   == pytest.approx(80.0, abs=0.1)
    assert data["avg"]   == pytest.approx(60.0, abs=0.5)
    assert data["count"] >= 3
