"""
config.py — 後端環境設定（pydantic-settings）
"""
from functools import lru_cache
from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── 基礎 ────────────────────────────────────────────
    app_name:    str  = "xCloudVLMui Platform"
    debug:       bool = False
    secret_key:  str  = "change-me-in-production-32-chars!!"

    # ── 資料庫 ──────────────────────────────────────────
    database_url: str = "sqlite+aiosqlite:///./xcloudvlm.db"

    # ── ChromaDB ────────────────────────────────────────
    chroma_persist_dir: str  = "./chroma_data"
    chroma_collection:  str  = "maintenance_docs"
    embedding_top_k:    int  = 5

    # ── llama.cpp (Gemma 4 E4B) ──────────────────────────
    # Gemma 4 E4B 支援 128K context；Q4_K_M ~4GB VRAM
    llm_base_url:    str   = "http://localhost:8080"
    llm_model:       str   = "gemma-4-e4b-it"    # llama.cpp /v1/models 回傳的 model id
    llm_ctx_size:    int   = 131072               # 128K = 131072 tokens
    llm_max_tokens:  int   = 4096                 # 單次生成上限
    llm_temperature: float = 0.1
    embed_model:     str   = "gemma-4-e4b-it"

    # ── live-vlm-webui ───────────────────────────────────
    vlm_webui_url:  str = "http://localhost:8090"

    # ── CORS（Next.js dev/prod）──────────────────────────
    allowed_origins: list[str] = Field(
        default=["http://localhost:3000", "http://localhost:3001"]
    )

    # ── NextAuth JWT Secret（驗證 API 請求用）───────────
    nextauth_secret: str = "nextauth-secret-must-match-frontend"

    # ── MQTT Broker ──────────────────────────────────────────────────
    mqtt_broker_host:  str = "mosquitto"          # Docker service name / IP
    mqtt_broker_port:  int = 1883
    mqtt_username:     str = ""
    mqtt_password:     str = ""
    mqtt_topic_filter: str = "xcloud/#"           # 訂閱所有 xcloud/ 下的主題
    mqtt_enabled:      bool = True

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache
def get_settings() -> Settings:
    return Settings()
