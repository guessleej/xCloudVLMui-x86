"""
ocr_service.py — 使用 Gemma 4 E4B (VLM) 從圖片中提取文字
透過 llama.cpp /v1/chat/completions (multimodal) 進行 OCR
"""
from __future__ import annotations
import base64
import logging
from typing import Optional

import httpx

from config import get_settings

logger   = logging.getLogger(__name__)
settings = get_settings()

# 支援的圖片格式
SUPPORTED_IMAGE_TYPES = {
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".webp": "image/webp",
    ".gif":  "image/gif",
    ".bmp":  "image/bmp",
}

_OCR_PROMPT = (
    "請完整提取此圖片中所有可見的文字內容，包含：標籤文字、數值讀數、"
    "規格說明、警告訊息、操作指示、型號與序號等。"
    "以純文字輸出，保持原有的排版結構（如有表格請用縱向文字表示），"
    "不需要額外說明、解釋或翻譯。若圖片不含任何文字，請回應：（無可辨識文字）"
)


async def extract_text_from_image(
    image_bytes: bytes,
    suffix:      str = ".jpg",
) -> str:
    """
    使用 llama.cpp (Gemma 4 E4B VLM) 從圖片中提取文字。

    Args:
        image_bytes: 原始圖片位元組
        suffix:      檔案後綴（.jpg/.png/.webp 等）

    Returns:
        提取的文字（空白表示失敗）
    """
    mime_type = SUPPORTED_IMAGE_TYPES.get(suffix.lower(), "image/jpeg")
    b64       = base64.b64encode(image_bytes).decode("utf-8")
    data_url  = f"data:{mime_type};base64,{b64}"

    payload = {
        "model": settings.llm_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": data_url},
                    },
                    {
                        "type": "text",
                        "text": _OCR_PROMPT,
                    },
                ],
            }
        ],
        "max_tokens":  2048,
        "temperature": 0.0,
        "stream":      False,
    }

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            res = await client.post(
                f"{settings.llm_base_url}/v1/chat/completions",
                json=payload,
                headers={"Content-Type": "application/json"},
            )
            res.raise_for_status()
            data = res.json()
            text = data["choices"][0]["message"]["content"].strip()
            logger.info("OCR extracted %d chars from image", len(text))
            return text
    except httpx.HTTPStatusError as e:
        logger.error("OCR HTTP error %s: %s", e.response.status_code, e.response.text[:200])
        return ""
    except httpx.RequestError as e:
        logger.error("OCR connection error: %s", str(e))
        return ""
    except (KeyError, IndexError) as e:
        logger.error("OCR response parse error: %s", str(e))
        return ""


def image_to_chunks(ocr_text: str, chunk_size: int = 800, overlap: int = 100) -> list[str]:
    """將 OCR 提取文字切片，供 ChromaDB 嵌入"""
    text = ocr_text.strip()
    if not text or text == "（無可辨識文字）":
        return []

    chunks = []
    start  = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        chunks.append(text[start:end])
        start += chunk_size - overlap

    return [c.strip() for c in chunks if c.strip()]
