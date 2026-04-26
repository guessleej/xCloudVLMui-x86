<!-- xCloudVLMui — DGX Spark (HP ZGX Nano G1n) README -->
<div align="center">

# xCloudVLMui Platform — DGX Spark

**工廠設備健康管理平台 · 工廠視覺 AI 指揮台**

[![Platform](https://img.shields.io/badge/Platform-HP%20ZGX%20Nano%20G1n-0096d6?logo=hp&logoColor=white)]()
[![SoC](https://img.shields.io/badge/SoC-GB10%20Grace%20Blackwell-76b900?logo=nvidia&logoColor=white)]()
[![CUDA](https://img.shields.io/badge/CUDA-13.0%20Blackwell-76b900?logo=nvidia&logoColor=white)]()
[![AI](https://img.shields.io/badge/AI-1%20PFLOP%20FP4-ff6600)]()
[![RAM](https://img.shields.io/badge/RAM-128GB%20LPDDR5X-blue)]()
[![Python](https://img.shields.io/badge/Python-3.11-3776ab?logo=python&logoColor=white)]()
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110-009688?logo=fastapi&logoColor=white)]()
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)]()
[![Docker](https://img.shields.io/badge/Docker-Compose%20v2-2496ED?logo=docker&logoColor=white)]()

> 由 **云碩科技 xCloudinfo Corp.Limited** 開發
> 專為 **HP ZGX Nano G1n AI Station / NVIDIA DGX Spark (GB10)** 優化的邊緣 AI 部署版本

</div>

---

## 硬體規格 — HP ZGX Nano G1n AI Station

| 項目 | 規格 |
|------|------|
| **硬體平台** | HP ZGX Nano G1n AI Station（NVIDIA DGX Spark OEM）|
| **SoC** | NVIDIA GB10 Grace Blackwell Superchip |
| **CPU** | 20-core Arm（10× Cortex-X925 效能核心 + 10× Cortex-A725 效率核心）|
| **GPU** | NVIDIA Blackwell — 48 SMs，第 5 代 Tensor Cores，第 4 代 RT Cores |
| **AI 效能** | **1 PFLOP FP4**（含 sparsity）|
| **記憶體** | **128 GB LPDDR5X Unified Memory**（CPU + GPU 共享）273 GB/s，16 通道 |
| **儲存** | 2 TB / 4 TB NVMe M.2 SED（PCIe Gen5 x4 插槽）|
| **作業系統** | NVIDIA DGX OS 7.4.0（Ubuntu 24.04 base，Kernel 6.17）|
| **CUDA** | 13.0.2 |
| **GPU Driver** | 580.142 |
| **網路** | ConnectX-7 200GbE（2× QSFP）+ 10GbE RJ-45 + Wi-Fi 7 + BT 5.4 |
| **USB** | 3× USB-C 20Gbps（含 DisplayPort 1.4a Alt Mode）|
| **顯示** | 1× HDMI 2.1a |
| **功耗** | 待機 36-38 W / 滿載 228 W / PSU 240 W |
| **尺寸** | 150 × 150 × 51 mm，1.25 kg |

> HP ZGX Nano G1n 是 NVIDIA DGX Spark (GB10) 的 HP OEM 版本。
> GB10 Grace Blackwell Superchip 支援最高 200B 參數模型；雙機互聯可擴充至 405B 參數。

---

## 服務架構與 Port 配置

```
┌──────────────────────────────────────────────────────────────────┐
│              HP ZGX Nano G1n / DGX Spark (GB10)                  │
│                                                                  │
│  ┌─ [7] nginx :8780 ──────────────────────────────────────────┐  │
│  │                                                            │  │
│  │  ┌─ [6] frontend :3200 ─────────────────────────────────┐ │  │
│  │  │  Next.js 14 · 視覺巡檢 · MQTT · RAG · 模型管理       │ │  │
│  │  └──────────────────────────────────────────────────────┘ │  │
│  │                                                            │  │
│  │  ┌─ [5] backend :8101 ──────────────────────────────────┐ │  │
│  │  │  FastAPI · SQLite · ChromaDB · RAG · MQTT             │ │  │
│  │  └──────────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ [3] llama-cpp :18180 ─────────────────────────────────────┐  │
│  │  Gemma 4 E4B Q4_K_M · CUDA 13 · Blackwell GB10 GPU        │  │
│  │  n-gpu-layers=99 · flash-attn · ctx=128K · mlock           │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ [4] vlm-webui :8190 ──┐  ┌─ [2] mosquitto :1884 ─────────┐  │
│  │  WebRTC 視覺串流        │  │  MQTT Broker · IoT 感測器      │  │
│  └────────────────────────┘  └───────────────────────────────┘  │
│                                                                  │
│  ┌─ [8] cadvisor :8191 ───────────────────────────────────────┐  │
│  │  GB10 GPU + 容器資源監控                                    │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

| 服務 | 外部 Port | 內部 Port | 說明 |
|------|-----------|-----------|------|
| nginx（主要入口）| **8780** | 80 | 反向代理統一入口 |
| nginx（HTTPS）| 8743 | 443 | SSL 入口 |
| backend API | 8101 | 8000 | FastAPI + RAG + MQTT |
| frontend | 3200 | 3000 | Next.js 儀表板 |
| llama-cpp | 18180 | 8080 | Blackwell CUDA 推論 |
| vlm-webui | 8190 | 8090 | WebRTC 視覺串流 |
| cadvisor | 8191 | 8080 | 容器資源監控 |
| MQTT TCP | 1884 | 1883 | Eclipse Mosquitto |
| MQTT WS | 9002 | 9001 | MQTT over WebSocket |

---

## 快速部署

### 前置條件

```bash
# 1. 確認 DGX OS 版本
cat /etc/dgx-release
# 預期：DGX_OS_VERSION=7.4.0

# 2. 確認 CUDA 版本
nvcc --version
# 預期：CUDA 13.0

# 3. 確認 Docker + NVIDIA runtime
docker info | grep -i runtime
# 應包含：nvidia

# 4. 確認 nvidia-smi
nvidia-smi
# 應顯示：GB10 GPU, 128GB 統一記憶體
```

### 部署步驟

```bash
# 1. Clone 專案
git clone https://github.com/guessleej/xCloudVLMui-dgx-spark.git
cd xCloudVLMui-dgx-spark

# 2. 設定環境
make setup
# 編輯 backend/.env：填入 HF_TOKEN, SECRET_KEY
# 編輯 frontend/.env.local：填入 NEXTAUTH_SECRET, OAuth 憑證

# 3. 啟動所有服務
make up

# 4. 追蹤模型下載進度
make logs-llm

# 5. 驗證服務健康
make test
```

### 訪問介面

| 介面 | URL |
|------|-----|
| 主要 Web UI | `http://<DGX_IP>:8780` |
| API 文件 | `http://<DGX_IP>:8780/docs` |
| LLaMA.cpp | `http://<DGX_IP>:18180/health` |
| cAdvisor | `http://<DGX_IP>:8191` |

---

## GB10 Blackwell 推論設定

```yaml
# docker-compose.yml llama-cpp 關鍵參數
--n-gpu-layers 99    # 全部 Layer 上 GPU（128GB 足夠）
--flash-attn         # Blackwell 第 5 代 Tensor Core FlashAttention
--ctx-size 131072    # 128K context window
--threads 20         # GB10 × 20 核全部使用
--mlock              # 鎖定 128GB unified memory，零 swap
```

### 效能參考

| 項目 | 數值 |
|------|------|
| AI 算力 | 1 PFLOP FP4 |
| 記憶體頻寬 | 273 GB/s |
| Context Window | 128K tokens |
| 最大支援模型 | ~200B 參數（單機）|

---

## 模型配置

| 模型 | 量化 | 大小 | 用途 |
|------|------|------|------|
| Gemma 4 E4B Q4_K_M | GGUF | ~4GB | LLM 問答 + VLM 推論 |
| Gemma 4 E4B Q6_K | GGUF | ~6GB | 高精度選項 |
| YOLO11n detect (E2E) | ONNX | ~6MB | 設備巡檢 |
| YOLO11n pose (E2E) | ONNX | ~7MB | 人員辨識 |

---

## 故障排除

### NVIDIA Container Runtime 未配置
```bash
# DGX OS 通常已預裝，若未配置：
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### 200GbE ConnectX-7 網路設定
```bash
# 確認 ConnectX-7 網路介面
ip link show | grep -E "enp|mlx"
```

---

## 多平台總覽

| 平台 | 倉庫 | Port | 架構 | 推論加速 |
|------|------|------|------|----------|
| **DGX Spark** | **[xCloudVLMui-dgx-spark](https://github.com/guessleej/xCloudVLMui-dgx-spark)** | **:8780** | **ARM64** | **GB10 CUDA 13 / DGX OS 7.4** |
| MIC-743 | [xCloudVLMui-mic743](https://github.com/guessleej/xCloudVLMui-mic743) | :8780 | ARM64 | Blackwell CUDA 12.6 / JetPack 7.x |
| AIR-030 | [xCloudVLMui-air030](https://github.com/guessleej/xCloudVLMui-air030) | :8780 | ARM64 | Ampere CUDA 11.4 / JetPack 5.1 |
| x86 | [xCloudVLMui-x86](https://github.com/guessleej/xCloudVLMui-x86) | :8680 | AMD64 | CPU / 可選 NVIDIA GPU |
| macOS | [xCloudVLMui-macOS](https://github.com/guessleej/xCloudVLMui-macOS) | :8880 | ARM64 | Ollama on Apple Silicon |

---

<div align="center">
由 <strong>云碩科技 xCloudinfo Corp.Limited</strong> 開發 · Powered by HP ZGX Nano G1n / NVIDIA GB10 Grace Blackwell
</div>
