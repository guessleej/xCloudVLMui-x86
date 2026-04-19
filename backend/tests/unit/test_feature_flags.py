"""
tests/unit/test_feature_flags.py — Feature Flags API 單元測試
=============================================================
測試對象：
  GET    /api/settings/feature-flags         — 清單（含自動植入預設值）
  GET    /api/settings/feature-flags/{key}   — 單一旗標查詢
  PUT    /api/settings/feature-flags/{key}   — 更新 / 建立（upsert）
  POST   /api/settings/feature-flags/{key}/toggle — 切換 enabled 狀態

驗證要點：
  - 預設 6 個 flag 自動植入（ff.line_notify, ff.auto_report …）
  - enabled_map 鍵值正確
  - toggle 正確切換 True ↔ False
  - 不存在的 key → GET/toggle 回傳 404，PUT 動態建立
"""
from __future__ import annotations

import pytest


# ── 預設旗標清單（與 routers/feature_flags.py _DEFAULT_FLAGS 一致）───────
_DEFAULT_KEYS = {
    "ff.line_notify",
    "ff.auto_report",
    "ff.vlm_ocr",
    "ff.mqtt_alert",
    "ff.rag_rerank",
    "ff.dark_mode",
}

_DEFAULT_ENABLED = {
    "ff.line_notify":  False,
    "ff.auto_report":  True,
    "ff.vlm_ocr":      True,
    "ff.mqtt_alert":   True,
    "ff.rag_rerank":   False,
    "ff.dark_mode":    True,
}


# ── GET /api/settings/feature-flags ─────────────────────────────────

@pytest.mark.anyio
async def test_list_feature_flags_returns_200(client):
    resp = await client.get("/api/settings/feature-flags")
    assert resp.status_code == 200


@pytest.mark.anyio
async def test_list_feature_flags_seeds_defaults(client):
    """首次呼叫應自動植入 6 個預設旗標"""
    resp = await client.get("/api/settings/feature-flags")
    data = resp.json()
    assert "flags" in data
    assert "enabled_map" in data
    keys = {f["key"] for f in data["flags"]}
    assert _DEFAULT_KEYS.issubset(keys), f"Missing default flags: {_DEFAULT_KEYS - keys}"


@pytest.mark.anyio
async def test_list_feature_flags_enabled_map_matches_flags(client):
    """enabled_map 的值應與 flags 列表一致"""
    resp       = await client.get("/api/settings/feature-flags")
    data       = resp.json()
    flags_map  = {f["key"]: f["enabled"] for f in data["flags"]}
    assert data["enabled_map"] == flags_map


@pytest.mark.anyio
async def test_list_feature_flags_default_enabled_values(client):
    """驗證各預設旗標的初始 enabled 值"""
    resp    = await client.get("/api/settings/feature-flags")
    em      = resp.json()["enabled_map"]
    for key, expected in _DEFAULT_ENABLED.items():
        assert em.get(key) == expected, (
            f"ff key={key}: expected enabled={expected}, got {em.get(key)}"
        )


@pytest.mark.anyio
async def test_list_feature_flags_idempotent(client):
    """多次呼叫不重複植入（幂等性）"""
    resp1 = await client.get("/api/settings/feature-flags")
    resp2 = await client.get("/api/settings/feature-flags")
    count1 = len(resp1.json()["flags"])
    count2 = len(resp2.json()["flags"])
    assert count1 == count2, "Seeding should be idempotent"


# ── GET /api/settings/feature-flags/{key} ───────────────────────────

@pytest.mark.anyio
async def test_get_single_flag_returns_200(client):
    await client.get("/api/settings/feature-flags")   # seed
    resp = await client.get("/api/settings/feature-flags/ff.mqtt_alert")
    assert resp.status_code == 200
    assert resp.json()["key"] == "ff.mqtt_alert"


@pytest.mark.anyio
async def test_get_single_flag_schema(client):
    """回應應包含必填欄位"""
    await client.get("/api/settings/feature-flags")   # seed
    resp = await client.get("/api/settings/feature-flags/ff.auto_report")
    data = resp.json()
    for field in ["id", "key", "enabled", "rollout_pct", "updated_at", "created_at"]:
        assert field in data, f"Missing field: {field}"


@pytest.mark.anyio
async def test_get_nonexistent_flag_returns_404(client):
    resp = await client.get("/api/settings/feature-flags/ff.nonexistent")
    assert resp.status_code == 404


# ── PUT /api/settings/feature-flags/{key} ───────────────────────────

@pytest.mark.anyio
async def test_update_flag_enabled(client):
    """更新 ff.line_notify 的 enabled 為 True"""
    await client.get("/api/settings/feature-flags")   # seed
    resp = await client.put(
        "/api/settings/feature-flags/ff.line_notify",
        json={"enabled": True},
    )
    assert resp.status_code == 200
    assert resp.json()["enabled"] is True


@pytest.mark.anyio
async def test_update_flag_rollout_pct(client):
    """更新 rollout_pct 應持久化"""
    await client.get("/api/settings/feature-flags")   # seed
    resp = await client.put(
        "/api/settings/feature-flags/ff.rag_rerank",
        json={"rollout_pct": 10},
    )
    assert resp.status_code == 200
    assert resp.json()["rollout_pct"] == 10


@pytest.mark.anyio
async def test_upsert_creates_new_custom_flag(client):
    """PUT 不存在的 key → 動態建立（upsert）"""
    resp = await client.put(
        "/api/settings/feature-flags/ff.custom_test",
        json={"enabled": True, "description": "Custom test flag"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["key"]     == "ff.custom_test"
    assert data["enabled"] is True


@pytest.mark.anyio
async def test_update_flag_partial_only_updates_given_fields(client):
    """PUT 傳入部分欄位，只更新指定欄位，不清除其他欄位"""
    await client.get("/api/settings/feature-flags")   # seed

    # 先確認 ff.dark_mode 目前 enabled=True
    r1 = await client.get("/api/settings/feature-flags/ff.dark_mode")
    original_rollout = r1.json()["rollout_pct"]

    # 只更新 description，rollout_pct 應維持不變
    await client.put(
        "/api/settings/feature-flags/ff.dark_mode",
        json={"description": "Updated description"},
    )
    r2 = await client.get("/api/settings/feature-flags/ff.dark_mode")
    assert r2.json()["rollout_pct"] == original_rollout


# ── POST /api/settings/feature-flags/{key}/toggle ───────────────────

@pytest.mark.anyio
async def test_toggle_flag_flips_enabled(client):
    """Toggle 應將 enabled 從 False 切換為 True"""
    await client.get("/api/settings/feature-flags")   # seed
    # ff.line_notify 預設 False
    resp = await client.post("/api/settings/feature-flags/ff.line_notify/toggle")
    assert resp.status_code == 200
    assert resp.json()["enabled"] is True


@pytest.mark.anyio
async def test_toggle_flag_twice_restores_original(client):
    """連續 Toggle 兩次應恢復原始值"""
    await client.get("/api/settings/feature-flags")   # seed
    original = _DEFAULT_ENABLED["ff.mqtt_alert"]

    await client.post("/api/settings/feature-flags/ff.mqtt_alert/toggle")
    resp = await client.post("/api/settings/feature-flags/ff.mqtt_alert/toggle")
    assert resp.json()["enabled"] == original


@pytest.mark.anyio
async def test_toggle_nonexistent_flag_returns_404(client):
    resp = await client.post("/api/settings/feature-flags/ff.nonexistent/toggle")
    assert resp.status_code == 404
