FROM node:20-alpine AS base

# ── 依賴安裝階段 ──────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps --frozen-lockfile 2>/dev/null || \
    npm install --legacy-peer-deps

# ── 建置階段 ──────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# ── 複製 onnxruntime-web WASM 執行期檔案 → public/ort/
#    前端在瀏覽器呼叫 ort.env.wasm.wasmPaths = '/ort/' 時使用
RUN mkdir -p public/ort && \
    cp node_modules/onnxruntime-web/dist/*.wasm public/ort/ 2>/dev/null || \
    echo "[WASM] No .wasm files found (will use CDN fallback)"

# ── 複製 YOLO26n ONNX 模型（opset 12，由 macOS host 預先匯出）──────────
#    匯出指令（在 macOS host 執行）：
#      python3 -c "from ultralytics import YOLO; m=YOLO('yolo26n.pt'); m.export(format='onnx',opset=12,imgsz=640,simplify=False)"
#      mv yolo26n.onnx frontend/public/models/yolo26n.onnx
RUN mkdir -p public/models
COPY public/models/ public/models/
RUN if [ -f "public/models/yolo26n.onnx" ]; then \
      echo "[YOLO26] Model found: $(wc -c < public/models/yolo26n.onnx) bytes (E2E format, opset=12)"; \
    else \
      echo "[YOLO26] No pre-built model — CDN fallback will be used at runtime"; \
    fi

# 建置 Next.js
ENV NEXT_TELEMETRY_DISABLED 1
RUN npm run build

# ── 執行階段 ──────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

COPY --from=builder /app/public                  ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT 3000

CMD ["node", "server.js"]
