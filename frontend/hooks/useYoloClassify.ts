"use client";
/**
 * hooks/useYoloClassify.ts
 * 瀏覽器端 YOLO11n-cls 場景分類 Hook
 *
 * 技術棧：
 *   - 推論引擎：onnxruntime-web（WASM backend）
 *   - 模型：YOLO11n-cls ONNX（ImageNet 1000 類別）
 *   - 輸入：224×224 正規化圖像張量 [1, 3, 224, 224]
 *   - 輸出：[1, 1000] softmax 機率
 *
 * 製造業特色：
 *   - FACTORY_RELEVANT_CLASSES：工廠相關 ImageNet 類別的繁體中文對應
 *   - 回傳前 5 個信心度 > 0.05 的類別
 *
 * 效能設計：
 *   - 224×224 輸入，推論比 640×640 快約 8 倍
 *   - busyRef 防止推論堆積
 */

import { useCallback, useRef, useState } from "react";

/* ═══════════════════════════════════════════════════════════════════════
   型別定義
════════════════════════════════════════════════════════════════════════ */

/** 分類結果 */
export interface ClassifyResult {
  /** ImageNet 類別 ID（0~999）*/
  classId: number;
  /** 英文類別名稱 */
  label: string;
  /** 繁體中文類別名稱（工廠相關類別有翻譯，其他用英文）*/
  labelZh: string;
  /** 信心度 0~1 */
  confidence: number;
  /** 是否為工廠相關類別 */
  isFactoryRelevant: boolean;
}

export type ClassifyStatus = "idle" | "loading" | "ready" | "error";

/* ═══════════════════════════════════════════════════════════════════════
   常數
════════════════════════════════════════════════════════════════════════ */

const INPUT_SIZE   = 224;
const NUM_CLASSES  = 1000;
const CONF_THRESH  = 0.05;
const TOP_K        = 5;

const LOCAL_MODEL  = "/models/yolo11n-cls.onnx";
const REMOTE_MODEL = "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n-cls.onnx";
const WASM_PATH    = "/ort/";

/* ═══════════════════════════════════════════════════════════════════════
   ImageNet 1000 類別（精簡版，含製造業相關）
   完整 1000 類別清單過大，此處只保留最常見與工廠相關的類別名稱。
   其餘類別以 classId 顯示。
════════════════════════════════════════════════════════════════════════ */

/**
 * 精選 ImageNet 類別英文名稱映射（classId → label）
 * 包含最常見的 100 個類別
 */
const IMAGENET_LABELS: Partial<Record<number, string>> = {
  // 基本
  0:   "tench",
  1:   "goldfish",
  // 工具/設備
  422: "band aid",
  499: "chain",
  516: "computer keyboard",
  518: "crash helmet",
  527: "desktop computer",
  542: "drum",
  595: "golfcart",
  635: "laptop",
  763: "revolver",
  878: "safety pin",
  // 車輛/重機械
  407: "ambulance",
  436: "beach wagon",
  468: "cab",
  511: "convertible",
  530: "cougar",
  555: "fire engine",
  569: "forklift",
  574: "garbage truck",
  609: "go-kart",
  627: "crane",
  // 包裝/物料/其他
  430: "backpack",
  492: "chest",
  737: "pop bottle",
  898: "teddy",
  931: "umbrella",
};

/**
 * 工廠相關 ImageNet 類別 ID → 繁體中文名稱
 *
 * 涵蓋：個人防護裝備、車輛/重機械、工具、危險物品、工廠設備
 */
export const FACTORY_RELEVANT_CLASSES: Record<number, string> = {
  // ── 個人防護裝備（PPE）──────────────────────────────────────────
  518: "安全帽（硬帽）",
  // safety vest 約 ImageNet class 611（high_visibility_vest 不在標準分類）

  // ── 車輛 / 重機械 ──────────────────────────────────────────────
  407: "救護車",
  436: "貨車",
  468: "計程車",
  555: "消防車",
  569: "叉車",
  574: "垃圾車",
  609: "卡丁車",
  627: "起重機",

  // ── 手工具 ─────────────────────────────────────────────────────
  499: "鏈鋸",
  511: "轉換器",

  // ── 電子設備 ───────────────────────────────────────────────────
  516: "電腦鍵盤",
  527: "桌上型電腦",
  635: "筆記型電腦",

  // ── 危險 / 消防 ────────────────────────────────────────────────
  422: "急救繃帶",

  // ── 容器 / 物料 ────────────────────────────────────────────────
  430: "背包",
  492: "儲物箱",
  737: "塑膠瓶",

  // ── 動物（工廠外來入侵）────────────────────────────────────────
  281: "貓",
  207: "狗",
  355: "大鼠",
};

/* ═══════════════════════════════════════════════════════════════════════
   主 Hook
════════════════════════════════════════════════════════════════════════ */

/**
 * YOLO11n-cls 場景分類 Hook
 *
 * 對輸入影像進行 ImageNet 1000 類別分類，回傳前 K 個最高信心類別。
 * @example
 *   const { status, loadModel, detect, topK } = useYoloClassify();
 *   await loadModel();
 *   const results = await detect(videoEl, 5);
 */
export function useYoloClassify() {
  const [status,    setStatus]    = useState<ClassifyStatus>("idle");
  const [modelPath, setModelPath] = useState<string>("");
  const [loadError, setLoadError] = useState<string>("");
  const [topK,      setTopK]      = useState<ClassifyResult[]>([]);

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
        console.warn("[YOLOCls] 本機模型未找到，嘗試 GitHub CDN…");
        usedPath = REMOTE_MODEL;
        session = await ort.InferenceSession.create(REMOTE_MODEL, {
          executionProviders:     ["wasm"],
          graphOptimizationLevel: "all",
        });
      }

      sessionRef.current = session;
      setModelPath(usedPath.startsWith("http") ? "CDN" : "本機");
      setStatus("ready");
      console.info("[YOLOCls] yolo11n-cls loaded ✓ (ImageNet 1000)");
    } catch (err: any) {
      console.error("[YOLOCls] 載入失敗：", err);
      setLoadError(err?.message ?? "未知錯誤");
      setStatus("error");
    }
  }, [status]);

  /* ── 單幀分類推論 ────────────────────────────────────────────────── */
  /**
   * 對 video 畫面進行分類
   * @param video   HTMLVideoElement
   * @param k       回傳前 k 個類別（預設 5）
   * @returns       分類結果陣列，依信心度降序排列
   */
  const detect = useCallback(
    async (video: HTMLVideoElement, k: number = TOP_K): Promise<ClassifyResult[]> => {
      if (!sessionRef.current || busyRef.current) return [];
      if (!video || video.videoWidth === 0 || video.videoHeight === 0) return [];

      busyRef.current = true;
      try {
        const ort = await import("onnxruntime-web");

        // ── 前處理：縮放至 224×224，轉 CHW float32（ImageNet 正規化）──
        const canvas = offscreenRef.current!;
        const ctx = (canvas as OffscreenCanvas).getContext
          ? (canvas as OffscreenCanvas).getContext("2d") as OffscreenCanvasRenderingContext2D
          : (canvas as HTMLCanvasElement).getContext("2d")!;
        ctx.drawImage(video, 0, 0, INPUT_SIZE, INPUT_SIZE);
        const raw    = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
        const stride = INPUT_SIZE * INPUT_SIZE;
        const tensor = new Float32Array(3 * stride);

        // ImageNet 正規化：mean=[0.485, 0.456, 0.406]，std=[0.229, 0.224, 0.225]
        // YOLO cls 模型通常使用簡單 /255 正規化，與 det 模型一致
        for (let i = 0; i < stride; i++) {
          tensor[i]              = raw[i * 4]     / 255;
          tensor[stride + i]     = raw[i * 4 + 1] / 255;
          tensor[2 * stride + i] = raw[i * 4 + 2] / 255;
        }

        // ── 推論 ──
        const input   = new ort.Tensor("float32", tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]);
        const results = await sessionRef.current.run({ images: input });
        const outKey  = Object.keys(results)[0];
        const probs   = results[outKey].data as Float32Array;  // [1, 1000]

        // ── 後處理：取前 k 個高信心類別 ──
        // 建立索引陣列，依機率降序排列
        const indices = Array.from({ length: NUM_CLASSES }, (_, i) => i);
        indices.sort((a, b) => probs[b] - probs[a]);

        const classResults: ClassifyResult[] = [];
        for (let i = 0; i < indices.length && classResults.length < k; i++) {
          const classId    = indices[i];
          const confidence = probs[classId];
          if (confidence < CONF_THRESH) break;

          const labelEn    = IMAGENET_LABELS[classId] ?? `class_${classId}`;
          const labelZh    = FACTORY_RELEVANT_CLASSES[classId] ?? labelEn;
          const isFactory  = classId in FACTORY_RELEVANT_CLASSES;

          classResults.push({
            classId,
            label:             labelEn,
            labelZh,
            confidence,
            isFactoryRelevant: isFactory,
          });
        }

        setTopK(classResults);
        return classResults;
      } catch (err) {
        console.error("[YOLOCls] 推論錯誤：", err);
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
    setTopK([]);
  }, []);

  return { status, modelPath, loadError, topK, loadModel, detect, reset };
}
