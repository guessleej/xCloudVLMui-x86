# xCloudVLMui — x86-64 通用 Linux 部署指南

> **目標平台**：一般 x86-64 Linux 伺服器 / 工作站  
> **架構**：AMD64 (x86_64)  
> **推論**：CPU（預設）或 NVIDIA GPU（可選）  
> **OS**：Ubuntu 22.04 / Debian 12 / RHEL 9  

---

## 服務 Port 配置

| 服務 | 外部 Port | 說明 |
|------|-----------|------|
| nginx (主要入口) | **8680** | 反向代理 |
| backend API | 8301 | FastAPI |
| frontend | 3300 | Next.js 儀表板 |
| llama-cpp | 18280 | Gemma 4 E4B CPU/GPU 推論 |
| vlm-webui | 8380 | WebRTC 視覺串流 |
| cadvisor | 8381 | 容器資源監控 |
| MQTT | 1885 / 9003 | Eclipse Mosquitto |

## 快速部署（CPU 模式）

```bash
# Clone 專案
git clone https://github.com/guessleej/xCloudVLMui-x86.git
cd xCloudVLMui-x86

# 設定環境
make setup
# 編輯 backend/.env 與 frontend/.env.local

# 啟動（CPU 推論）
make up

# 驗證健康
make test
```

## GPU 加速（可選）

```bash
# 安裝 nvidia-docker2
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/libnvidia-container/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-docker2
sudo systemctl restart docker

# GPU 模式啟動
make up-gpu
```

## 系統需求

### CPU 模式（最低需求）
- CPU：8 cores（推薦 16+ cores 以獲得更好推論速度）
- RAM：16GB（推薦 32GB）
- 磁碟：50GB 可用空間（含模型 ~4GB）

### GPU 模式（推薦）
- GPU：NVIDIA GTX 1080 Ti / RTX 系列 / A 系列
- VRAM：≥ 8GB
- Driver：≥ 525.x
- CUDA：≥ 12.0

## 模型配置

| 模型 | 量化 | 大小 | CPU 速度 | GPU 速度 |
|------|------|------|----------|----------|
| Gemma 4 E4B Q4_K_M | GGUF | ~4GB | ~3 tok/s | ~30 tok/s |
| YOLO26n detect | E2E ONNX | ~6MB | 瀏覽器 WASM | 瀏覽器 WASM |

> CPU 推論需要更長的首次回應時間（約 15-30 秒），這是正常現象。

## 調整 CPU 執行緒數

編輯 `docker-compose.yml` 或設定環境變數：
```bash
CPU_THREADS=16 make up
```

## GitHub 倉庫

此倉庫專用於 x86 平台部署：  
**`https://github.com/guessleej/xCloudVLMui-x86`**

---

## 四平台總覽

| 平台 | 倉庫 | Port | 加速 |
|------|------|------|------|
| macOS | xCloudVLMui | :3110 | CPU / Apple Silicon |
| AIR-030 | xCloudVLMui-air030 | :8880 | CUDA 12.2 / JetPack 6.0 |
| MIC-743 | xCloudVLMui-mic743 | :8780 | CUDA 12.6 / JetPack 7.1 |
| **x86** | **xCloudVLMui-x86** | **:8680** | **CPU / 可選 NVIDIA GPU** |
