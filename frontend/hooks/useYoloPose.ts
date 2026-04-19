"use client";
/**
 * hooks/useYoloPose.ts
 * 瀏覽器端 YOLO26n-pose 姿態估計 Hook（人員辨識模式專用）
 *
 * 技術棧：
 *   - 模型：yolo26n-pose ONNX（COCO 17 關鍵點，640×640 輸入）
 *   - 輸出格式：E2E [1, 300, 57]
 *     每筆偵測 57 個值：
 *       [0–3]  x1, y1, x2, y2（pixel 座標 0~640）
 *       [4]    confidence（目標信心度）
 *       [5]    class_id（恆為 0 = person）
 *       [6–56] 17 × 3 關鍵點 = [kpx, kpy, kpv]（pixel + 可視度 0~1）
 *
 * COCO 17 關鍵點順序：
 *   0=nose  1=left_eye  2=right_eye  3=left_ear  4=right_ear
 *   5=left_shoulder    6=right_shoulder
 *   7=left_elbow       8=right_elbow
 *   9=left_wrist      10=right_wrist
 *  11=left_hip        12=right_hip
 *  13=left_knee       14=right_knee
 *  15=left_ankle      16=right_ankle
 *
 * PPE 輔助判斷（視覺位置推斷）：
 *   - 頭盔：nose/eye/ear 關鍵點上方 15% 區域是否有遮蔽
 *   - 反光衣：shoulder keypoints 之間區域色彩（未實作，留給 VLM）
 *   - 安全帶：hip/shoulder 連線是否有帶狀紋路（留給 VLM）
 */

import { useCallback, useRef, useState } from "react";

/* ═══════════════════════════════════════════════════════════════════════
   型別定義
════════════════════════════════════════════════════════════════════════ */

export const COCO_KEYPOINT_NAMES = [
  "nose", "left_eye", "right_eye", "left_ear", "right_ear",
  "left_shoulder", "right_shoulder",
  "left_elbow", "right_elbow",
  "left_wrist", "right_wrist",
  "left_hip", "right_hip",
  "left_knee", "right_knee",
  "left_ankle", "right_ankle",
] as const;

export type CocoKeypointName = typeof COCO_KEYPOINT_NAMES[number];

export interface PoseKeypoint {
  name:       CocoKeypointName;
  x:          number;   // 正規化 0–1
  y:          number;   // 正規化 0–1
  visibility: number;   // 0–1（< 0.3 視為不可見）
}

export interface PoseDetection {
  personIdx:  number;
  confidence: number;
  x:          number;   // bbox 左上角 正規化
  y:          number;
  w:          number;   // bbox 寬高 正規化
  h:          number;
  keypoints:  PoseKeypoint[];  // 17 個關鍵點
}

/** 人員骨架連線定義（用於繪製骨架）*/
export const SKELETON_CONNECTIONS: [number, number][] = [
  [0, 1], [0, 2],            // nose → eyes
  [1, 3], [2, 4],            // eyes → ears
  [5, 6],                    // shoulders
  [5, 7], [7, 9],            // left arm
  [6, 8], [8, 10],           // right arm
  [5, 11], [6, 12],          // torso sides
  [11, 12],                  // hips
  [11, 13], [13, 15],        // left leg
  [12, 14], [14, 16],        // right leg
];

export type PoseStatus = "idle" | "loading" | "ready" | "error";

/* ═══════════════════════════════════════════════════════════════════════
   常數
════════════════════════════════════════════════════════════════════════ */

const INPUT_SIZE   = 640;
const CONF_THRESH  = 0.30;   // 人員偵測信心門檻（低於此值過濾）
const KP_VIS_THRESH = 0.25;  // 關鍵點可視度門檻
const NUM_MAX_DETS = 300;    // E2E 最大偵測數
const NUM_KEYPOINTS = 17;
const DET_DIM      = 57;     // 每個偵測的維度

const LOCAL_MODEL  = "/models/yolo26n-pose.onnx";
const WASM_PATH    = "/ort/";

/* ═══════════════════════════════════════════════════════════════════════
   主 Hook
════════════════════════════════════════════════════════════════════════ */

export function useYoloPose() {
  const [status,    setStatus]    = useState<PoseStatus>("idle");
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

      const session = await ort.InferenceSession.create(LOCAL_MODEL, {
        executionProviders:     ["wasm"],
        graphOptimizationLevel: "all",
      });

      sessionRef.current = session;
      setStatus("ready");
      console.info("[YOLOPose] yolo26n-pose loaded ✓ (E2E [1,300,57])");
    } catch (err: any) {
      console.error("[YOLOPose] 載入失敗：", err);
      setLoadError(err?.message ?? "未知錯誤");
      setStatus("error");
    }
  }, [status]);

  /* ── 單幀姿態推論 ────────────────────────────────────────────────── */
  const detect = useCallback(async (video: HTMLVideoElement): Promise<PoseDetection[]> => {
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
      const outKey  = Object.keys(results)[0];
      const data    = results[outKey].data as Float32Array;

      // ── 後處理：E2E [1, 300, 57] ──
      // data 佈局：[det0_x1, det0_y1, det0_x2, det0_y2, det0_conf, det0_cls,
      //             det0_kp0x, det0_kp0y, det0_kp0v, ..., det0_kp16v,
      //             det1_x1, ...]
      const poses: PoseDetection[] = [];

      for (let i = 0; i < NUM_MAX_DETS; i++) {
        const base = i * DET_DIM;
        const conf = data[base + 4];
        if (conf < CONF_THRESH) continue;

        // bbox xyxy pixel → 正規化 0~1
        const x1 = Math.max(0, data[base + 0]) / INPUT_SIZE;
        const y1 = Math.max(0, data[base + 1]) / INPUT_SIZE;
        const x2 = Math.min(1, data[base + 2] / INPUT_SIZE);
        const y2 = Math.min(1, data[base + 3] / INPUT_SIZE);
        if (x2 <= x1 || y2 <= y1) continue;

        // 解析 17 個關鍵點（base+6 起）
        const keypoints: PoseKeypoint[] = [];
        for (let k = 0; k < NUM_KEYPOINTS; k++) {
          const kBase = base + 6 + k * 3;
          keypoints.push({
            name:       COCO_KEYPOINT_NAMES[k],
            x:          data[kBase]     / INPUT_SIZE,
            y:          data[kBase + 1] / INPUT_SIZE,
            visibility: data[kBase + 2],
          });
        }

        poses.push({
          personIdx:  poses.length,
          confidence: conf,
          x:          x1,
          y:          y1,
          w:          x2 - x1,
          h:          y2 - y1,
          keypoints,
        });
      }

      // 按信心度降序排列
      return poses.sort((a, b) => b.confidence - a.confidence);
    } catch (err) {
      console.error("[YOLOPose] 推論錯誤：", err);
      return [];
    } finally {
      busyRef.current = false;
    }
  }, []);

  /* ── 卸載 ────────────────────────────────────────────────────────── */
  const unload = useCallback(() => {
    try { sessionRef.current?.release?.(); } catch {}
    sessionRef.current   = null;
    offscreenRef.current = null;
    setStatus("idle");
    setLoadError("");
  }, []);

  return { status, loadError, loadModel, detect, unload };
}

/* ═══════════════════════════════════════════════════════════════════════
   姿態繪製工具函式（供 canvas overlay 使用）
════════════════════════════════════════════════════════════════════════ */

/**
 * 在 Canvas 上繪製人員骨架與關鍵點
 * @param canvas   目標 canvas（覆蓋在 video 上）
 * @param video    原始 video element（用於取得顯示尺寸）
 * @param poses    姿態偵測結果
 */
export function drawPoseOverlay(
  canvas: HTMLCanvasElement,
  video:  HTMLVideoElement,
  poses:  PoseDetection[],
): void {
  const rect = video.getBoundingClientRect();
  canvas.width  = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext("2d");
  if (!ctx || !poses.length) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const W = canvas.width;
  const H = canvas.height;

  const PERSON_COLORS = [
    "#34d399", "#60a5fa", "#f59e0b", "#f87171",
    "#a78bfa", "#fb7185", "#38bdf8",
  ];

  for (const pose of poses) {
    const color = PERSON_COLORS[pose.personIdx % PERSON_COLORS.length];

    // ── 繪製骨架連線 ──────────────────────────────────────────────
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.globalAlpha = 0.8;

    for (const [a, b] of SKELETON_CONNECTIONS) {
      const kpA = pose.keypoints[a];
      const kpB = pose.keypoints[b];
      if (kpA.visibility < KP_VIS_THRESH || kpB.visibility < KP_VIS_THRESH) continue;
      ctx.beginPath();
      ctx.moveTo(kpA.x * W, kpA.y * H);
      ctx.lineTo(kpB.x * W, kpB.y * H);
      ctx.stroke();
    }

    // ── 繪製關鍵點 ────────────────────────────────────────────────
    for (const kp of pose.keypoints) {
      if (kp.visibility < KP_VIS_THRESH) continue;
      ctx.fillStyle   = color;
      ctx.globalAlpha = kp.visibility;
      ctx.beginPath();
      ctx.arc(kp.x * W, kp.y * H, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── 繪製人員 bbox 與編號 ──────────────────────────────────────
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(pose.x * W, pose.y * H, pose.w * W, pose.h * H);

    const label = `P${pose.personIdx + 1} ${(pose.confidence * 100).toFixed(0)}%`;
    ctx.fillStyle = color;
    ctx.font      = "bold 11px monospace";
    ctx.fillText(label, pose.x * W + 4, pose.y * H - 4);
  }

  ctx.globalAlpha = 1.0;
}

/** 將 PoseDetection 轉換為可序列化的 JSON 格式（存入 DB）*/
export function poseToDbFormat(poses: PoseDetection[]): object[] {
  return poses.map((p) => ({
    personIdx:  p.personIdx,
    confidence: parseFloat(p.confidence.toFixed(3)),
    bbox:       [
      parseFloat(p.x.toFixed(4)),
      parseFloat(p.y.toFixed(4)),
      parseFloat(p.w.toFixed(4)),
      parseFloat(p.h.toFixed(4)),
    ],
    keypoints: p.keypoints.map((kp) => ({
      name: kp.name,
      x:    parseFloat(kp.x.toFixed(4)),
      y:    parseFloat(kp.y.toFixed(4)),
      v:    parseFloat(kp.visibility.toFixed(3)),
    })),
  }));
}
