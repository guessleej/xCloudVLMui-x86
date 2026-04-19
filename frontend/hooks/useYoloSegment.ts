"use client";
/**
 * hooks/useYoloSegment.ts
 * 瀏覽器端 YOLO11n-seg 實例分割 Hook
 *
 * 技術棧：
 *   - 推論引擎：onnxruntime-web（WASM backend）
 *   - 模型：YOLO11n-seg ONNX（COCO 80 類別，640×640 輸入）
 *   - 輸出格式：
 *       output0: [1, 116, 8400] — 116 = 4(bbox) + 1(conf) + 80(classes) + 31(mask_coefs)
 *       output1: [1, 32, 160, 160] — mask prototypes
 *   - 後處理：
 *       1. Transpose output0 [1,116,8400] → [8400,116]
 *       2. 萃取 bbox(0-3)、conf(4)、class_scores(5-84)、mask_coefs(85-115)
 *       3. 信心門檻過濾
 *       4. 前 10 個最高信心目標計算遮罩：sigmoid(mask_coefs @ protos) → 160×160
 *
 * 效能設計：
 *   - 只對前 10 個最高信心偵測計算遮罩（節省運算）
 *   - WASM single-thread，相容所有現代瀏覽器
 *   - busyRef 防止推論堆積
 */

import { useCallback, useRef, useState } from "react";
import { COCO_CLASSES, type ManufacturingRisk, type ManufacturingCategory } from "./useYolo";
import type { YoloDetection } from "./useYolo";

/* ═══════════════════════════════════════════════════════════════════════
   型別定義
════════════════════════════════════════════════════════════════════════ */

/**
 * 實例分割偵測結果
 * 繼承 YoloDetection，額外包含實例遮罩資料
 */
export interface SegmentDetection extends YoloDetection {
  /** 遮罩像素值（Float32Array，形狀 [maskHeight × maskWidth]，值 0~1）*/
  mask?: Float32Array;
  /** 遮罩寬度（像素）*/
  maskWidth: number;
  /** 遮罩高度（像素）*/
  maskHeight: number;
}

export type SegmentStatus = "idle" | "loading" | "ready" | "error";

/* ═══════════════════════════════════════════════════════════════════════
   常數
════════════════════════════════════════════════════════════════════════ */

const INPUT_SIZE    = 640;
const CONF_DEFAULT  = 0.35;
const NUM_CLASSES   = 80;
const NUM_ANCHORS   = 8400;    // output0 的偵測候選數
const NUM_MASK_COEF = 31;      // mask coefficients 數量（output0 的最後 31 維）
const PROTO_DIM     = 32;      // mask prototypes 維度（output1 的 dim-1）
const PROTO_H       = 160;     // mask prototype 高度
const PROTO_W       = 160;     // mask prototype 寬度
const MAX_MASK_DETS = 10;      // 最多計算遮罩的偵測數量

const LOCAL_MODEL  = "/models/yolo11n-seg.onnx";
const REMOTE_MODEL = "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n-seg.onnx";
const WASM_PATH    = "/ort/";

/* ═══════════════════════════════════════════════════════════════════════
   後處理工具
════════════════════════════════════════════════════════════════════════ */

/**
 * Sigmoid 函式
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * 計算單一偵測的實例遮罩
 * mask = sigmoid( mask_coefs(1×31) @ protos(32×160×160) )
 * 注意：output1 為 [1, 32, 160×160]，但模型 coef 為 31，
 * 我們僅使用前 31 個 proto channel
 *
 * @param maskCoefs  31 個遮罩係數
 * @param protos     原始 proto 張量資料 [32 × 160 × 160]，channel-first
 * @param bbox       [x1, y1, x2, y2] 正規化座標（用於裁剪）
 * @returns          Float32Array 形狀 [160 × 160]
 */
function computeMask(
  maskCoefs: Float32Array,
  protos: Float32Array,
  bbox: [number, number, number, number],
): Float32Array {
  const mask = new Float32Array(PROTO_H * PROTO_W);
  const protoPixels = PROTO_H * PROTO_W;

  // 矩陣乘法：mask[h,w] = sum_k( maskCoefs[k] * protos[k, h*W + w] )
  // 僅使用前 NUM_MASK_COEF 個 channel
  const numCoef = Math.min(maskCoefs.length, NUM_MASK_COEF);
  for (let k = 0; k < numCoef; k++) {
    const coef       = maskCoefs[k];
    const protoOffset = k * protoPixels;
    for (let p = 0; p < protoPixels; p++) {
      mask[p] += coef * protos[protoOffset + p];
    }
  }

  // Sigmoid + bbox 裁剪
  const x1 = Math.floor(bbox[0] * PROTO_W);
  const y1 = Math.floor(bbox[1] * PROTO_H);
  const x2 = Math.ceil(bbox[2]  * PROTO_W);
  const y2 = Math.ceil(bbox[3]  * PROTO_H);

  for (let y = 0; y < PROTO_H; y++) {
    for (let x = 0; x < PROTO_W; x++) {
      const idx = y * PROTO_W + x;
      // bbox 外部設為 0，bbox 內部套用 sigmoid
      if (x < x1 || x >= x2 || y < y1 || y >= y2) {
        mask[idx] = 0;
      } else {
        mask[idx] = sigmoid(mask[idx]);
      }
    }
  }

  return mask;
}

/**
 * 依風險等級排序（critical > warning > safe > info）
 */
function sortByRisk(dets: SegmentDetection[]): SegmentDetection[] {
  const riskOrder: Record<ManufacturingRisk, number> = { critical: 0, warning: 1, safe: 2, info: 3 };
  return dets.sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk]);
}

/* ═══════════════════════════════════════════════════════════════════════
   主 Hook
════════════════════════════════════════════════════════════════════════ */

/**
 * YOLO11n-seg 實例分割 Hook
 *
 * 使用方式與 useYolo.ts 相同，額外提供每個偵測目標的實例遮罩。
 * @example
 *   const { status, loadModel, detect } = useYoloSegment();
 *   await loadModel();
 *   const dets = await detect(videoEl);
 */
export function useYoloSegment() {
  const [status,    setStatus]    = useState<SegmentStatus>("idle");
  const [modelPath, setModelPath] = useState<string>("");
  const [loadError, setLoadError] = useState<string>("");

  const sessionRef   = useRef<any>(null);
  const busyRef      = useRef(false);
  const offscreenRef = useRef<OffscreenCanvas | HTMLCanvasElement | null>(null);

  /* ── 模型載入 ────────────────────────────────────────────────────── */
  const loadModel = useCallback(async () => {
    if (status !== "idle" && status !== "error") return;
    setStatus("loading");
    setLoadError("");

    try {
      const ort = await import("onnxruntime-web");
      ort.env.wasm.wasmPaths  = WASM_PATH;
      ort.env.wasm.numThreads = 1;

      if (!offscreenRef.current) {
        if (typeof OffscreenCanvas !== "undefined") {
          offscreenRef.current = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
        } else {
          const c = document.createElement("canvas");
          c.width = c.height = INPUT_SIZE;
          offscreenRef.current = c;
        }
      }

      let session: any;
      let usedPath = LOCAL_MODEL;
      try {
        session = await ort.InferenceSession.create(LOCAL_MODEL, {
          executionProviders:     ["wasm"],
          graphOptimizationLevel: "all",
        });
      } catch {
        console.warn("[YOLOSeg] 本機模型未找到，嘗試 GitHub CDN…");
        usedPath = REMOTE_MODEL;
        session = await ort.InferenceSession.create(REMOTE_MODEL, {
          executionProviders:     ["wasm"],
          graphOptimizationLevel: "all",
        });
      }

      sessionRef.current = session;
      setModelPath(usedPath.startsWith("http") ? "CDN" : "本機");
      setStatus("ready");
      console.info("[YOLOSeg] yolo11n-seg loaded ✓");
    } catch (err: any) {
      console.error("[YOLOSeg] 載入失敗：", err);
      setLoadError(err?.message ?? "未知錯誤");
      setStatus("error");
    }
  }, [status]);

  /* ── 單幀實例分割推論 ────────────────────────────────────────────── */
  const detect = useCallback(
    async (video: HTMLVideoElement): Promise<SegmentDetection[]> => {
      if (!sessionRef.current || busyRef.current) return [];
      if (!video || video.videoWidth === 0 || video.videoHeight === 0) return [];

      busyRef.current = true;
      try {
        const ort = await import("onnxruntime-web");

        // ── 前處理：縮放至 640×640，轉 CHW float32 ──
        const canvas = offscreenRef.current!;
        const ctx = (canvas as OffscreenCanvas).getContext
          ? (canvas as OffscreenCanvas).getContext("2d") as OffscreenCanvasRenderingContext2D
          : (canvas as HTMLCanvasElement).getContext("2d")!;
        ctx.drawImage(video, 0, 0, INPUT_SIZE, INPUT_SIZE);
        const raw    = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
        const stride = INPUT_SIZE * INPUT_SIZE;
        const tensor = new Float32Array(3 * stride);
        for (let i = 0; i < stride; i++) {
          tensor[i]              = raw[i * 4]     / 255;
          tensor[stride + i]     = raw[i * 4 + 1] / 255;
          tensor[2 * stride + i] = raw[i * 4 + 2] / 255;
        }

        // ── 推論 ──
        const input   = new ort.Tensor("float32", tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]);
        const results = await sessionRef.current.run({ images: input });

        // 取得兩個輸出張量
        const keys    = Object.keys(results);
        // output0: [1, 116, 8400]（偵測）, output1: [1, 32, 160, 160]（proto）
        const out0Key = keys[0];
        const out1Key = keys[1];
        const data0   = results[out0Key].data as Float32Array;  // [1, 116, 8400]
        const data1   = results[out1Key]?.data as Float32Array | undefined;  // [1, 32, 160, 160]

        // ── 後處理 Step 1：Transpose [1,116,8400] → [8400,116] ──
        // data0 布局：channel-first，data0[c * 8400 + a] = anchor a 的第 c 維
        const rawDets: Array<{
          det: SegmentDetection;
          maskCoefs: Float32Array;
          bbox4: [number, number, number, number]; // [x1,y1,x2,y2] 正規化
        }> = [];

        for (let a = 0; a < NUM_ANCHORS; a++) {
          // 讀取 bbox（cx, cy, w, h）— 索引 [0..3, a]
          const cx = data0[0 * NUM_ANCHORS + a];
          const cy = data0[1 * NUM_ANCHORS + a];
          const bw = data0[2 * NUM_ANCHORS + a];
          const bh = data0[3 * NUM_ANCHORS + a];

          // 讀取目標信心度（索引 4）
          const objConf = data0[4 * NUM_ANCHORS + a];
          if (objConf < CONF_DEFAULT * 0.5) continue;  // 快速過濾

          // 讀取 80 個類別分數（索引 5~84）
          let maxClassConf = 0;
          let classId      = 0;
          for (let c = 0; c < NUM_CLASSES; c++) {
            const cs = data0[(5 + c) * NUM_ANCHORS + a];
            if (cs > maxClassConf) {
              maxClassConf = cs;
              classId      = c;
            }
          }

          // 最終信心度 = obj_conf * class_conf
          const conf = objConf * maxClassConf;
          const meta = COCO_CLASSES[classId];
          const threshold = meta?.confThresh ?? CONF_DEFAULT;
          if (conf < threshold) continue;

          // 轉換為 xyxy 正規化座標
          const x1 = Math.max(0, (cx - bw / 2) / INPUT_SIZE);
          const y1 = Math.max(0, (cy - bh / 2) / INPUT_SIZE);
          const x2 = Math.min(1, (cx + bw / 2) / INPUT_SIZE);
          const y2 = Math.min(1, (cy + bh / 2) / INPUT_SIZE);
          if (x2 <= x1 || y2 <= y1) continue;

          // 讀取 mask_coefs（索引 85~115，共 31 個）
          const maskCoefs = new Float32Array(NUM_MASK_COEF);
          for (let k = 0; k < NUM_MASK_COEF; k++) {
            maskCoefs[k] = data0[(85 + k) * NUM_ANCHORS + a];
          }

          rawDets.push({
            det: {
              classId,
              className:  meta?.zh       ?? `cls${classId}`,
              classEn:    meta?.en       ?? `cls${classId}`,
              confidence: conf,
              x: x1, y: y1,
              w: x2 - x1,
              h: y2 - y1,
              risk:     meta?.risk     ?? "info",
              category: meta?.category ?? "other",
              maskWidth:  PROTO_W,
              maskHeight: PROTO_H,
            } as SegmentDetection,
            maskCoefs,
            bbox4: [x1, y1, x2, y2],
          });
        }

        // ── Step 2：依信心度降序排列，取前 MAX_MASK_DETS 計算遮罩 ──
        rawDets.sort((a, b) => b.det.confidence - a.det.confidence);

        // 應用 NMS（簡單版，相同類別 IoU > 0.5 則保留較高信心者）
        const kept: typeof rawDets = [];
        const suppressed = new Set<number>();
        for (let i = 0; i < rawDets.length; i++) {
          if (suppressed.has(i)) continue;
          kept.push(rawDets[i]);
          for (let j = i + 1; j < rawDets.length; j++) {
            if (suppressed.has(j)) continue;
            if (rawDets[i].det.classId !== rawDets[j].det.classId) continue;
            // 計算 IoU
            const a = rawDets[i].bbox4;
            const b = rawDets[j].bbox4;
            const ix1 = Math.max(a[0], b[0]);
            const iy1 = Math.max(a[1], b[1]);
            const ix2 = Math.min(a[2], b[2]);
            const iy2 = Math.min(a[3], b[3]);
            if (ix2 > ix1 && iy2 > iy1) {
              const inter = (ix2 - ix1) * (iy2 - iy1);
              const areaA = (a[2] - a[0]) * (a[3] - a[1]);
              const areaB = (b[2] - b[0]) * (b[3] - b[1]);
              const iou   = inter / (areaA + areaB - inter);
              if (iou > 0.5) suppressed.add(j);
            }
          }
        }

        // ── Step 3：計算遮罩（僅前 MAX_MASK_DETS 個）──
        const finalDets: SegmentDetection[] = [];
        for (let i = 0; i < kept.length; i++) {
          const item = kept[i];
          if (i < MAX_MASK_DETS && data1) {
            // protos 布局：[1, 32, 160, 160]，channel-first
            // data1[k * 160 * 160 + h * 160 + w]
            item.det.mask = computeMask(item.maskCoefs, data1, item.bbox4);
          }
          finalDets.push(item.det);
        }

        // ── 依風險排序 ──
        return sortByRisk(finalDets);
      } catch (err) {
        console.error("[YOLOSeg] 推論錯誤：", err);
        return [];
      } finally {
        busyRef.current = false;
      }
    },
    [],
  );

  /* ── 卸載模型 ────────────────────────────────────────────────────── */
  const reset = useCallback(() => {
    try { sessionRef.current?.release?.(); } catch {}
    sessionRef.current   = null;
    offscreenRef.current = null;
    setStatus("idle");
    setModelPath("");
    setLoadError("");
  }, []);

  return { status, modelPath, loadError, loadModel, detect, reset };
}
