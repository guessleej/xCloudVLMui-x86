#!/usr/bin/env bash
###############################################################################
# download-model.sh
# 下載 Gemma 4 E4B GGUF Q4_K_M 至 ./models/
#
# 用法：
#   bash scripts/download-model.sh             # 互動確認
#   bash scripts/download-model.sh --yes       # 無人值守
#   HF_TOKEN=xxx bash scripts/download-model.sh --yes  # Private model
###############################################################################
set -euo pipefail

MODELS_DIR="$(cd "$(dirname "$0")/.." && pwd)/models"
MODEL_FILENAME="gemma-4-e4b-it-Q4_K_M.gguf"
MODEL_PATH="${MODELS_DIR}/${MODEL_FILENAME}"

# HuggingFace GGUF 量化版本（bartowski 社群量化，最常見的 GGUF 來源）
HF_REPO="bartowski/google_gemma-4-e4b-it-GGUF"
HF_FILE="${MODEL_FILENAME}"
HF_URL="https://huggingface.co/${HF_REPO}/resolve/main/${HF_FILE}"

# 顏色
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║     Gemma 4 E4B GGUF Q4_K_M — 模型下載程式          ║"
echo "║     AIR-030 × Jetson AGX Orin 64GB × JetPack 6.0    ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "  來源：${YELLOW}${HF_URL}${NC}"
echo -e "  目標：${YELLOW}${MODEL_PATH}${NC}"
echo -e "  大小：約 ${YELLOW}4.0 GB${NC}（Q4_K_M 量化）"
echo ""

# 建立目錄
mkdir -p "${MODELS_DIR}"

# 若已存在則跳過
if [[ -f "${MODEL_PATH}" ]]; then
  SIZE=$(du -sh "${MODEL_PATH}" | cut -f1)
  echo -e "${GREEN}✓ 模型已存在（${SIZE}），跳過下載。${NC}"
  echo -e "  路徑：${MODEL_PATH}"
  exit 0
fi

# 確認提示
if [[ "${1:-}" != "--yes" ]]; then
  echo -ne "${YELLOW}確認下載？(y/N) ${NC}"
  read -r confirm
  [[ "${confirm}" =~ ^[Yy]$ ]] || { echo "已取消。"; exit 0; }
fi

echo ""
echo -e "${BLUE}開始下載...${NC}"

# ── 方法 1：huggingface-cli（推薦，有斷點續傳）────────────────────
if command -v huggingface-cli &>/dev/null; then
  echo -e "  使用 ${GREEN}huggingface-cli${NC}（支援斷點續傳）"
  HF_TOKEN_ARG=""
  [[ -n "${HF_TOKEN:-}" ]] && HF_TOKEN_ARG="--token ${HF_TOKEN}"
  huggingface-cli download \
    ${HF_REPO} \
    ${HF_FILE} \
    --local-dir "${MODELS_DIR}" \
    --local-dir-use-symlinks False \
    ${HF_TOKEN_ARG}

# ── 方法 2：wget（有進度條）──────────────────────────────────────
elif command -v wget &>/dev/null; then
  echo -e "  使用 ${GREEN}wget${NC}"
  HEADER_ARG=""
  [[ -n "${HF_TOKEN:-}" ]] && HEADER_ARG="--header=Authorization: Bearer ${HF_TOKEN}"
  wget -c ${HEADER_ARG} \
    --show-progress \
    -O "${MODEL_PATH}" \
    "${HF_URL}"

# ── 方法 3：curl ──────────────────────────────────────────────────
elif command -v curl &>/dev/null; then
  echo -e "  使用 ${GREEN}curl${NC}"
  HEADER_ARG=""
  [[ -n "${HF_TOKEN:-}" ]] && HEADER_ARG="-H \"Authorization: Bearer ${HF_TOKEN}\""
  curl -L --continue-at - \
    ${HEADER_ARG} \
    --progress-bar \
    -o "${MODEL_PATH}" \
    "${HF_URL}"

else
  echo -e "${RED}✗ 錯誤：找不到 huggingface-cli / wget / curl${NC}"
  echo "  請安裝其中一個工具，或手動下載：${HF_URL}"
  exit 1
fi

# 驗證檔案
if [[ -f "${MODEL_PATH}" ]]; then
  SIZE=$(du -sh "${MODEL_PATH}" | cut -f1)
  echo ""
  echo -e "${GREEN}✓ 下載完成！（${SIZE}）${NC}"
  echo -e "  ${MODEL_PATH}"
else
  echo -e "${RED}✗ 下載失敗，請手動下載：${NC}"
  echo -e "  ${HF_URL}"
  exit 1
fi
