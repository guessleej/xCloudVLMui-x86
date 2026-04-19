#!/usr/bin/env bash
###############################################################################
# test-services.sh — 驗證所有服務是否正常運行
###############################################################################
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

PASS=0; FAIL=0

check() {
  local name="$1"; local url="$2"; local expect="${3:-200}"
  local code
  code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
  if [[ "$code" == "$expect" || ("$expect" == "200" && "$code" =~ ^2) ]]; then
    echo -e "  ${GREEN}✓${NC} ${name} → HTTP ${code}"
    ((PASS++))
  else
    echo -e "  ${RED}✗${NC} ${name} → HTTP ${code} (期待 ${expect})"
    ((FAIL++))
  fi
}

json_check() {
  local name="$1"; local url="$2"; local key="$3"
  local result
  result=$(curl -sk --max-time 10 "$url" 2>/dev/null || echo "{}")
  if echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); assert '$key' in d" 2>/dev/null; then
    local val
    val=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$key','?'))" 2>/dev/null)
    echo -e "  ${GREEN}✓${NC} ${name} → ${key}=${val}"
    ((PASS++))
  else
    echo -e "  ${RED}✗${NC} ${name} → 回應缺少 '${key}' 欄位"
    ((FAIL++))
  fi
}

echo -e "\n${BLUE}══════════════════════════════════════════${NC}"
echo -e "${BLUE}  xCloudVLMUI 服務健康檢查${NC}"
echo -e "${BLUE}══════════════════════════════════════════${NC}\n"

# ── llama.cpp ─────────────────────────────────────────────────────
echo -e "${YELLOW}[1/5] llama.cpp Server (:8080)${NC}"
check   "Health Endpoint"  "http://localhost:8080/health"
json_check "Models List"   "http://localhost:8080/v1/models" "data"

# ── 推論測試 ──────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[2/5] Gemma 4 E4B 推論測試${NC}"
echo -ne "  ${BLUE}►${NC} 呼叫 /v1/chat/completions（約 10-30 秒）... "
INFER_RESULT=$(curl -sk --max-time 60 \
  -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemma-4-e4b-it","messages":[{"role":"user","content":"回覆OK"}],"max_tokens":5}' \
  2>/dev/null || echo "{}")
if echo "$INFER_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('choices')" 2>/dev/null; then
  echo -e "${GREEN}✓ 推論正常${NC}"
  ((PASS++))
else
  echo -e "${RED}✗ 推論失敗${NC}"
  ((FAIL++))
fi

# ── FastAPI Backend ───────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[3/5] FastAPI Backend (:8000)${NC}"
check      "Root Endpoint"    "http://localhost:8000/"
json_check "Health Check"     "http://localhost:8000/api/health"  "status"
check      "Dashboard API"    "http://localhost:8000/api/dashboard/summary"
check      "Swagger Docs"     "http://localhost:8000/docs"

# ── live-vlm-webui ────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[4/5] live-vlm-webui (:8090)${NC}"
check "WebUI Root"  "http://localhost:8090/"

# ── Next.js Frontend ──────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[5/5] Next.js Frontend (:3000 / nginx :80)${NC}"
check "Frontend :3000"     "http://localhost:3000/"
check "Via Nginx :80"      "http://localhost/"
check "API via Nginx"      "http://localhost/api/health"

# ── 結果摘要 ─────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}══════════════════════════════════════════${NC}"
TOTAL=$((PASS + FAIL))
if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}✓ 全部通過 ${PASS}/${TOTAL}${NC}"
else
  echo -e "${YELLOW}結果：${GREEN}${PASS} 通過${NC} / ${RED}${FAIL} 失敗${NC} / 共 ${TOTAL}"
fi
echo -e "${BLUE}══════════════════════════════════════════${NC}\n"

[[ $FAIL -eq 0 ]] || exit 1
