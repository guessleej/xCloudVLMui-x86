"""
syslog_middleware.py — FastAPI 請求日誌中介層
自動攔截所有 HTTP 請求，寫入事件中心資料庫。
同時注入 X-Request-ID 關聯追蹤標頭，支援跨服務日誌追蹤。
"""
from __future__ import annotations
import asyncio
import time
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from services.syslog_service import write_log

# 不記錄這些路徑（避免 syslog 自身遞迴、靜態資源噪音）
_SKIP_PREFIXES = (
    "/api/syslog",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
    "/_next",
    "/static",
    "/metrics",     # Prometheus scrape 端點不記錄，避免噪音
)

# 只記錄寫入操作 + 錯誤，GET 請求過多不記（除非 4xx/5xx）
_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _path_to_module(path: str) -> str:
    """從 URL 路徑推斷模組名稱"""
    p = path.lower()
    if "/mqtt"      in p: return "mqtt"
    if "/rag"       in p: return "rag"
    if "/reports"   in p: return "report"
    if "/settings"  in p: return "settings"
    if "/auth"      in p or "/users" in p: return "auth"
    if "/vlm"       in p: return "vlm"
    if "/dashboard" in p: return "dashboard"
    if "/knowledge" in p: return "knowledge"
    if "/chat"      in p: return "chat"
    if "/equipment" in p: return "equipment"
    if "/alerts"    in p: return "alerts"
    if "/vhs"       in p: return "vhs"
    if "/pipeline"  in p: return "pipeline"
    if "/health"    in p: return "system"
    return "system"


def _path_to_action(method: str, path: str) -> str:
    """從 method + path 生成 action 識別碼"""
    parts = [p for p in path.split("/") if p and p != "api"]
    # 移除數字 ID 段落，只保留語意段落
    semantic = [p for p in parts if not p.lstrip("-").isdigit()]
    key = ".".join(semantic[-2:]) if len(semantic) >= 2 else ".".join(semantic)
    return f"{method.lower()}.{key}" if key else method.lower()


def _generate_request_id() -> str:
    """生成 UUID v4 格式的 Request ID"""
    return str(uuid.uuid4())


class SyslogMiddleware(BaseHTTPMiddleware):
    """
    HTTP 請求自動日誌中介層 + Correlation ID 注入
    ─────────────────────────────────────────────
    功能：
      1. X-Request-ID 傳播：
         - 若請求攜帶 X-Request-ID header → 沿用（上游系統傳入）
         - 若無 → 自動生成 UUID v4
         - 注入至 request.state.request_id（供 Handler / Service 使用）
         - 注入至 Response Header: X-Request-ID（回傳給客戶端）

      2. 自動審計日誌：
         - 寫入操作（POST/PUT/PATCH/DELETE）：全部記錄至 syslog.db
         - 讀取操作（GET）：只記錄 4xx / 5xx 錯誤

      3. fire-and-forget：
         - 日誌寫入使用 asyncio.create_task，不阻塞 HTTP 回應
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        # 跳過不需記錄的路徑
        path = request.url.path
        if any(path.startswith(p) for p in _SKIP_PREFIXES):
            return await call_next(request)

        # ── [1] Correlation ID 處理 ──────────────────────────────────
        # 優先使用上游傳入的 X-Request-ID；否則生成新的
        request_id: str = (
            request.headers.get("X-Request-ID")
            or request.headers.get("x-request-id")
            or _generate_request_id()
        )

        # 注入至 request.state，供 router / service 層使用
        request.state.request_id = request_id

        # ── [2] 執行請求並計時 ───────────────────────────────────────
        start    = time.monotonic()
        response = await call_next(request)
        duration = (time.monotonic() - start) * 1000  # ms

        # ── [3] 注入 X-Request-ID 至回應標頭 ────────────────────────
        response.headers["X-Request-ID"] = request_id

        # ── [4] 決定是否寫入審計日誌 ────────────────────────────────
        method      = request.method
        status_code = response.status_code
        should_log  = (method in _WRITE_METHODS) or (status_code >= 400)

        if should_log:
            # 決定 log level
            if status_code >= 500:
                level = "ERROR"
            elif status_code >= 400:
                level = "WARNING"
            else:
                level = "INFO"

            module  = _path_to_module(path)
            action  = _path_to_action(method, path)
            message = f"{method} {path} → {status_code} [{request_id[:8]}]"
            ip      = (request.client.host if request.client else None)

            # fire-and-forget，不 await 以免阻塞回應
            asyncio.create_task(write_log(
                level=       level,
                module=      module,
                action=      action,
                message=     message,
                ip_address=  ip,
                status_code= status_code,
                duration_ms= duration,
                request_id=  request_id,
            ))

        return response
