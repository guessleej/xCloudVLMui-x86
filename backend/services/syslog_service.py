"""
syslog_service.py — 系統事件日誌寫入服務
提供同步包裝與非同步直接寫入兩種介面，供全站任何模組呼叫
"""
from __future__ import annotations
import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from database_syslog import SyslogSessionLocal
from models.syslog_models import SysLog

logger = logging.getLogger(__name__)


# ── 非同步核心寫入 ────────────────────────────────────────────────────
async def write_log(
    level:       str,
    module:      str,
    action:      str,
    message:     str,
    detail:      Optional[dict | str] = None,
    ip_address:  Optional[str] = None,
    status_code: Optional[int] = None,
    duration_ms: Optional[float] = None,
    user_id:     Optional[str] = None,
    request_id:  Optional[str] = None,
) -> None:
    """非同步寫入一筆 syslog，任何例外不傳播（不影響主業務流程）

    Args:
        level:       日誌等級（INFO / WARNING / ERROR / CRITICAL）
        module:      功能模組名稱（mqtt / rag / vlm / system …）
        action:      操作識別碼（post.knowledge.upload / patch.alerts.resolve …）
        message:     人類可讀描述
        detail:      額外 JSON context（選填）
        ip_address:  客戶端 IP（選填）
        status_code: HTTP 狀態碼（選填）
        duration_ms: 請求耗時毫秒（選填）
        user_id:     操作者 user ID（選填）
        request_id:  X-Request-ID 關聯追蹤 UUID（選填）
    """
    try:
        detail_str: Optional[str] = None
        if detail is not None:
            detail_str = json.dumps(detail, ensure_ascii=False) if isinstance(detail, dict) else str(detail)

        async with SyslogSessionLocal() as session:
            log = SysLog(
                timestamp=   datetime.now(timezone.utc),
                level=       level.upper(),
                module=      module.lower(),
                action=      action,
                message=     message,
                detail=      detail_str,
                ip_address=  ip_address,
                status_code= status_code,
                duration_ms= round(duration_ms, 2) if duration_ms is not None else None,
                user_id=     user_id,
                request_id=  request_id,
            )
            session.add(log)
            await session.commit()
    except Exception as exc:
        # syslog 寫入失敗不影響主流程，僅印出 stderr
        logger.warning("SysLog write failed: %s", exc)


# ── 快速包裝函式（在已有 event loop 的環境使用）────────────────────────
def _fire(coro) -> None:
    """在現有 event loop 中 fire-and-forget 一個 coroutine"""
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        # 沒有 running loop（測試環境等）→ 同步執行
        asyncio.run(coro)


def log_info(module: str, action: str, message: str, **kwargs: Any) -> None:
    _fire(write_log("INFO", module, action, message, **kwargs))


def log_warning(module: str, action: str, message: str, **kwargs: Any) -> None:
    _fire(write_log("WARNING", module, action, message, **kwargs))


def log_error(module: str, action: str, message: str, **kwargs: Any) -> None:
    _fire(write_log("ERROR", module, action, message, **kwargs))


def log_critical(module: str, action: str, message: str, **kwargs: Any) -> None:
    _fire(write_log("CRITICAL", module, action, message, **kwargs))


# ── 系統啟動 / 關閉事件 ──────────────────────────────────────────────
async def log_startup(version: str = "1.1.0") -> None:
    await write_log("INFO", "system", "startup", f"xCloudVLMui Platform v{version} 已啟動")


async def log_shutdown() -> None:
    await write_log("INFO", "system", "shutdown", "xCloudVLMui Platform 正在關閉")


# ── Syslog 自動清理 ───────────────────────────────────────────────────

async def purge_old_syslogs(retention_days: int = 90) -> int:
    """
    刪除超過 retention_days 天的 syslog 記錄。
    回傳刪除筆數。此函式不拋出例外（清理失敗不影響系統運作）。

    Args:
        retention_days: 保留天數，預設 90 天
    Returns:
        int: 實際刪除的記錄筆數
    """
    from datetime import timedelta
    from sqlalchemy import delete as sa_delete, text

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    deleted = 0
    try:
        async with SyslogSessionLocal() as session:
            # 分批刪除避免單次大量 DELETE 鎖表（每批 500 筆）
            while True:
                # 先查找要刪除的 ID（避免長事務）
                result = await session.execute(
                    text(
                        "SELECT id FROM syslogs WHERE timestamp < :cutoff LIMIT 500"
                    ),
                    {"cutoff": cutoff.strftime("%Y-%m-%d %H:%M:%S")},
                )
                ids = [row[0] for row in result.fetchall()]
                if not ids:
                    break
                await session.execute(
                    text("DELETE FROM syslogs WHERE id IN (:ids)".replace(
                        ":ids", ",".join(str(i) for i in ids)
                    ))
                )
                await session.commit()
                deleted += len(ids)
                if len(ids) < 500:
                    break

        logger.info(
            "Syslog purge complete: deleted=%d retention_days=%d cutoff=%s",
            deleted, retention_days, cutoff.isoformat()[:10],
        )
        if deleted > 0:
            await write_log(
                "INFO", "system", "syslog.purge",
                f"自動清理 syslog：刪除 {deleted} 筆超過 {retention_days} 天的記錄",
                detail={"deleted": deleted, "cutoff": cutoff.isoformat()},
            )
    except Exception as exc:
        logger.warning("Syslog purge failed: %s", exc)

    return deleted


async def syslog_cleanup_task(
    retention_days: int = 90,
    interval_hours: int = 24,
) -> None:
    """
    永久循環的背景清理任務。
    在 main.py lifespan 中以 asyncio.create_task() 啟動。

    - 啟動後等待 interval_hours 小時才執行第一次清理
      （避免系統剛啟動時即觸發）
    - 之後每隔 interval_hours 小時執行一次
    - asyncio.CancelledError 正常退出（lifespan 關閉時取消）

    Args:
        retention_days: 保留天數，預設 90
        interval_hours: 清理間隔小時數，預設 24（每天一次）
    """
    logger.info(
        "Syslog cleanup task started: retention=%d days, interval=%d hours",
        retention_days, interval_hours,
    )
    try:
        while True:
            await asyncio.sleep(interval_hours * 3600)
            await purge_old_syslogs(retention_days=retention_days)
    except asyncio.CancelledError:
        logger.info("Syslog cleanup task cancelled (normal shutdown).")
        raise
