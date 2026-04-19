"""
main.py — xCloudVLMui Platform FastAPI 後端入口
啟動：uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator

from config import get_settings
from database import init_db
from database_syslog import init_syslog_db
from services.rag_service import chroma_is_healthy
from services.syslog_service import log_startup, log_shutdown, syslog_cleanup_task
from routers import (
    auth, dashboard, reports, vlm,
    settings as settings_router,
    mqtt    as mqtt_router,
    syslog  as syslog_router,
    # ── v1.1.0 新路由（SRP 拆分後）──────────────────────────────
    equipment as equipment_router,
    vhs       as vhs_router,
    alerts    as alerts_router,
    pipeline  as pipeline_router,
    knowledge    as knowledge_router,
    chat         as chat_router,
    feature_flags as feature_flags_router,
    rag,           # backward-compat shim（/api/rag/*）
    vision as vision_router,
    models as models_router,
)
from middleware.syslog_middleware import SyslogMiddleware
from models.schemas import HealthResponse

# ── 日誌 ──────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger   = logging.getLogger(__name__)
settings = get_settings()


# ── 生命週期 ──────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=== xCloudVLMui Platform starting up ===")
    await init_db()
    logger.info("SQLite DB initialised.")
    await init_syslog_db()
    logger.info("Syslog DB initialised (syslog.db).")
    await log_startup()

    # ── 啟動時從 DB 載入使用者設定，套用到 live config ───────────────
    try:
        from sqlalchemy.ext.asyncio import AsyncSession as _AS
        from database import engine as _async_engine
        from models.db_models import SystemSettings as _SS
        from routers.settings import apply_settings_to_live_config
        async with _AS(_async_engine) as _db:
            _rows = await _db.execute(__import__("sqlalchemy").select(_SS))
            _db_settings = {r.key: r.value for r in _rows.scalars().all() if r.value}
        if _db_settings:
            apply_settings_to_live_config(_db_settings)
            logger.info("DB settings loaded and applied: %s", list(_db_settings.keys()))
    except Exception as _e:
        logger.warning("Could not load DB settings on startup: %s", _e)

    # ── 啟動時植入預設 YOLO 模型種子資料 ──────────────────────────────
    try:
        from sqlalchemy.ext.asyncio import AsyncSession as _AS2
        from database import engine as _async_engine2
        from routers.models import seed_default_models
        async with _AS2(_async_engine2) as _mdb:
            await seed_default_models(_mdb)
    except Exception as _me:
        logger.warning("Could not seed default models: %s", _me)

    logger.info("ChromaDB ready: %s", settings.chroma_persist_dir)
    logger.info("LLM endpoint: %s", settings.llm_base_url)
    logger.info("Embed model:  %s", settings.embed_model)
    logger.info("VLM WebUI:    %s", settings.vlm_webui_url)

    # ── 背景任務啟動 ─────────────────────────────────────────────────
    background_tasks: list[asyncio.Task] = []

    # MQTT listener
    if settings.mqtt_enabled:
        from services.mqtt_service import mqtt_listener
        t = asyncio.create_task(mqtt_listener(), name="mqtt-listener")
        background_tasks.append(t)
        logger.info("MQTT listener task started → %s:%d",
                    settings.mqtt_broker_host, settings.mqtt_broker_port)

    # Syslog 90 天自動清理（每 24 小時執行一次）
    t = asyncio.create_task(
        syslog_cleanup_task(retention_days=90, interval_hours=24),
        name="syslog-cleanup",
    )
    background_tasks.append(t)
    logger.info("Syslog cleanup task started (retention=90d, interval=24h).")

    yield

    # ── 背景任務關閉 ─────────────────────────────────────────────────
    for task in background_tasks:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    logger.info("All background tasks stopped.")

    await log_shutdown()
    logger.info("=== xCloudVLMui Platform shutting down ===")


# ── App 建立 ──────────────────────────────────────────────────────────
app = FastAPI(
    title=       settings.app_name,
    version=     "1.1.0",
    description= "xCloudVLMui Platform — 由 云碩科技 xCloudinfo Corp.Limited 開發，專為 Advantech AIR-030 (Jetson AGX Orin 64GB) 邊緣主機設計的工廠設備健康管理平台",
    lifespan=    lifespan,
    docs_url=    "/docs",
    redoc_url=   "/redoc",
)

# ── Prometheus Metrics 插樁（3.3 監控與可觀測性）─────────────────────
# 自動收集 HTTP 請求指標：http_requests_total, http_request_duration_seconds 等
# 端點：GET /metrics（由 Nginx proxy_pass 至 Port 80/metrics）
Instrumentator(
    should_group_status_codes=True,      # 2xx/3xx/4xx/5xx 分組
    should_ignore_untemplated=True,      # 忽略未匹配路由（404 雜訊）
    should_respect_env_var=True,         # ENABLE_METRICS=false 可關閉
    should_instrument_requests_inprogress=True,
    excluded_handlers=[
        "/metrics",    # 避免 scrape 自身產生遞迴指標
        "/api/health", # health check 頻繁呼叫排除
        "/docs",
        "/redoc",
        "/openapi.json",
    ],
    inprogress_name="http_requests_inprogress",
    inprogress_labels=True,
).instrument(app).expose(
    app,
    endpoint="/metrics",
    include_in_schema=False,    # 不顯示於 Swagger UI
    tags=["observability"],
)

# ── CORS ──────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=     settings.allowed_origins,
    allow_credentials= True,
    allow_methods=     ["*"],
    allow_headers=     ["*"],
)

# ── Syslog 自動記錄中介層（CORS 之後，確保正確取得 IP）──────────────
app.add_middleware(SyslogMiddleware)

# ── 全域例外處理 ──────────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url)
    return JSONResponse(
        status_code=500,
        content={"detail": f"伺服器內部錯誤：{type(exc).__name__}"},
    )

# ── Router 掛載 ───────────────────────────────────────────────────────
# v1.1.0 新路由（SRP 拆分，各自單一職責）
app.include_router(equipment_router.router)   # /api/equipment
app.include_router(vhs_router.router)         # /api/vhs
app.include_router(alerts_router.router)      # /api/alerts
app.include_router(pipeline_router.router)    # /api/pipeline
app.include_router(knowledge_router.router)       # /api/knowledge
app.include_router(chat_router.router)            # /api/chat
app.include_router(feature_flags_router.router)   # /api/settings/feature-flags
# 舊路由（向後相容墊片，v1.3.0 移除）
app.include_router(dashboard.router)          # /api/dashboard/* → deprecated
app.include_router(rag.router)                # /api/rag/*       → deprecated
# 其他功能路由
app.include_router(auth.router)
app.include_router(reports.router)
app.include_router(vlm.router)
app.include_router(settings_router.router)
app.include_router(mqtt_router.router)
app.include_router(syslog_router.router)
app.include_router(vision_router.router)   # /api/vision
app.include_router(models_router.router)   # /api/models

# ── Health Check ──────────────────────────────────────────────────────
@app.get("/api/health", response_model=HealthResponse, tags=["system"])
async def health_check():
    """
    三合一健康檢查：
      db_ok     — 對 SQLite 執行 SELECT 1
      llm_ok    — HTTP GET llama.cpp /health
      mqtt_ok   — TCP 連線至 Mosquitto Broker
      chroma_ok — ChromaDB 可用性（同步查詢）
    整體 status：全部 ok → "ok"；任一失敗 → "degraded"
    """

    # ── [1] DB 檢查：實際執行 SELECT 1 ──────────────────────────────
    db_ok = False
    try:
        import aiosqlite
        # 從 URL 萃取檔案路徑（sqlite+aiosqlite:////data/xcloudvlm.db → /data/xcloudvlm.db）
        db_path = settings.database_url.split("///")[-1]
        async with aiosqlite.connect(db_path) as conn:
            await conn.execute("SELECT 1")
        db_ok = True
    except Exception as _e:
        logger.warning("Health check — DB error: %s", _e)

    # ── [2] LLM 檢查：依序嘗試 /health（llama.cpp）、/（Ollama）、/v1/models ──
    llm_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as c:
            for path in ("/health", "/", "/v1/models"):
                try:
                    r = await c.get(f"{settings.llm_base_url}{path}")
                    if r.status_code == 200:
                        llm_ok = True
                        break
                except Exception:
                    continue
    except Exception as _e:
        logger.warning("Health check — LLM error: %s", _e)

    # ── [3] MQTT 檢查：TCP 連線至 Broker ────────────────────────────
    mqtt_ok = False
    if not settings.mqtt_enabled:
        mqtt_ok = True   # MQTT 未啟用時視為健康（不強制依賴）
    else:
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(
                    settings.mqtt_broker_host,
                    settings.mqtt_broker_port,
                ),
                timeout=2.0,
            )
            writer.close()
            await writer.wait_closed()
            mqtt_ok = True
        except Exception as _e:
            logger.warning("Health check — MQTT error: %s", _e)

    # ── [4] ChromaDB 檢查 ────────────────────────────────────────────
    chroma_ok = chroma_is_healthy()

    # ── 整體狀態 ─────────────────────────────────────────────────────
    overall_status = "ok" if all([db_ok, llm_ok, mqtt_ok, chroma_ok]) else "degraded"

    return HealthResponse(
        status=     overall_status,
        version=    "1.1.0",
        llm_ok=     llm_ok,
        chroma_ok=  chroma_ok,
        db_ok=      db_ok,
        mqtt_ok=    mqtt_ok,
        timestamp=  datetime.now(timezone.utc),
    )


@app.get("/", include_in_schema=False)
async def root():
    return {"service": "xCloudVLMui Platform", "version": "1.1.0", "docs": "/docs"}
