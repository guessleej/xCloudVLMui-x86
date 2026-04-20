"use client";
/**
 * hooks/useYolo.ts
 * 瀏覽器端 YOLO26n 即時物件偵測 Hook（製造業優化版）
 *
 * 技術棧：
 *   - 推論引擎：onnxruntime-web 1.21.0 (WASM backend, opset 12 模型)
 *   - 模型：YOLO26n ONNX（COCO 80 類別，640×640 輸入）
 *   - 後處理：E2E [1, 300, 6] 格式 — [x1,y1,x2,y2,conf,cls_id]，內建 NMS 無需後處理 NMS
 *
 * YOLO26 vs YOLO11 改進（v8.4.0, Jan 2026）：
 *   - 參數量：2.4M（vs YOLO11n 2.6M）— 更精簡
 *   - mAP50-95：40.9（vs YOLO11n 39.5）— 精度提升
 *   - 推論速度：約 43% 更快（ONNX CPU）
 *   - One-to-One E2E Head：內建 NMS，輸出 [1, 300, 6] 無需手動 NMS
 *
 * 製造業優化：
 *   1. 風險分級（ManufacturingRisk）：critical > warning > safe > info
 *   2. 類別分類（ManufacturingCategory）：personnel / vehicle / hazard / equipment / product / other
 *   3. 類別動態信心門檻：人員 0.25（高敏感）、無關食物 0.55（低敏感）
 *   4. E2E 輸出直接過濾，不需 classwise NMS（模型已處理）
 *
 * 效能設計：
 *   - WASM single-thread，相容所有現代瀏覽器
 *   - busyRef 防止推論堆積
 *   - OffscreenCanvas 減少主執行緒開銷
 */

import { useCallback, useRef, useState } from "react";

/* ═══════════════════════════════════════════════════════════════════════
   製造業風險分類型別
════════════════════════════════════════════════════════════════════════ */

/** 製造業風險等級（由高到低）*/
export type ManufacturingRisk = "critical" | "warning" | "safe" | "info";

/** 製造業物件類別 */
export type ManufacturingCategory =
  | "personnel"   // 人員 — 工安最高優先
  | "vehicle"     // 車輛 — 叉車/卡車/機動設備
  | "hazard"      // 危險物品 — 刀具/剪刀
  | "equipment"   // 設備 — 筆電/鍵盤/電視/電話
  | "product"     // 產品/物料 — 瓶子/箱子等
  | "other";      // 其他背景物件

/* ═══════════════════════════════════════════════════════════════════════
   COCO 80 類別（含製造業元數據）
════════════════════════════════════════════════════════════════════════ */

interface CocoClassMeta {
  zh:           string;
  en:           string;
  risk:         ManufacturingRisk;
  category:     ManufacturingCategory;
  confThresh?:  number;   // 覆蓋預設門檻（未設定則用 CONF_DEFAULT）
}

export const COCO_CLASSES: CocoClassMeta[] = [
  // ── 人員 ──────────────────────────────────────────────────────────────
  // ⚠ risk: "warning"（非 critical）— 人員出現是正常工廠情境，屬於「需留意」而非「高危緊急」
  // critical 升級條件由 VLM 或 Pose 模型判斷（PPE 缺失 / 危險姿態 / 進入禁區）
  { zh: "人員",       en: "person",         risk: "warning",  category: "personnel", confThresh: 0.30 }, // 0

  // ── 車輛 ──────────────────────────────────────────────────────────────
  { zh: "自行車",     en: "bicycle",        risk: "warning",  category: "vehicle",   confThresh: 0.30 }, // 1
  { zh: "汽車",       en: "car",            risk: "warning",  category: "vehicle",   confThresh: 0.28 }, // 2
  { zh: "機車",       en: "motorcycle",     risk: "warning",  category: "vehicle",   confThresh: 0.28 }, // 3
  { zh: "飛機",       en: "airplane",       risk: "info",     category: "other",     confThresh: 0.50 }, // 4
  { zh: "公車",       en: "bus",            risk: "critical", category: "vehicle",   confThresh: 0.25 }, // 5
  { zh: "火車",       en: "train",          risk: "warning",  category: "vehicle",   confThresh: 0.30 }, // 6
  { zh: "卡車",       en: "truck",          risk: "critical", category: "vehicle",   confThresh: 0.25 }, // 7
  { zh: "船",         en: "boat",           risk: "info",     category: "other",     confThresh: 0.50 }, // 8
  { zh: "號誌燈",     en: "traffic light",  risk: "warning",  category: "equipment", confThresh: 0.40 }, // 9

  // ── 工業設施 ─────────────────────────────────────────────────────────
  { zh: "消防栓",     en: "fire hydrant",   risk: "warning",  category: "equipment", confThresh: 0.35 }, // 10
  { zh: "停車標誌",   en: "stop sign",      risk: "info",     category: "other",     confThresh: 0.50 }, // 11
  { zh: "停車計時器", en: "parking meter",  risk: "info",     category: "other",     confThresh: 0.55 }, // 12
  { zh: "長椅",       en: "bench",          risk: "safe",     category: "equipment", confThresh: 0.45 }, // 13

  // ── 動物（工廠場景罕見，高門檻）────────────────────────────────────
  { zh: "鳥",         en: "bird",           risk: "info",     category: "other",     confThresh: 0.55 }, // 14
  { zh: "貓",         en: "cat",            risk: "info",     category: "other",     confThresh: 0.55 }, // 15
  { zh: "狗",         en: "dog",            risk: "warning",  category: "other",     confThresh: 0.45 }, // 16
  { zh: "馬",         en: "horse",          risk: "info",     category: "other",     confThresh: 0.55 }, // 17
  { zh: "羊",         en: "sheep",          risk: "info",     category: "other",     confThresh: 0.55 }, // 18
  { zh: "牛",         en: "cow",            risk: "info",     category: "other",     confThresh: 0.55 }, // 19
  { zh: "大象",       en: "elephant",       risk: "info",     category: "other",     confThresh: 0.55 }, // 20
  { zh: "熊",         en: "bear",           risk: "info",     category: "other",     confThresh: 0.55 }, // 21
  { zh: "斑馬",       en: "zebra",          risk: "info",     category: "other",     confThresh: 0.55 }, // 22
  { zh: "長頸鹿",     en: "giraffe",        risk: "info",     category: "other",     confThresh: 0.55 }, // 23

  // ── 個人物品 ─────────────────────────────────────────────────────────
  { zh: "背包",       en: "backpack",       risk: "safe",     category: "product",   confThresh: 0.40 }, // 24
  { zh: "雨傘",       en: "umbrella",       risk: "safe",     category: "other",     confThresh: 0.45 }, // 25
  { zh: "手提包",     en: "handbag",        risk: "safe",     category: "product",   confThresh: 0.45 }, // 26
  { zh: "領帶",       en: "tie",            risk: "info",     category: "other",     confThresh: 0.55 }, // 27
  { zh: "行李箱",     en: "suitcase",       risk: "safe",     category: "product",   confThresh: 0.40 }, // 28

  // ── 運動/休閒（工廠無關，高門檻）────────────────────────────────────
  { zh: "飛盤",       en: "frisbee",        risk: "info",     category: "other",     confThresh: 0.55 }, // 29
  { zh: "滑雪板",     en: "skis",           risk: "info",     category: "other",     confThresh: 0.55 }, // 30
  { zh: "雪板",       en: "snowboard",      risk: "info",     category: "other",     confThresh: 0.55 }, // 31
  { zh: "運動球",     en: "sports ball",    risk: "info",     category: "other",     confThresh: 0.55 }, // 32
  { zh: "風箏",       en: "kite",           risk: "info",     category: "other",     confThresh: 0.55 }, // 33
  { zh: "棒球棒",     en: "baseball bat",   risk: "warning",  category: "hazard",    confThresh: 0.35 }, // 34  ← 潛在危險
  { zh: "棒球手套",   en: "baseball glove", risk: "info",     category: "other",     confThresh: 0.55 }, // 35
  { zh: "滑板",       en: "skateboard",     risk: "info",     category: "other",     confThresh: 0.55 }, // 36
  { zh: "衝浪板",     en: "surfboard",      risk: "info",     category: "other",     confThresh: 0.55 }, // 37
  { zh: "網球拍",     en: "tennis racket",  risk: "info",     category: "other",     confThresh: 0.55 }, // 38

  // ── 產品/容器 ────────────────────────────────────────────────────────
  { zh: "瓶子",       en: "bottle",         risk: "safe",     category: "product",   confThresh: 0.35 }, // 39  ← 生產線常見
  { zh: "高腳杯",     en: "wine glass",     risk: "safe",     category: "product",   confThresh: 0.45 }, // 40
  { zh: "杯子",       en: "cup",            risk: "safe",     category: "product",   confThresh: 0.40 }, // 41

  // ── 刀具 ─────────────────────────────────────────────────────────────
  { zh: "叉子",       en: "fork",           risk: "safe",     category: "other",     confThresh: 0.50 }, // 42
  { zh: "刀子",       en: "knife",          risk: "critical", category: "hazard",    confThresh: 0.30 }, // 43  ★ 工安危險
  { zh: "湯匙",       en: "spoon",          risk: "safe",     category: "other",     confThresh: 0.55 }, // 44
  { zh: "碗",         en: "bowl",           risk: "safe",     category: "product",   confThresh: 0.50 }, // 45

  // ── 食物（工廠場景低相關，高門檻）───────────────────────────────────
  { zh: "香蕉",       en: "banana",         risk: "info",     category: "product",   confThresh: 0.55 }, // 46
  { zh: "蘋果",       en: "apple",          risk: "info",     category: "product",   confThresh: 0.55 }, // 47
  { zh: "三明治",     en: "sandwich",       risk: "info",     category: "product",   confThresh: 0.55 }, // 48
  { zh: "柳橙",       en: "orange",         risk: "info",     category: "product",   confThresh: 0.55 }, // 49
  { zh: "花椰菜",     en: "broccoli",       risk: "info",     category: "product",   confThresh: 0.55 }, // 50
  { zh: "胡蘿蔔",     en: "carrot",         risk: "info",     category: "product",   confThresh: 0.55 }, // 51
  { zh: "熱狗",       en: "hot dog",        risk: "info",     category: "product",   confThresh: 0.55 }, // 52
  { zh: "披薩",       en: "pizza",          risk: "info",     category: "product",   confThresh: 0.55 }, // 53
  { zh: "甜甜圈",     en: "donut",          risk: "info",     category: "product",   confThresh: 0.55 }, // 54
  { zh: "蛋糕",       en: "cake",           risk: "info",     category: "product",   confThresh: 0.55 }, // 55

  // ── 辦公/廠房家具 ────────────────────────────────────────────────────
  { zh: "椅子",       en: "chair",          risk: "safe",     category: "equipment", confThresh: 0.40 }, // 56
  { zh: "沙發",       en: "couch",          risk: "safe",     category: "equipment", confThresh: 0.45 }, // 57
  { zh: "盆栽",       en: "potted plant",   risk: "info",     category: "other",     confThresh: 0.55 }, // 58
  { zh: "床",         en: "bed",            risk: "info",     category: "other",     confThresh: 0.55 }, // 59
  { zh: "餐桌",       en: "dining table",   risk: "safe",     category: "equipment", confThresh: 0.40 }, // 60
  { zh: "馬桶",       en: "toilet",         risk: "info",     category: "other",     confThresh: 0.55 }, // 61

  // ── 電子設備 ─────────────────────────────────────────────────────────
  { zh: "電視",       en: "tv",             risk: "safe",     category: "equipment", confThresh: 0.40 }, // 62
  { zh: "筆電",       en: "laptop",         risk: "safe",     category: "equipment", confThresh: 0.35 }, // 63
  { zh: "滑鼠",       en: "mouse",          risk: "safe",     category: "equipment", confThresh: 0.40 }, // 64
  { zh: "遙控器",     en: "remote",         risk: "safe",     category: "equipment", confThresh: 0.45 }, // 65
  { zh: "鍵盤",       en: "keyboard",       risk: "safe",     category: "equipment", confThresh: 0.40 }, // 66
  // ⚠ confThresh 0.65：AirPods 盒 / 遙控器 / 其他小型方盒易誤判為手機
  //   真實手機信心通常 > 0.65；低信心偵測幾乎全為誤判
  { zh: "手機",       en: "cell phone",     risk: "warning",  category: "equipment", confThresh: 0.65 }, // 67  ← 工作中使用手機
  { zh: "微波爐",     en: "microwave",      risk: "safe",     category: "equipment", confThresh: 0.45 }, // 68
  { zh: "烤箱",       en: "oven",           risk: "warning",  category: "equipment", confThresh: 0.35 }, // 69  ← 高溫設備
  { zh: "烤麵包機",   en: "toaster",        risk: "safe",     category: "equipment", confThresh: 0.50 }, // 70
  { zh: "水槽",       en: "sink",           risk: "safe",     category: "equipment", confThresh: 0.45 }, // 71
  { zh: "冰箱",       en: "refrigerator",   risk: "safe",     category: "equipment", confThresh: 0.45 }, // 72

  // ── 其他物品 ─────────────────────────────────────────────────────────
  { zh: "書本",       en: "book",           risk: "safe",     category: "product",   confThresh: 0.50 }, // 73
  { zh: "時鐘",       en: "clock",          risk: "safe",     category: "equipment", confThresh: 0.45 }, // 74
  { zh: "花瓶",       en: "vase",           risk: "safe",     category: "product",   confThresh: 0.55 }, // 75
  { zh: "剪刀",       en: "scissors",       risk: "warning",  category: "hazard",    confThresh: 0.30 }, // 76  ← 工安相關
  { zh: "玩具熊",     en: "teddy bear",     risk: "info",     category: "other",     confThresh: 0.55 }, // 77
  { zh: "吹風機",     en: "hair drier",     risk: "safe",     category: "equipment", confThresh: 0.50 }, // 78
  { zh: "牙刷",       en: "toothbrush",     risk: "info",     category: "other",     confThresh: 0.55 }, // 79
];

/* ═══════════════════════════════════════════════════════════════════════
   型別定義
════════════════════════════════════════════════════════════════════════ */

export interface YoloDetection {
  classId:    number;
  className:  string;             // 中文
  classEn:    string;             // 英文
  confidence: number;             // 0 ~ 1
  x: number; y: number;          // 左上角，正規化 0 ~ 1
  w: number; h: number;          // 寬高，正規化 0 ~ 1
  risk:       ManufacturingRisk;
  category:   ManufacturingCategory;
}

/** 製造業統計摘要 */
export interface ManufacturingStats {
  personnelCount: number;   // 偵測到的人員數量
  vehicleCount:   number;   // 車輛數量
  hazardCount:    number;   // 危險物品數量
  criticalItems:  string[]; // 高危類別清單
}

export type YoloStatus = "idle" | "loading" | "ready" | "error";

/* ═══════════════════════════════════════════════════════════════════════
   常數
════════════════════════════════════════════════════════════════════════ */

const INPUT_SIZE    = 640;
const CONF_DEFAULT  = 0.35;   // YOLO26n E2E 輸出已過 NMS，門檻可略微降低
const NUM_CLASSES   = 80;
const NUM_MAX_DETS  = 300;    // YOLO26n One-to-One E2E Head：最多 300 個偵測結果

const LOCAL_MODEL  = "/models/yolo26n.onnx";
// YOLO26n ONNX CDN（v8.4.0 release，opset 12）— 若本機模型不存在時使用
const REMOTE_MODEL = "https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26n.onnx";
const WASM_PATH    = "/ort/";

/* ═══════════════════════════════════════════════════════════════════════
   YOLO26n E2E 後處理工具
   YOLO26n 使用 One-to-One Head，ONNX 輸出格式為 [1, 300, 6]：
     dim-0 = batch (固定 1)
     dim-1 = max_detections (最多 300 個)
     dim-2 = [x1, y1, x2, y2, confidence, class_id]（pixel 座標 0~640）
   模型已內建 NMS，無需手動 NMS，僅需信心門檻過濾 + 座標正規化
════════════════════════════════════════════════════════════════════════ */

/** 依風險等級排序（critical > warning > safe > info）*/
function sortByRisk(dets: YoloDetection[]): YoloDetection[] {
  const riskOrder: Record<ManufacturingRisk, number> = { critical: 0, warning: 1, safe: 2, info: 3 };
  return dets.sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk]);
}

/** 從偵測結果計算製造業統計摘要 */
export function calcManufacturingStats(dets: YoloDetection[]): ManufacturingStats {
  const criticalItems = new Set<string>();
  let personnelCount = 0;
  let vehicleCount   = 0;
  let hazardCount    = 0;

  for (const d of dets) {
    if (d.category === "personnel") personnelCount++;
    if (d.category === "vehicle")   vehicleCount++;
    if (d.category === "hazard")    hazardCount++;
    if (d.risk === "critical")      criticalItems.add(d.className);
  }

  return { personnelCount, vehicleCount, hazardCount, criticalItems: Array.from(criticalItems) };
}

/* ═══════════════════════════════════════════════════════════════════════
   主 Hook
════════════════════════════════════════════════════════════════════════ */

export function useYolo() {
  const [status,    setStatus]    = useState<YoloStatus>("idle");
  const [modelPath, setModelPath] = useState<string>("");
  const [loadError, setLoadError] = useState<string>("");

  const sessionRef   = useRef<any>(null);
  const busyRef      = useRef(false);
  const offscreenRef = useRef<OffscreenCanvas | HTMLCanvasElement | null>(null);

  /* ── 模型載入 ────────────────────────────────────────────────────── */
  const loadModel = useCallback(async () => {
    // 允許從 idle 或 error 狀態重試（error 狀態先重置）
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
          executionProviders:    ["wasm"],
          graphOptimizationLevel: "all",
        });
      } catch {
        console.warn("[YOLO] 本機模型未找到，嘗試 GitHub CDN…");
        usedPath = REMOTE_MODEL;
        session = await ort.InferenceSession.create(REMOTE_MODEL, {
          executionProviders:    ["wasm"],
          graphOptimizationLevel: "all",
        });
      }

      sessionRef.current = session;
      setModelPath(usedPath.startsWith("http") ? "CDN" : "本機");
      setStatus("ready");
    } catch (err: any) {
      console.error("[YOLO] 載入失敗：", err);
      setLoadError(err?.message ?? "未知錯誤");
      setStatus("error");
    }
  }, [status]);

  /* ── 單幀推論（製造業優化後處理）───────────────────────────────────── */
  const detect = useCallback(async (video: HTMLVideoElement): Promise<YoloDetection[]> => {
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
      const raw = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;

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
      const outKey  = Object.keys(results)[0];
      const data    = results[outKey].data as Float32Array;

      // ── 後處理：YOLO26n E2E [1, 300, 6] 格式（製造業動態門檻）──
      // data 佈局：[det0_x1, det0_y1, det0_x2, det0_y2, det0_conf, det0_cls,
      //             det1_x1, det1_y1, ..., det299_cls]
      // 每個偵測 6 個值，座標為像素空間 [0, INPUT_SIZE]
      // 模型已內建 NMS，無需手動抑制，直接過濾信心門檻
      const rawDets: YoloDetection[] = [];

      for (let i = 0; i < NUM_MAX_DETS; i++) {
        const base = i * 6;
        const conf    = data[base + 4];
        if (conf <= 0) continue;  // 無效 padding 偵測

        const classId = Math.round(data[base + 5]);
        if (classId < 0 || classId >= NUM_CLASSES) continue;

        // 取得此類別的製造業元數據與動態門檻
        const meta      = COCO_CLASSES[classId];
        const threshold = meta?.confThresh ?? CONF_DEFAULT;
        if (conf < threshold) continue;

        // xyxy pixel → 正規化 0~1
        const x1 = Math.max(0, data[base + 0]) / INPUT_SIZE;
        const y1 = Math.max(0, data[base + 1]) / INPUT_SIZE;
        const x2 = Math.min(1, data[base + 2] / INPUT_SIZE);
        const y2 = Math.min(1, data[base + 3] / INPUT_SIZE);

        if (x2 <= x1 || y2 <= y1) continue;

        rawDets.push({
          classId,
          className:  meta?.zh ?? `cls${classId}`,
          classEn:    meta?.en ?? `cls${classId}`,
          confidence: conf,
          x: x1, y: y1,
          w: x2 - x1,
          h: y2 - y1,
          risk:     meta?.risk     ?? "info",
          category: meta?.category ?? "other",
        });
      }

      // ── E2E 無需 NMS，直接按風險排序 ──
      return sortByRisk(rawDets);
    } catch (err) {
      console.error("[YOLO] 推論錯誤：", err);
      return [];
    } finally {
      busyRef.current = false;
    }
  }, []);

  /* ── 卸載模型 ────────────────────────────────────────────────────── */
  const unload = useCallback(() => {
    try { sessionRef.current?.release?.(); } catch {}
    sessionRef.current   = null;
    offscreenRef.current = null;
    setStatus("idle");
    setModelPath("");
    setLoadError("");
  }, []);

  return { status, modelPath, loadError, loadModel, detect, unload };
}
