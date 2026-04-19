"""
embedding_service.py — 呼叫 llama.cpp /v1/embeddings 產生向量
"""
import asyncio
import logging
import httpx
from config import get_settings

logger   = logging.getLogger(__name__)
settings = get_settings()


async def get_embedding(text: str) -> list[float]:
    """
    呼叫 llama.cpp OpenAI 相容端點取得嵌入向量。
    - 輸入文字自動截斷至 4096 chars（GGUF 模型限制）
    - 失敗時回傳空 list，由呼叫方決定如何處理
    """
    text = text[:4096]
    url  = f"{settings.llm_base_url}/v1/embeddings"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                url,
                json={"model": settings.embed_model, "input": text},
                headers={"Content-Type": "application/json"},
            )
            res.raise_for_status()
            data = res.json()
            return data["data"][0]["embedding"]
    except httpx.HTTPStatusError as e:
        logger.error("Embedding HTTP error %s: %s", e.response.status_code, e.response.text[:200])
    except httpx.RequestError as e:
        logger.error("Embedding connection error: %s", str(e))
    except (KeyError, IndexError, ValueError) as e:
        # ValueError covers json.JSONDecodeError (stub 回傳非 JSON 時觸發)
        logger.error("Embedding response parse error: %s", str(e))

    return []


async def get_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """批次取得多筆向量（並發限制 5）"""
    sem = asyncio.Semaphore(5)

    async def _one(t: str) -> list[float]:
        async with sem:
            return await get_embedding(t)

    return await asyncio.gather(*[_one(t) for t in texts])
