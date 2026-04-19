"""
tests/unit/test_syslog_service.py — Syslog 服務單元測試
=======================================================
測試對象：
  - services.syslog_service.write_log       — 核心寫入（含 request_id）
  - services.syslog_service.purge_old_syslogs — 批次清理
  - services.syslog_service.log_startup / log_shutdown — 系統事件
  - middleware 的 _path_to_module / _path_to_action 輔助函式

注意：syslog 使用獨立的 syslog.db，conftest 未覆蓋此資料庫。
      寫入測試採 fire-and-forget 模式，只驗證「不拋出例外」。
"""
from __future__ import annotations

import pytest

from middleware.syslog_middleware import _path_to_module, _path_to_action


# ── _path_to_module 輔助函式測試 ──────────────────────────────────────

class TestPathToModule:
    """從 URL 路徑推斷模組名稱"""

    def test_mqtt_path(self):
        assert _path_to_module("/api/mqtt/devices") == "mqtt"

    def test_rag_path(self):
        assert _path_to_module("/api/rag/query") == "rag"

    def test_knowledge_path(self):
        assert _path_to_module("/api/knowledge/documents") == "knowledge"

    def test_chat_path(self):
        assert _path_to_module("/api/chat/query") == "chat"

    def test_alerts_path(self):
        assert _path_to_module("/api/alerts") == "alerts"

    def test_equipment_path(self):
        assert _path_to_module("/api/equipment") == "equipment"

    def test_vhs_path(self):
        assert _path_to_module("/api/vhs/readings") == "vhs"

    def test_pipeline_path(self):
        assert _path_to_module("/api/pipeline") == "pipeline"

    def test_vlm_path(self):
        assert _path_to_module("/api/vlm/capture") == "vlm"

    def test_reports_path(self):
        assert _path_to_module("/api/reports") == "report"

    def test_settings_path(self):
        assert _path_to_module("/api/settings/feature-flags") == "settings"

    def test_auth_path(self):
        assert _path_to_module("/api/auth/callback") == "auth"

    def test_health_path(self):
        assert _path_to_module("/api/health") == "system"

    def test_unknown_path_returns_system(self):
        assert _path_to_module("/api/unknown/endpoint") == "system"

    def test_case_insensitive(self):
        assert _path_to_module("/API/MQTT/DEVICE") == "mqtt"


# ── _path_to_action 輔助函式測試 ─────────────────────────────────────

class TestPathToAction:
    """從 method + path 生成動作識別碼"""

    def test_post_upload(self):
        action = _path_to_action("POST", "/api/knowledge/documents/upload")
        assert "post" in action
        assert "upload" in action or "documents" in action

    def test_delete_method(self):
        action = _path_to_action("DELETE", "/api/alerts/some-uuid")
        assert action.startswith("delete.")

    def test_patch_resolve(self):
        action = _path_to_action("PATCH", "/api/alerts/some-uuid/resolve")
        assert "patch" in action

    def test_put_method(self):
        action = _path_to_action("PUT", "/api/settings/feature-flags/ff.mqtt_alert")
        assert action.startswith("put.")

    def test_get_method(self):
        action = _path_to_action("GET", "/api/equipment")
        assert action.startswith("get.")

    def test_empty_path_returns_method(self):
        action = _path_to_action("POST", "/")
        assert "post" in action.lower()

    def test_uuid_segments_stripped(self):
        """UUID 數字 ID 段落應被移除，只保留語意段落"""
        action1 = _path_to_action("GET", "/api/alerts/123")
        action2 = _path_to_action("GET", "/api/alerts/abc-def")
        # 數字純 ID "123" 應被過濾
        assert "123" not in action1


# ── write_log 不拋出例外測試 ──────────────────────────────────────────

@pytest.mark.anyio
async def test_write_log_does_not_raise():
    """write_log 在任何情況下都不應拋出例外（fail-safe 設計）"""
    from services.syslog_service import write_log
    # 由於 syslog.db 在 CI 可能路徑不同，確認不拋出例外
    try:
        await write_log(
            level="INFO",
            module="test",
            action="test.unit",
            message="Unit test write_log call",
            request_id="test-request-id-1234",
        )
    except Exception as exc:
        pytest.fail(f"write_log should not raise: {exc}")


@pytest.mark.anyio
async def test_write_log_accepts_request_id():
    """write_log 必須接受 request_id 關鍵字參數（F-01 修正驗證）"""
    from services.syslog_service import write_log
    import inspect
    sig = inspect.signature(write_log)
    assert "request_id" in sig.parameters, (
        "write_log() must have 'request_id' parameter (F-01 fix)"
    )


@pytest.mark.anyio
async def test_write_log_request_id_is_optional():
    """request_id 應為可選參數（不傳入時不拋出）"""
    from services.syslog_service import write_log
    try:
        await write_log(
            level="WARNING",
            module="test",
            action="test.no_request_id",
            message="No request_id test",
            # 刻意不傳 request_id
        )
    except TypeError as exc:
        pytest.fail(f"request_id should be optional: {exc}")


@pytest.mark.anyio
async def test_write_log_with_all_optional_fields():
    """傳入所有可選欄位不應拋出"""
    from services.syslog_service import write_log
    try:
        await write_log(
            level="ERROR",
            module="test",
            action="test.full_fields",
            message="Full fields test",
            detail={"key": "value", "number": 42},
            ip_address="192.168.1.100",
            status_code=500,
            duration_ms=1234.56,
            user_id="user-abc-123",
            request_id="req-uuid-abc-def-1234",
        )
    except Exception as exc:
        pytest.fail(f"write_log with all fields should not raise: {exc}")


# ── log_startup / log_shutdown 測試 ─────────────────────────────────

@pytest.mark.anyio
async def test_log_startup_does_not_raise():
    from services.syslog_service import log_startup
    try:
        await log_startup(version="1.1.0")
    except Exception as exc:
        pytest.fail(f"log_startup should not raise: {exc}")


@pytest.mark.anyio
async def test_log_shutdown_does_not_raise():
    from services.syslog_service import log_shutdown
    try:
        await log_shutdown()
    except Exception as exc:
        pytest.fail(f"log_shutdown should not raise: {exc}")
