"""
routers/vlm.py — VLM WebUI 狀態查詢 + 診斷代理 + WebSocket 串流推論
"""
import asyncio
import json
import logging
import httpx
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional, Any

from config import get_settings

logger   = logging.getLogger(__name__)
router   = APIRouter(prefix="/api/vlm", tags=["vlm"])
settings = get_settings()


class VlmStatusResponse(BaseModel):
    webui_ok:    bool
    llm_ok:      bool
    webui_url:   str
    llm_url:     str
    model:       Optional[str] = None


class DiagnoseRequest(BaseModel):
    prompt:       str
    image_base64: Optional[str] = None
    max_tokens:   int = 512
    temperature:  float = 0.05


class DiagnoseResponse(BaseModel):
    content:     str
    model:       Optional[str] = None
    finish_reason: Optional[str] = None


@router.get("/status", response_model=VlmStatusResponse)
async def vlm_status():
    """檢查 live-vlm-webui 與 llama.cpp 服務可用性"""
    webui_ok = llm_ok = False
    model    = None

    # 測試 live-vlm-webui
    try:
        async with httpx.AsyncClient(timeout=5.0) as c:
            r = await c.get(f"{settings.vlm_webui_url}/")
            webui_ok = r.status_code < 500
    except Exception as e:
        logger.debug("vlm-webui not reachable: %s", str(e))

    # 測試 llama.cpp
    try:
        async with httpx.AsyncClient(timeout=5.0) as c:
            r = await c.get(f"{settings.llm_base_url}/v1/models")
            if r.status_code == 200:
                llm_ok = True
                data   = r.json()
                models = data.get("data", [])
                if models:
                    model = models[0].get("id")
    except Exception as e:
        logger.debug("llama.cpp not reachable: %s", str(e))

    return VlmStatusResponse(
        webui_ok=  webui_ok,
        llm_ok=    llm_ok,
        webui_url= settings.vlm_webui_url,
        llm_url=   settings.llm_base_url,
        model=     model,
    )


@router.post("/diagnose", response_model=DiagnoseResponse)
async def vlm_diagnose(payload: DiagnoseRequest):
    """
    直接呼叫 llama.cpp /v1/chat/completions 進行圖文診斷。
    若有 image_base64，附加為 vision message。
    """
    messages: list[dict[str, Any]] = []

    if payload.image_base64:
        messages.append({
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{payload.image_base64}"},
                },
                {"type": "text", "text": payload.prompt},
            ],
        })
    else:
        messages.append({"role": "user", "content": payload.prompt})

    try:
        async with httpx.AsyncClient(timeout=120.0) as c:
            r = await c.post(
                f"{settings.llm_base_url}/v1/chat/completions",
                json={
                    "model":       settings.llm_model,
                    "messages":    messages,
                    "max_tokens":  payload.max_tokens,
                    "temperature": payload.temperature,
                    "stream":      False,
                },
            )
            r.raise_for_status()
            data   = r.json()
            choice = data["choices"][0]
            return DiagnoseResponse(
                content=       choice["message"]["content"],
                model=         data.get("model"),
                finish_reason= choice.get("finish_reason"),
            )
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=502,
            detail=f"llama.cpp 回應錯誤 HTTP {e.response.status_code}",
        )
    except httpx.RequestError:
        raise HTTPException(
            status_code=503,
            detail="無法連線至 llama.cpp（:8080），請確認服務已啟動。",
        )


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket 串流推論端點
# 協定（Client → Server）:
#   {"image_base64": "<b64>", "prompt": "...", "max_tokens": 256, "temperature": 0.05}
#   {"type": "pong"}   ← 回應 server 的 ping
# 協定（Server → Client）:
#   {"type": "start"}
#   {"type": "token",  "content": "..."}   ← 逐 token 即時輸出
#   {"type": "done",   "finish_reason": "stop"}
#   {"type": "skip",   "message": "..."}   ← 上一幀推論中，略過此幀
#   {"type": "error",  "message": "..."}
#   {"type": "ping"}                        ← 保活 ping（client 需回 pong）
# ─────────────────────────────────────────────────────────────────────────────
@router.websocket("/ws")
async def vlm_websocket_stream(websocket: WebSocket):
    """瀏覽器攝影機串流推論 — 支援筆電、手機、平板（任何支援 WebRTC 的瀏覽器）"""
    await websocket.accept()
    logger.info("VLM WebSocket 連線建立 — client: %s", websocket.client)

    # 每個連線的推論鎖：避免同一連線同時執行多次推論（backpressure 保護）
    inference_lock = asyncio.Lock()

    try:
        while True:
            # 等待 client 傳來資料，逾時 60s 後送 ping 保活
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
                continue

            # 解析 JSON
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "無效的 JSON 格式"})
                continue

            # 忽略 pong
            if data.get("type") == "pong":
                continue

            image_b64   = data.get("image_base64")
            prompt      = data.get("prompt", "請分析這張圖片中的設備狀況，識別任何異常或需要注意的地方。")
            max_tokens  = min(int(data.get("max_tokens", 256)), settings.llm_max_tokens)
            temperature = float(data.get("temperature", 0.05))

            # 若上一次推論尚未完成，跳過此幀（避免堆積）
            if inference_lock.locked():
                await websocket.send_json({"type": "skip", "message": "推論中，略過此幀"})
                continue

            async with inference_lock:
                # 建構 OpenAI Vision 格式訊息
                messages: list[dict[str, Any]] = []
                if image_b64:
                    messages.append({
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"},
                            },
                            {"type": "text", "text": prompt},
                        ],
                    })
                else:
                    messages.append({"role": "user", "content": prompt})

                await websocket.send_json({"type": "start"})

                try:
                    # 串流呼叫 llama.cpp
                    async with httpx.AsyncClient(
                        timeout=httpx.Timeout(connect=5.0, read=120.0, write=10.0, pool=5.0)
                    ) as client:
                        async with client.stream(
                            "POST",
                            f"{settings.llm_base_url}/v1/chat/completions",
                            json={
                                "model":       settings.llm_model,
                                "messages":    messages,
                                "max_tokens":  max_tokens,
                                "temperature": temperature,
                                "stream":      True,
                            },
                        ) as response:
                            if response.status_code != 200:
                                body = await response.aread()
                                await websocket.send_json({
                                    "type": "error",
                                    "message": f"推論引擎回應 HTTP {response.status_code}",
                                })
                                continue

                            done_sent = False
                            # 嘗試讀取純文字回應（非串流 fallback，如 stub / 測試用）
                            plain_buffer: list[str] = []

                            async for line in response.aiter_lines():
                                # OpenAI SSE 格式
                                if line.startswith("data: "):
                                    chunk_str = line[6:].strip()
                                    if chunk_str == "[DONE]":
                                        await websocket.send_json({"type": "done", "finish_reason": "stop"})
                                        done_sent = True
                                        break
                                    try:
                                        chunk  = json.loads(chunk_str)
                                        choice = chunk["choices"][0]
                                        delta  = choice.get("delta", {})
                                        content = delta.get("content") or ""
                                        if content:
                                            await websocket.send_json({"type": "token", "content": content})
                                        finish = choice.get("finish_reason")
                                        if finish and finish not in ("null", None):
                                            await websocket.send_json({"type": "done", "finish_reason": finish})
                                            done_sent = True
                                            break
                                    except (json.JSONDecodeError, KeyError, IndexError):
                                        pass
                                else:
                                    # 收集非 SSE 純文字（stub 或非串流模式 fallback）
                                    if line.strip():
                                        plain_buffer.append(line)

                            # SSE 迴圈結束後若未發送 done（stub / 異常回應），
                            # 將收集到的純文字作為結果送出，確保前端能正確結束分析狀態
                            if not done_sent:
                                if plain_buffer:
                                    await websocket.send_json({
                                        "type": "token",
                                        "content": "\n".join(plain_buffer[:10]),  # 最多 10 行
                                    })
                                await websocket.send_json({"type": "done", "finish_reason": "stop"})

                except httpx.ConnectError:
                    await websocket.send_json({
                        "type": "error",
                        "message": "無法連線至推論引擎，請確認 llama.cpp 服務是否已啟動。",
                    })
                except httpx.ReadTimeout:
                    await websocket.send_json({
                        "type": "error",
                        "message": "推論逾時（>120s），請縮短提示詞或減少 max_tokens。",
                    })
                except Exception as exc:
                    logger.exception("VLM WebSocket 推論錯誤")
                    await websocket.send_json({
                        "type": "error",
                        "message": f"推論錯誤：{type(exc).__name__}",
                    })

    except WebSocketDisconnect:
        logger.info("VLM WebSocket 連線中斷 — client: %s", websocket.client)
    except Exception:
        logger.exception("VLM WebSocket 未預期錯誤")
