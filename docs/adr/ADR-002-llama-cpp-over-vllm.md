# ADR-002：選用 llama.cpp 而非 vLLM / TGI 作為邊緣推論引擎

| 欄位       | 內容                                                        |
|-----------|-------------------------------------------------------------|
| **狀態**  | ✅ 已採納（Accepted）                                        |
| **日期**  | 2025-12-15                                                  |
| **決策者** | 架構師、AI 工程師                                           |
| **關聯**  | docker-compose.yml `llama-cpp` service、ADR-001、config.py |

---

## 背景與問題

系統需要在 **Jetson AGX Orin（ARM64, JetPack 6.0, CUDA 12.6）** 上執行
`Gemma 4 E4B` 大型語言模型，提供：
- 設備異常分析（VLM vision-language 推論）
- RAG 知識庫問答（結合 ChromaDB 語意搜尋）
- 128K context window 支援（長文件理解）

---

## 評估的方案

### 方案 A：llama.cpp（GGUF + Tegra CUDA 特化映像）

**優點：**
- **ARM64 Jetson 官方支援**：`ghcr.io/nvidia-ai-iot/llama_cpp:r36.4-tegra-aarch64-cu126-22.04`
  針對 Jetson GPU 與 CUDA 12.6 特化優化
- **GGUF 量化**：Q4_K_M 格式壓縮至 ~4GB，AIR-030 64GB 記憶體充裕
- **OpenAI 相容 API**：`/v1/chat/completions`、`/v1/completions`、`/v1/models`，
  後端無需修改即可切換模型
- **嵌入向量支援**：`--embedding` 參數啟用文字嵌入端點（ChromaDB embedding 備援）
- **單 binary 部署**：無額外 Python 依賴，映像體積最小

**缺點：**
- 不支援連續批次（continuous batching）→ 高並發吞吐較低
- 不支援動態 LoRA 熱載

### 方案 B：vLLM

**優點：**
- 業界最高 throughput（PagedAttention）
- 完整 LoRA / Speculative Decoding 支援

**缺點：**
- **不支援 ARM64 / Jetson**（僅 x86_64 NVIDIA GPU）
- 需要 PyTorch 完整安裝（映像 > 10GB）
- 最低記憶體要求遠高於 llama.cpp

### 方案 C：Text Generation Inference（TGI, HuggingFace）

**優點：**
- Flash Attention 2 加速
- 完整 HuggingFace Hub 模型支援

**缺點：**
- ARM64 官方支援有限，社群 patch 不穩定
- 映像約 8-12GB，AIR-030 eMMC 空間有限
- 推論精度與量化選項不如 llama.cpp 靈活

### 方案 D：Ollama

**優點：**
- 易於使用，本機部署友善
- 支援 ARM64

**缺點：**
- 不提供 OpenAI 完整相容 API（缺少 embedding endpoint）
- 無法細粒度控制推論參數（context size、batch size）
- 工業部署需更嚴格的版本控制與穩定性保證

---

## 決策

**選用 llama.cpp（方案 A）。**

理由：

1. **Jetson 硬體唯一成熟方案**：Nvidia AI-IOT 官方維護 Tegra 特化映像，
   CUDA 12.6 + cuDNN 整合，確保最大 GPU 利用率。

2. **資源效率極佳**：
   - Gemma 4 E4B Q4_K_M = ~4GB VRAM；剩餘 60GB 作 KV Cache
   - 128K context 可容納完整 SOP 文件（10,000-token 等級）

3. **API 相容性零切換成本**：`LlamaCppAdapter` 實作 `ILLMAdapter` Protocol，
   未來若換用 vLLM（x86 版本）只需替換 adapter，業務邏輯不變。

4. **量化格式靈活**：支援 Q2_K / Q4_K_M / Q8_0，可依 VRAM 預算調整精度。

---

## 後果與限制

- ✅ 模型推論在 Jetson 上完整 GPU 加速（`--n-gpu-layers 999`）
- ✅ OpenAI-compatible API 使後端適配器實作簡單
- ⚠️ 並發請求 > 4 時延遲顯著上升（無 continuous batching）
- ⚠️ 模型更新需停服、重新下載 GGUF 檔案
- 📋 `model-init` service 負責首次下載，支援 `HF_TOKEN` 私有 repo

---

## 後續行動

- [ ] v1.2.0：評估 `llama.cpp` batched inference 參數調優（`--ubatch-size`）
- [ ] v2.0.0：若部署 x86 推論伺服器，評估 vLLM 替代並使用 `LlamaCppAdapter` 無縫切換
