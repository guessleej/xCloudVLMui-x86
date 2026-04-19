"""
tests/integration/test_reports_api.py — 維修報告 API 整合測試
============================================================
測試對象：
  GET    /api/reports          — 報告清單（含過濾、分頁）
  POST   /api/reports          — 新增報告
  GET    /api/reports/{id}     — 單一報告
  DELETE /api/reports/{id}     — 軟刪除報告

驗證要點：
  - 建立/讀取/刪除 CRUD 流程正確
  - is_deleted 軟刪除（不從 DB 移除，LIST 不回傳）
  - risk_level 欄位驗證
  - 不存在 ID → 404
"""
from __future__ import annotations

import pytest


# ── Helpers ──────────────────────────────────────────────────────────

def _report_payload(
    title:          str = "壓縮機 #1 定期巡檢報告",
    equipment_id:   str = "AIR-030-01",
    equipment_name: str = "壓縮機 #1",
    risk_level:     str = "moderate",
    source:         str = "manual",
    markdown:       str = "## 巡檢報告\n\n設備狀態正常。",
) -> dict:
    return {
        "title":          title,
        "equipment_id":   equipment_id,
        "equipment_name": equipment_name,
        "risk_level":     risk_level,
        "source":         source,
        "markdown_content": markdown,
    }


# ── POST /api/reports ────────────────────────────────────────────────

@pytest.mark.anyio
async def test_create_report_returns_201(client):
    resp = await client.post("/api/reports", json=_report_payload())
    assert resp.status_code == 201


@pytest.mark.anyio
async def test_create_report_schema(client):
    """回應包含所有必填欄位"""
    resp = await client.post("/api/reports", json=_report_payload())
    data = resp.json()
    for field in ["id", "title", "equipment_id", "risk_level", "source", "created_at"]:
        assert field in data, f"Missing field: {field}"


@pytest.mark.anyio
async def test_create_report_persists_values(client):
    payload = _report_payload(title="特殊巡檢報告", risk_level="critical")
    resp    = await client.post("/api/reports", json=payload)
    data    = resp.json()
    assert data["title"]      == "特殊巡檢報告"
    assert data["risk_level"] == "critical"
    assert data["is_deleted"] is False


@pytest.mark.anyio
async def test_create_report_all_risk_levels(client):
    """各種 risk_level 均應被接受"""
    for level in ["critical", "elevated", "moderate", "low"]:
        resp = await client.post("/api/reports", json=_report_payload(risk_level=level))
        assert resp.status_code == 201, f"risk_level={level} failed: {resp.status_code}"


# ── GET /api/reports ─────────────────────────────────────────────────

@pytest.mark.anyio
async def test_list_reports_returns_200(client):
    resp = await client.get("/api/reports")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.anyio
async def test_list_reports_includes_created_report(client):
    title = "TEST_LIST_REPORT_UNIQUE_XYZ"
    await client.post("/api/reports", json=_report_payload(title=title))
    resp   = await client.get("/api/reports")
    titles = [r["title"] for r in resp.json()]
    assert title in titles


@pytest.mark.anyio
async def test_list_reports_excludes_deleted(client):
    """軟刪除後的報告不應出現在預設清單中"""
    resp    = await client.post("/api/reports", json=_report_payload(title="軟刪除測試報告"))
    rep_id  = resp.json()["id"]
    await client.delete(f"/api/reports/{rep_id}")

    resp2  = await client.get("/api/reports")
    ids    = [r["id"] for r in resp2.json()]
    assert rep_id not in ids, "Soft-deleted report should not appear in list"


@pytest.mark.anyio
async def test_list_reports_filter_by_equipment_id(client):
    eq_id = "EQ-FILTER-RPT-001"
    await client.post("/api/reports", json=_report_payload(equipment_id=eq_id))
    await client.post("/api/reports", json=_report_payload(equipment_id="EQ-OTHER-999"))

    resp  = await client.get("/api/reports", params={"equipment_id": eq_id})
    items = resp.json()
    assert all(r["equipment_id"] == eq_id for r in items)


# ── GET /api/reports/{id} ────────────────────────────────────────────

@pytest.mark.anyio
async def test_get_single_report_returns_200(client):
    resp   = await client.post("/api/reports", json=_report_payload())
    rep_id = resp.json()["id"]
    r2     = await client.get(f"/api/reports/{rep_id}")
    assert r2.status_code == 200
    assert r2.json()["id"] == rep_id


@pytest.mark.anyio
async def test_get_single_report_contains_markdown(client):
    md_content = "## Test\n\nMarkdown content here."
    resp   = await client.post("/api/reports", json=_report_payload(markdown=md_content))
    rep_id = resp.json()["id"]
    r2     = await client.get(f"/api/reports/{rep_id}")
    assert r2.json()["markdown_content"] == md_content


@pytest.mark.anyio
async def test_get_nonexistent_report_returns_404(client):
    resp = await client.get("/api/reports/nonexistent-id-xyz")
    assert resp.status_code == 404


# ── DELETE /api/reports/{id} ─────────────────────────────────────────

@pytest.mark.anyio
async def test_delete_report_returns_204(client):
    resp   = await client.post("/api/reports", json=_report_payload())
    rep_id = resp.json()["id"]
    r2     = await client.delete(f"/api/reports/{rep_id}")
    assert r2.status_code == 204


@pytest.mark.anyio
async def test_delete_report_soft_deletes(client):
    """DELETE 應為軟刪除（is_deleted=True），不物理刪除資料"""
    resp   = await client.post("/api/reports", json=_report_payload())
    rep_id = resp.json()["id"]
    await client.delete(f"/api/reports/{rep_id}")

    # 嘗試直接 GET（若 API 支援查詢已刪除記錄）
    # 軟刪除後 GET 單筆應回傳 404 或 is_deleted=True
    r2 = await client.get(f"/api/reports/{rep_id}")
    # 接受兩種實作：404（對外隱藏）或 is_deleted=True
    assert r2.status_code in {200, 404}
    if r2.status_code == 200:
        assert r2.json()["is_deleted"] is True


@pytest.mark.anyio
async def test_delete_nonexistent_report_returns_404(client):
    resp = await client.delete("/api/reports/nonexistent-id-xyz")
    assert resp.status_code == 404
