#!/usr/bin/env bash
###############################################################################
# build-release.sh — xCloudVLMui 生產級 Docker 映像打包腳本
#
# 功能：
#   1. 建置 backend / frontend / vlm-webui Docker 映像
#   2. 匯出映像為 .tar（可離線安裝，不需 Internet）
#   3. 打包所有部署材料為 xcloudvlmui-v{VERSION}-{DATE}.tar.gz
#
# 產出目錄結構：
#   dist/
#   └── xcloudvlmui-v{VERSION}-{DATE}/
#       ├── images/
#       │   ├── xcloudvlmui-backend.tar
#       │   ├── xcloudvlmui-frontend.tar
#       │   ├── xcloudvlmui-vlm-webui.tar    (可選，需 GPU)
#       │   ├── nginx-1.25-alpine.tar
#       │   └── eclipse-mosquitto-2.tar      (可選，MQTT)
#       ├── config/
#       │   ├── docker-compose.yml
#       │   ├── docker-compose.dev.yml
#       │   ├── nginx/nginx.conf
#       │   ├── mosquitto/config/mosquitto.conf
#       │   ├── backend/.env.example
#       │   └── frontend/.env.local.example
#       ├── scripts/
#       │   ├── install.sh       ← 客戶端一鍵安裝腳本
#       │   ├── download-model.sh
#       │   ├── gen-ssl.sh
#       │   └── test-services.sh
#       ├── Makefile
#       └── README.md            ← 客戶安裝說明
#
# 用法：
#   bash scripts/build-release.sh [OPTIONS]
#
#   -v, --version VERSION   版本號（預設：從 git tag，否則 1.0.0）
#   -p, --platform PLATFORM 目標平台（預設：linux/arm64，Jetson AGX Orin）
#                           可選：linux/amd64（x86 GPU 伺服器）
#   --skip-vlm              跳過 vlm-webui 建置（若無 GPU 開發機）
#   --skip-mqtt             跳過 mosquitto 映像打包
#   --no-cache              強制重新建置（不使用快取）
#   --push REGISTRY         額外推送至 Docker Registry（可選）
#   -h, --help              顯示說明
#
# 範例：
#   bash scripts/build-release.sh
#   bash scripts/build-release.sh -v 2.0.0 --platform linux/amd64
#   bash scripts/build-release.sh --skip-vlm --no-cache
###############################################################################
set -euo pipefail

# ── 顏色 ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log_info()  { printf "${BLUE}  ℹ ${NC} %s\n" "$*"; }
log_ok()    { printf "${GREEN}  ✓ ${NC} %s\n" "$*"; }
log_warn()  { printf "${YELLOW}  ⚠ ${NC} %s\n" "$*"; }
log_error() { printf "${RED}  ✗ ${NC} %s\n" "$*" >&2; }
log_step()  { printf "\n${BOLD}${CYAN}══ %s ${NC}\n" "$*"; }

# ── 預設參數 ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DATE="$(date +%Y%m%d)"
VERSION=""
PLATFORM="linux/arm64"   # Jetson AGX Orin 預設
SKIP_VLM=false
SKIP_MQTT=false
NO_CACHE=""
PUSH_REGISTRY=""
DIST_DIR="${PROJECT_DIR}/dist"

# ── 參數解析 ──────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    -v|--version)   VERSION="$2";         shift 2 ;;
    -p|--platform)  PLATFORM="$2";        shift 2 ;;
    --skip-vlm)     SKIP_VLM=true;        shift   ;;
    --skip-mqtt)    SKIP_MQTT=true;       shift   ;;
    --no-cache)     NO_CACHE="--no-cache"; shift  ;;
    --push)         PUSH_REGISTRY="$2";   shift 2 ;;
    -h|--help)
      head -60 "$0" | grep "^#" | sed 's/^# \?//'
      exit 0 ;;
    *) log_error "未知參數：$1"; exit 1 ;;
  esac
done

# ── 版本號 ────────────────────────────────────────────────────────────────────
if [[ -z "$VERSION" ]]; then
  VERSION="$(git -C "$PROJECT_DIR" describe --tags --abbrev=0 2>/dev/null || echo "1.0.0")"
fi
RELEASE_NAME="xcloudvlmui-v${VERSION}-${BUILD_DATE}"
RELEASE_DIR="${DIST_DIR}/${RELEASE_NAME}"

# ── 映像名稱定義 ──────────────────────────────────────────────────────────────
IMG_BACKEND="xcloudvlmui/backend:${VERSION}"
IMG_FRONTEND="xcloudvlmui/frontend:${VERSION}"
IMG_VLM="xcloudvlmui/vlm-webui:${VERSION}"
IMG_NGINX="nginx:1.25-alpine"
IMG_MOSQUITTO="eclipse-mosquitto:2"

# ── 前置檢查 ──────────────────────────────────────────────────────────────────
log_step "前置檢查"

command -v docker >/dev/null 2>&1 || { log_error "Docker 未安裝"; exit 1; }

DOCKER_VER=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "0")
log_ok "Docker ${DOCKER_VER}"

# 確認 Docker 可用（Mac Docker Desktop socket）
DOCKER_HOST="${DOCKER_HOST:-unix://$HOME/.docker/run/docker.sock}"
export DOCKER_HOST
docker info >/dev/null 2>&1 || {
  log_error "Docker daemon 無法連線，請確認 Docker Desktop 已啟動"
  exit 1
}
log_ok "Docker daemon 可用"

# buildx 多平台支援
if docker buildx version >/dev/null 2>&1; then
  log_ok "Docker buildx 可用（多平台建置）"
  BUILD_CMD="docker buildx build --platform ${PLATFORM} --load"
else
  log_warn "buildx 不可用，使用標準 docker build（單平台）"
  BUILD_CMD="docker build"
fi

log_info "目標平台：${PLATFORM}"
log_info "版本：    ${VERSION}"
log_info "輸出目錄：${RELEASE_DIR}"

# ── 建立輸出目錄 ──────────────────────────────────────────────────────────────
log_step "建立目錄結構"
mkdir -p \
  "${RELEASE_DIR}/images" \
  "${RELEASE_DIR}/config/nginx" \
  "${RELEASE_DIR}/config/mosquitto/config" \
  "${RELEASE_DIR}/config/backend" \
  "${RELEASE_DIR}/config/frontend" \
  "${RELEASE_DIR}/scripts"
log_ok "目錄結構建立完成"

# ── 建置 Docker 映像 ──────────────────────────────────────────────────────────
log_step "建置 Docker 映像"

# Backend
log_info "建置 backend（FastAPI + Python 3.11）..."
${BUILD_CMD} ${NO_CACHE} \
  -t "${IMG_BACKEND}" \
  -f "${PROJECT_DIR}/backend/Dockerfile" \
  "${PROJECT_DIR}/backend" \
  2>&1 | grep -E "(Step|Successfully|error|ERROR|WARN)" || true
log_ok "backend 建置完成 → ${IMG_BACKEND}"

# Frontend — 注入 build-time 環境變數
log_info "建置 frontend（Next.js 20）..."
${BUILD_CMD} ${NO_CACHE} \
  -t "${IMG_FRONTEND}" \
  --build-arg NEXT_PUBLIC_API_URL=/api \
  --build-arg NEXT_PUBLIC_VLM_WEBUI_URL=/vlm \
  --build-arg NEXT_TELEMETRY_DISABLED=1 \
  -f "${PROJECT_DIR}/frontend/Dockerfile" \
  "${PROJECT_DIR}/frontend" \
  2>&1 | grep -E "(Step|Successfully|error|ERROR|WARN)" || true
log_ok "frontend 建置完成 → ${IMG_FRONTEND}"

# VLM WebUI（可選）
if [[ "$SKIP_VLM" == "false" ]]; then
  log_info "建置 vlm-webui（live-vlm-webui + Python 3.11）..."
  if ${BUILD_CMD} ${NO_CACHE} \
    -t "${IMG_VLM}" \
    -f "${PROJECT_DIR}/vlm-webui/Dockerfile.vlm" \
    "${PROJECT_DIR}/vlm-webui" \
    2>&1 | grep -E "(Step|Successfully|error|ERROR|WARN)" || true; then
    log_ok "vlm-webui 建置完成 → ${IMG_VLM}"
  else
    log_warn "vlm-webui 建置失敗（跳過，不影響核心功能）"
    SKIP_VLM=true
  fi
else
  log_warn "跳過 vlm-webui 建置（--skip-vlm）"
fi

# ── 拉取第三方映像 ────────────────────────────────────────────────────────────
log_step "拉取第三方映像"

log_info "拉取 ${IMG_NGINX}..."
docker pull --platform "${PLATFORM}" "${IMG_NGINX}" >/dev/null 2>&1 && \
  log_ok "${IMG_NGINX}" || log_warn "無法拉取 ${IMG_NGINX}（網路問題）"

if [[ "$SKIP_MQTT" == "false" ]]; then
  log_info "拉取 ${IMG_MOSQUITTO}..."
  docker pull --platform "${PLATFORM}" "${IMG_MOSQUITTO}" >/dev/null 2>&1 && \
    log_ok "${IMG_MOSQUITTO}" || log_warn "無法拉取 ${IMG_MOSQUITTO}（網路問題）"
fi

# ── 匯出映像為 .tar ───────────────────────────────────────────────────────────
log_step "匯出 Docker 映像（離線安裝用）"

_save_image() {
  local img="$1"
  local filename="$2"
  local outpath="${RELEASE_DIR}/images/${filename}"

  log_info "匯出 ${img} → images/${filename}..."
  docker save "${img}" | gzip -9 > "${outpath}.gz"
  SIZE=$(du -sh "${outpath}.gz" | cut -f1)
  log_ok "${filename}.gz（${SIZE}）"
}

_save_image "${IMG_BACKEND}"   "xcloudvlmui-backend-${VERSION}"
_save_image "${IMG_FRONTEND}"  "xcloudvlmui-frontend-${VERSION}"
_save_image "${IMG_NGINX}"     "nginx-1.25-alpine"

if [[ "$SKIP_VLM" == "false" ]]; then
  _save_image "${IMG_VLM}" "xcloudvlmui-vlm-webui-${VERSION}"
fi

if [[ "$SKIP_MQTT" == "false" ]]; then
  _save_image "${IMG_MOSQUITTO}" "eclipse-mosquitto-2"
fi

# ── 複製設定檔案 ──────────────────────────────────────────────────────────────
log_step "複製設定與腳本"

# docker-compose（更新映像名稱為版本標籤）
sed \
  -e "s|build:\n.*context: ./backend.*|image: ${IMG_BACKEND}|g" \
  -e "s|build:\n.*context: ./frontend.*|image: ${IMG_FRONTEND}|g" \
  "${PROJECT_DIR}/docker-compose.yml" \
  > "${RELEASE_DIR}/config/docker-compose.yml.tpl"

# 直接複製原始 compose（install.sh 會修改映像名稱）
cp "${PROJECT_DIR}/docker-compose.yml"         "${RELEASE_DIR}/config/docker-compose.yml"
cp "${PROJECT_DIR}/docker-compose.dev.yml"     "${RELEASE_DIR}/config/docker-compose.dev.yml"
cp "${PROJECT_DIR}/nginx/nginx.conf"           "${RELEASE_DIR}/config/nginx/nginx.conf"
cp "${PROJECT_DIR}/mosquitto/config/mosquitto.conf" \
                                               "${RELEASE_DIR}/config/mosquitto/config/mosquitto.conf"
cp "${PROJECT_DIR}/backend/.env.example"       "${RELEASE_DIR}/config/backend/.env.example"
cp "${PROJECT_DIR}/frontend/.env.local.example" \
                                               "${RELEASE_DIR}/config/frontend/.env.local.example"
cp "${PROJECT_DIR}/Makefile"                   "${RELEASE_DIR}/Makefile"

# 腳本
for s in download-model.sh gen-ssl.sh test-services.sh; do
  [[ -f "${PROJECT_DIR}/scripts/${s}" ]] && \
    cp "${PROJECT_DIR}/scripts/${s}" "${RELEASE_DIR}/scripts/${s}"
done

log_ok "設定檔複製完成"

# ── 寫入版本資訊 ──────────────────────────────────────────────────────────────
cat > "${RELEASE_DIR}/VERSION" <<EOF
VERSION=${VERSION}
BUILD_DATE=${BUILD_DATE}
PLATFORM=${PLATFORM}
GIT_COMMIT=$(git -C "${PROJECT_DIR}" rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git -C "${PROJECT_DIR}" branch --show-current 2>/dev/null || echo "unknown")
IMAGES_INCLUDED=backend,frontend$([ "$SKIP_VLM" = "false" ] && echo ",vlm-webui" || echo "")$([ "$SKIP_MQTT" = "false" ] && echo ",mosquitto" || echo ""),nginx
EOF

# ── 產生安裝腳本 install.sh ───────────────────────────────────────────────────
log_step "產生 install.sh"
cat > "${RELEASE_DIR}/scripts/install.sh" <<'INSTALL_SCRIPT'
#!/usr/bin/env bash
###############################################################################
# install.sh — xCloudVLMui 一鍵安裝腳本
# 執行於目標機器（Advantech AIR-030 / JetPack 6.0）
#
# 用法：
#   cd xcloudvlmui-v*
#   sudo bash scripts/install.sh [OPTIONS]
#
#   --port PORT         前端埠號（預設 80）
#   --secret SECRET     NextAuth 金鑰（預設自動產生）
#   --no-model          跳過模型下載（若已手動放置 ./models/）
#   --offline           完全離線模式（使用 images/*.tar.gz）
#   -h, --help
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

log_info()  { printf "${BLUE}  [INFO]  ${NC} %s\n" "$*"; }
log_ok()    { printf "${GREEN}  [ OK ]  ${NC} %s\n" "$*"; }
log_warn()  { printf "${YELLOW}  [WARN]  ${NC} %s\n" "$*"; }
log_error() { printf "${RED}  [ERR]   ${NC} %s\n" "$*" >&2; exit 1; }
log_step()  { printf "\n${BOLD}${BLUE}▶ %s${NC}\n" "$*"; }

# ── 讀取版本 ────────────────────────────────────────────────────────────────
source "${BASE_DIR}/VERSION" 2>/dev/null || { log_error "找不到 VERSION 檔案"; }

# ── 參數 ─────────────────────────────────────────────────────────────────────
FRONTEND_PORT=80
NEXTAUTH_SECRET="$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | head -c 32 | xxd -p)"
SKIP_MODEL=false
OFFLINE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --port)     FRONTEND_PORT="$2"; shift 2 ;;
    --secret)   NEXTAUTH_SECRET="$2"; shift 2 ;;
    --no-model) SKIP_MODEL=true; shift ;;
    --offline)  OFFLINE=true; shift ;;
    -h|--help)  grep "^#" "$0" | head -40 | sed 's/^# \?//'; exit 0 ;;
    *) log_error "未知參數：$1" ;;
  esac
done

# ── Banner ───────────────────────────────────────────────────────────────────
echo ""
printf "${BOLD}${BLUE}"
echo "╔════════════════════════════════════════════════════════╗"
echo "║   xCloudVLMui  安裝程式                                ║"
echo "║   Advantech AIR-030 × Jetson AGX Orin × JetPack 6.0   ║"
printf "╚════════════════════════════════════════════════════════╝${NC}\n"
echo ""
log_info "版本：    v${VERSION}（${BUILD_DATE}）"
log_info "平台：    ${PLATFORM}"
log_info "前端埠：  ${FRONTEND_PORT}"
log_info "目錄：    ${BASE_DIR}"
echo ""

# ── 前置確認 ─────────────────────────────────────────────────────────────────
log_step "01 / 08  前置檢查"

command -v docker >/dev/null 2>&1 || log_error "Docker 未安裝，請先安裝 Docker Engine"
command -v docker compose >/dev/null 2>&1 || \
  docker-compose version >/dev/null 2>&1 || \
  log_error "docker compose 未安裝"

# 磁碟空間（至少 20GB）
FREE_GB=$(df -BG "${BASE_DIR}" 2>/dev/null | awk 'NR==2 {gsub("G",""); print $4}' || echo "99")
if [[ ${FREE_GB} -lt 20 ]]; then
  log_warn "可用磁碟空間 ${FREE_GB}GB，建議至少 20GB（模型 ~4GB + 映像 ~8GB）"
fi
log_ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"

# ── 載入離線映像 ─────────────────────────────────────────────────────────────
log_step "02 / 08  載入 Docker 映像"
IMAGES_DIR="${BASE_DIR}/images"
LOADED=0
FAILED=0

for tarfile in "${IMAGES_DIR}"/*.tar.gz; do
  [[ -f "$tarfile" ]] || continue
  IMGNAME=$(basename "${tarfile%.tar.gz}")
  log_info "載入 ${IMGNAME}..."
  if docker load < "${tarfile}" >/dev/null 2>&1; then
    log_ok "${IMGNAME}"
    (( LOADED++ )) || true
  else
    log_warn "載入失敗：${IMGNAME}"
    (( FAILED++ )) || true
  fi
done

if [[ $LOADED -eq 0 ]]; then
  log_error "沒有成功載入任何映像，請確認 images/ 目錄不為空"
fi
log_ok "共載入 ${LOADED} 個映像（失敗 ${FAILED} 個）"

# ── 建立工作目錄 ─────────────────────────────────────────────────────────────
log_step "03 / 08  建立工作目錄"
INSTALL_DIR="${INSTALL_DIR:-/opt/xcloudvlmui}"
mkdir -p \
  "${INSTALL_DIR}/nginx" \
  "${INSTALL_DIR}/mosquitto/config" \
  "${INSTALL_DIR}/mosquitto/data" \
  "${INSTALL_DIR}/mosquitto/log" \
  "${INSTALL_DIR}/backend" \
  "${INSTALL_DIR}/frontend" \
  "${INSTALL_DIR}/models" \
  "${INSTALL_DIR}/scripts" \
  "${INSTALL_DIR}/ssl" \
  "${INSTALL_DIR}/data"
log_ok "安裝目錄：${INSTALL_DIR}"

# ── 複製設定檔 ───────────────────────────────────────────────────────────────
log_step "04 / 08  部署設定檔"

# docker-compose — 替換映像 tag 為版本化名稱（離線映像已載入）
cp "${BASE_DIR}/config/docker-compose.yml"  "${INSTALL_DIR}/docker-compose.yml"
cp "${BASE_DIR}/config/nginx/nginx.conf"    "${INSTALL_DIR}/nginx/nginx.conf"
cp "${BASE_DIR}/config/mosquitto/config/mosquitto.conf" \
                                             "${INSTALL_DIR}/mosquitto/config/mosquitto.conf"
cp "${BASE_DIR}/Makefile"                    "${INSTALL_DIR}/Makefile"
cp -r "${BASE_DIR}/scripts/"*               "${INSTALL_DIR}/scripts/"
cp "${BASE_DIR}/VERSION"                    "${INSTALL_DIR}/VERSION"
log_ok "設定檔部署完成"

# ── 產生 .env 檔案 ───────────────────────────────────────────────────────────
log_step "05 / 08  產生環境設定"

# backend/.env
cat > "${INSTALL_DIR}/backend/.env" <<ENV_EOF
APP_NAME=xCloudVLMui Backend
DEBUG=false
SECRET_KEY=${NEXTAUTH_SECRET}
DATABASE_URL=sqlite+aiosqlite:////data/xcloudvlm.db
CHROMA_PERSIST_DIR=/data/chroma
CHROMA_COLLECTION=maintenance_docs
EMBEDDING_TOP_K=5
LLM_BASE_URL=http://llama-cpp:8080
LLM_MODEL=gemma-4-e4b-it
LLM_MAX_TOKENS=4096
LLM_TEMPERATURE=0.1
EMBED_MODEL=gemma-4-e4b-it
VLM_WEBUI_URL=http://vlm-webui:8090
ALLOWED_ORIGINS=["http://localhost","http://localhost:${FRONTEND_PORT}","http://air-030","http://air-030.local"]
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
MQTT_ENABLED=true
MQTT_BROKER_HOST=mosquitto
MQTT_BROKER_PORT=1883
ENV_EOF
log_ok "backend/.env"

# frontend/.env.local
cat > "${INSTALL_DIR}/frontend/.env.local" <<ENV_EOF
NEXTAUTH_URL=http://localhost:${FRONTEND_PORT}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
NEXT_PUBLIC_API_URL=http://localhost:${FRONTEND_PORT}/api
NEXT_PUBLIC_VLM_WEBUI_URL=http://localhost:${FRONTEND_PORT}/vlm
NODE_ENV=production
ENV_EOF
log_ok "frontend/.env.local"

# ── SSL 憑證 ─────────────────────────────────────────────────────────────────
log_step "06 / 08  產生 TLS 憑證（WebRTC 需要）"
if [[ -f "${INSTALL_DIR}/scripts/gen-ssl.sh" ]]; then
  cd "${INSTALL_DIR}" && bash scripts/gen-ssl.sh 2>/dev/null && \
    log_ok "SSL 憑證已產生" || log_warn "SSL 憑證產生失敗（可手動補齊）"
  cd - >/dev/null
else
  log_warn "找不到 gen-ssl.sh，跳過 SSL 產生"
fi

# ── 模型下載（可跳過）────────────────────────────────────────────────────────
if [[ "$SKIP_MODEL" == "false" ]]; then
  log_step "07 / 08  下載 Gemma 4 E4B GGUF 模型（~4GB）"
  if [[ -f "${INSTALL_DIR}/scripts/download-model.sh" ]]; then
    bash "${INSTALL_DIR}/scripts/download-model.sh" --yes \
      2>&1 | tail -5 || log_warn "模型下載失敗，請手動下載後放入 ${INSTALL_DIR}/models/"
  else
    log_warn "找不到 download-model.sh，請手動放置模型至 ${INSTALL_DIR}/models/"
  fi
else
  log_step "07 / 08  跳過模型下載（--no-model）"
  log_warn "請確認模型已放置於 ${INSTALL_DIR}/models/gemma-4-e4b-it-Q4_K_M.gguf"
fi

# ── 啟動服務 ─────────────────────────────────────────────────────────────────
log_step "08 / 08  啟動服務"
cd "${INSTALL_DIR}"

# 修改 docker-compose.yml 中的 build 指令 → 改為 image 指令（使用已載入映像）
BACKEND_VERSION="${VERSION}"
FRONTEND_VERSION="${VERSION}"
sed -i.bak \
  -e '/build:/{N;/context: \.\/backend/s/.*/    image: xcloudvlmui\/backend:'"${BACKEND_VERSION}"'/}' \
  -e '/build:/{N;/context: \.\/frontend/s/.*/    image: xcloudvlmui\/frontend:'"${FRONTEND_VERSION}"'/}' \
  "${INSTALL_DIR}/docker-compose.yml" 2>/dev/null || true

# 更新前端 port
if [[ "${FRONTEND_PORT}" != "80" ]]; then
  sed -i.bak "s/\"80:80\"/\"${FRONTEND_PORT}:80\"/" "${INSTALL_DIR}/docker-compose.yml" || true
fi

docker compose -f "${INSTALL_DIR}/docker-compose.yml" up -d 2>&1 | tail -20

echo ""
log_ok "====== 安裝完成 ======"
echo ""
printf "${BOLD}存取位址：${NC}\n"
printf "  %-20s http://localhost:${FRONTEND_PORT}\n" "Web 主控台："
printf "  %-20s http://localhost:${FRONTEND_PORT}/api/health\n" "API Health："
printf "  %-20s http://localhost:${FRONTEND_PORT}/docs\n" "Swagger UI："
printf "  %-20s http://localhost:8090\n" "VLM WebUI："
echo ""
printf "${YELLOW}⚠ 首次啟動 llama.cpp 載入 128K context 約需 3-8 分鐘，請耐心等候。${NC}\n"
echo ""
printf "  查看日誌：  docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f\n"
printf "  健康檢查：  bash ${INSTALL_DIR}/scripts/test-services.sh\n"
echo ""
INSTALL_SCRIPT

chmod +x "${RELEASE_DIR}/scripts/install.sh"
log_ok "install.sh 產生完成"

# ── 產生 README.md ────────────────────────────────────────────────────────────
log_step "產生 README.md"
cat > "${RELEASE_DIR}/README.md" <<README_EOF
# xCloudVLMui — 安裝說明

**版本**：v${VERSION}  **建置日期**：${BUILD_DATE}  **目標平台**：${PLATFORM}

---

## 系統需求

| 項目 | 需求 |
|------|------|
| 硬體 | Advantech AIR-030 (Jetson AGX Orin 64GB) |
| OS | JetPack 6.0（Ubuntu 22.04 LTS）|
| CUDA | 12.2.1 |
| Docker | 24.0+ |
| Docker Compose | v2.20+ |
| NVIDIA Container Toolkit | 1.14+ |
| 磁碟空間 | 至少 20GB 可用 |

---

## 一鍵安裝（推薦）

\`\`\`bash
# 解壓安裝包
tar -xzf ${RELEASE_NAME}.tar.gz
cd ${RELEASE_NAME}

# 執行安裝（需要 sudo 建立 /opt/xcloudvlmui/）
sudo bash scripts/install.sh

# 選項
sudo bash scripts/install.sh --port 8080        # 自訂埠號
sudo bash scripts/install.sh --no-model         # 跳過模型下載（已預置）
sudo bash scripts/install.sh --offline          # 完全離線安裝
\`\`\`

---

## 包含映像

| 映像 | 說明 |
|------|------|
| xcloudvlmui/backend:${VERSION} | FastAPI 後端 + SQLite + ChromaDB |
| xcloudvlmui/frontend:${VERSION} | Next.js 前端儀表板 |
$([ "$SKIP_VLM" = "false" ] && echo "| xcloudvlmui/vlm-webui:${VERSION} | Live VLM WebUI (WebRTC) |" || echo "| ~~vlm-webui~~ | 本次打包已跳過 |")
| nginx:1.25-alpine | 反向代理 |
$([ "$SKIP_MQTT" = "false" ] && echo "| eclipse-mosquitto:2 | MQTT Broker |" || echo "| ~~mosquitto~~ | 本次打包已跳過 |")
| python:3.11-slim | 模型下載（model-init）|

---

## 手動操作

\`\`\`bash
cd /opt/xcloudvlmui

# 載入映像（若自動安裝失敗）
for f in images/*.tar.gz; do docker load < "\$f"; done

# 啟動服務
docker compose up -d

# 查看狀態
make status
make test

# 日誌
make logs
\`\`\`

---

## 預設服務埠

| 服務 | 埠號 |
|------|------|
| Nginx（前端入口）| 80 |
| Next.js（直接）| 3000 |
| FastAPI（直接）| 8000 |
| llama.cpp（直接）| 8080 |
| VLM WebUI | 8090 |
| MQTT | 1883 |

---

## 技術架構

\`\`\`
Browser → Nginx :80
             ├── / → Next.js :3000
             ├── /api → FastAPI :8000
             └── /vlm → VLM WebUI :8090

FastAPI → llama.cpp :8080 (Gemma 4 E4B GGUF)
        → ChromaDB (本機)
        → SQLite (本機)
        → Mosquitto MQTT :1883
\`\`\`
README_EOF

log_ok "README.md 產生完成"

# ── 可選：推送至 Registry ─────────────────────────────────────────────────────
if [[ -n "$PUSH_REGISTRY" ]]; then
  log_step "推送映像至 ${PUSH_REGISTRY}"
  for img in "${IMG_BACKEND}" "${IMG_FRONTEND}"; do
    REMOTE="${PUSH_REGISTRY}/$(echo "${img}" | sed 's|xcloudvlmui/||')"
    docker tag "${img}" "${REMOTE}"
    docker push "${REMOTE}" && log_ok "${REMOTE}"
  done
fi

# ── 打包為 .tar.gz ────────────────────────────────────────────────────────────
log_step "打包發布檔案"
cd "${DIST_DIR}"
ARCHIVE="${RELEASE_NAME}.tar.gz"
log_info "壓縮中（可能需要數分鐘）..."
tar -czf "${ARCHIVE}" "${RELEASE_NAME}/"
ARCHIVE_SIZE=$(du -sh "${ARCHIVE}" | cut -f1)
log_ok "打包完成：${DIST_DIR}/${ARCHIVE}（${ARCHIVE_SIZE}）"

# ── 產生 SHA256 checksum ──────────────────────────────────────────────────────
sha256sum "${ARCHIVE}" > "${ARCHIVE}.sha256" 2>/dev/null || \
  shasum -a 256 "${ARCHIVE}" > "${ARCHIVE}.sha256" 2>/dev/null || true
log_ok "SHA256：${ARCHIVE}.sha256"

# ── 完成摘要 ──────────────────────────────────────────────────────────────────
echo ""
printf "${BOLD}${GREEN}"
echo "╔════════════════════════════════════════════════════════╗"
echo "║   ✓  xCloudVLMui 打包完成！                            ║"
echo "╚════════════════════════════════════════════════════════╝"
printf "${NC}"
echo ""
printf "  ${BOLD}版本：${NC}     v${VERSION}\n"
printf "  ${BOLD}平台：${NC}     ${PLATFORM}\n"
printf "  ${BOLD}大小：${NC}     ${ARCHIVE_SIZE}\n"
printf "  ${BOLD}輸出：${NC}     ${DIST_DIR}/${ARCHIVE}\n"
echo ""
printf "  ${YELLOW}部署至 AIR-030：${NC}\n"
printf "    scp ${DIST_DIR}/${ARCHIVE} user@air-030:/tmp/\n"
printf "    ssh user@air-030 'cd /tmp && tar -xzf ${ARCHIVE} && sudo bash ${RELEASE_NAME}/scripts/install.sh'\n"
echo ""
