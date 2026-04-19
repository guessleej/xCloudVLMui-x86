"""
adapters/llama_cpp_adapter.py — llama.cpp REST API 適配器
==========================================================
封裝對 llama.cpp OpenAI-compatible API 的所有 HTTP 呼叫。
實作 ILLMAdapter Protocol。

設定（來自 config.Settings）：
  llm_base_url   — llama.cpp 服務根 URL（預設 http://llama-cpp:8080）
  llm_max_tokens — 預設最大生成 token 數
  llm_timeout    — HTTP 請求逾時秒數
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from config import get_settings

logger   = logging.getLogger(__name__)
_settings = get_settings()


class LlamaCppAdapter:
    """
    llama.cpp OpenAI-compatible API 適配器。

    使用方式：
        adapter = LlamaCppAdapter()
        response = await adapter.chat([{"role": "user", "content": "你好"}])
    """

    def __init__(
        self,
        base_url:   str   = "",
        timeout:    float = 30.0,
        max_tokens: int   = 512,
    ) -> None:
        self._base_url   = base_url   or _settings.llm_base_url
        self._timeout    = timeout
        self._max_tokens = max_tokens

    # ── ILLMAdapter Protocol 實作 ─────────────────────────────────────

    async def complete(
        self,
        prompt:      str,
        max_tokens:  int   = 0,
        temperature: float = 0.1,
        **kwargs:    Any,
    ) -> str:
        """
        /v1/completions — 文字補全（非對話式）
        """
        max_tokens = max_tokens or self._max_tokens
        payload = {
            "prompt":      prompt,
            "max_tokens":  max_tokens,
            "temperature": temperature,
            **kwargs,
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as c:
                r = await c.post(f"{self._base_url}/v1/completions", json=payload)
                r.raise_for_status()
                data = r.json()
                return data["choices"][0]["text"]
        except httpx.HTTPStatusError as e:
            logger.error("LlamaCpp complete HTTP error: %s", e.response.text)
            raise
        except Exception as e:
            logger.error("LlamaCpp complete error: %s", e)
            raise

    async def chat(
        self,
        messages:    list[dict[str, str]],
        max_tokens:  int   = 0,
        temperature: float = 0.1,
        **kwargs:    Any,
    ) -> str:
        """
        /v1/chat/completions — 對話式文字生成（OpenAI chat format）
        """
        max_tokens = max_tokens or self._max_tokens
        payload = {
            "messages":    messages,
            "max_tokens":  max_tokens,
            "temperature": temperature,
            **kwargs,
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as c:
                r = await c.post(f"{self._base_url}/v1/chat/completions", json=payload)
                r.raise_for_status()
                data = r.json()
                return data["choices"][0]["message"]["content"]
        except httpx.HTTPStatusError as e:
            logger.error("LlamaCpp chat HTTP error: %s", e.response.text)
            raise
        except Exception as e:
            logger.error("LlamaCpp chat error: %s", e)
            raise

    async def health(self) -> bool:
        """GET /health — 服務健康狀態"""
        try:
            async with httpx.AsyncClient(timeout=3.0) as c:
                r = await c.get(f"{self._base_url}/health")
                return r.status_code == 200
        except Exception:
            return False

    async def model_name(self) -> str:
        """GET /v1/models — 取得當前載入模型 ID"""
        try:
            async with httpx.AsyncClient(timeout=4.0) as c:
                r = await c.get(f"{self._base_url}/v1/models")
                if r.status_code == 200:
                    models = r.json().get("data", [])
                    return models[0].get("id", "unknown") if models else "unknown"
        except Exception:
            pass
        return "unknown"
