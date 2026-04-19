"use client";
/**
 * hooks/useYoloTracker.ts
 * SORT（Simple Online and Realtime Tracking）多目標追蹤 Hook
 *
 * 演算法說明：
 *   - 不載入任何 ONNX 模型，純演算法實作
 *   - 以 useYolo.ts 的 YoloDetection[] 作為輸入
 *   - 跨幀指派持久化 trackId 給每個偵測目標
 *
 * 核心元件：
 *   1. IoU 計算：計算兩個邊界框的交集比聯集
 *   2. 匈牙利演算法（簡化版貪心匹配，依 IoU 分數降序排列）
 *   3. 卡爾曼濾波器（簡化版：使用上一幀位置作為預測，速度 = 位置差）
 *   4. 軌跡生命週期：tentative（age<minHits）→ confirmed → lost → deleted（age>maxAge）
 *
 * 效能設計：
 *   - 使用 useRef 儲存追蹤狀態，避免 React re-render
 *   - 同步操作，不阻塞偵測迴圈
 */

import { useRef, useCallback, useState } from "react";
import type { YoloDetection } from "./useYolo";

/* ═══════════════════════════════════════════════════════════════════════
   型別定義
════════════════════════════════════════════════════════════════════════ */

/** 追蹤目標狀態 */
export type TrackState = "tentative" | "confirmed" | "lost";

/** 追蹤中的物件（繼承 YoloDetection，加入追蹤欄位）*/
export interface TrackedObject extends YoloDetection {
  /** 持久化追蹤 ID（跨幀唯一）*/
  trackId: number;
  /** 自首次偵測以來的幀數 */
  age: number;
  /** 連續命中幀數 */
  hitStreak: number;
  /** 自上次更新以來的幀數（0 = 本幀有偵測到）*/
  timesSinceUpdate: number;
  /** 追蹤狀態 */
  state: TrackState;
}

/** SORT 追蹤器設定 */
export interface SortTrackerConfig {
  /** 軌跡最大保留幀數（超過則刪除）*/
  maxAge?: number;
  /** 軌跡從 tentative 升級為 confirmed 所需最少命中次數 */
  minHits?: number;
  /** IoU 匹配門檻（低於此值視為不匹配）*/
  iouThreshold?: number;
}

/* ═══════════════════════════════════════════════════════════════════════
   內部軌跡結構（含卡爾曼濾波器狀態）
════════════════════════════════════════════════════════════════════════ */

interface TrackInternal {
  trackId: number;
  /** 當前預測位置 [x, y, w, h] 正規化 0~1 */
  bbox: [number, number, number, number];
  /** 速度向量 [vx, vy, vw, vh] 用於下一幀預測 */
  velocity: [number, number, number, number];
  /** 最後一次關聯的偵測（用於輸出 TrackedObject）*/
  lastDet: YoloDetection;
  age: number;
  hitStreak: number;
  timesSinceUpdate: number;
  state: TrackState;
}

/* ═══════════════════════════════════════════════════════════════════════
   工具函式
════════════════════════════════════════════════════════════════════════ */

/**
 * 計算兩個邊界框的 IoU（Intersection over Union）
 * @param a [x, y, w, h] 正規化座標
 * @param b [x, y, w, h] 正規化座標
 * @returns IoU 值 0~1
 */
function calcIoU(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const ax1 = a[0];
  const ay1 = a[1];
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];

  const bx1 = b[0];
  const by1 = b[1];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];

  const ix1 = Math.max(ax1, bx1);
  const iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);

  if (ix2 <= ix1 || iy2 <= iy1) return 0;

  const intersection = (ix2 - ix1) * (iy2 - iy1);
  const areaA = a[2] * a[3];
  const areaB = b[2] * b[3];
  const union = areaA + areaB - intersection;

  return union <= 0 ? 0 : intersection / union;
}

/**
 * 簡化版匈牙利演算法（貪心匹配，依 IoU 降序）
 * @param tracks     現有軌跡
 * @param dets       當前幀偵測結果
 * @param iouThresh  IoU 匹配門檻
 * @returns 匹配對 [trackIdx, detIdx][]、未匹配偵測索引[]、未匹配軌跡索引[]
 */
function greedyMatch(
  tracks: TrackInternal[],
  dets: YoloDetection[],
  iouThresh: number,
): {
  matched: [number, number][];
  unmatchedDets: number[];
  unmatchedTracks: number[];
} {
  if (tracks.length === 0 || dets.length === 0) {
    return {
      matched: [],
      unmatchedDets: dets.map((_, i) => i),
      unmatchedTracks: tracks.map((_, i) => i),
    };
  }

  // 建立 IoU 矩陣，並收集所有候選配對
  type Candidate = { iou: number; tIdx: number; dIdx: number };
  const candidates: Candidate[] = [];

  for (let t = 0; t < tracks.length; t++) {
    for (let d = 0; d < dets.length; d++) {
      const det = dets[d];
      const iou = calcIoU(tracks[t].bbox, [det.x, det.y, det.w, det.h]);
      if (iou >= iouThresh) {
        candidates.push({ iou, tIdx: t, dIdx: d });
      }
    }
  }

  // 依 IoU 降序排列，貪心分配
  candidates.sort((a, b) => b.iou - a.iou);

  const matchedT = new Set<number>();
  const matchedD = new Set<number>();
  const matched: [number, number][] = [];

  for (const c of candidates) {
    if (matchedT.has(c.tIdx) || matchedD.has(c.dIdx)) continue;
    matched.push([c.tIdx, c.dIdx]);
    matchedT.add(c.tIdx);
    matchedD.add(c.dIdx);
  }

  const unmatchedDets    = dets.map((_, i) => i).filter((i) => !matchedD.has(i));
  const unmatchedTracks  = tracks.map((_, i) => i).filter((i) => !matchedT.has(i));

  return { matched, unmatchedDets, unmatchedTracks };
}

/* ═══════════════════════════════════════════════════════════════════════
   SortTracker 類別（可直接實例化，供 useRef 使用）
════════════════════════════════════════════════════════════════════════ */

/**
 * SORT 多目標追蹤器
 *
 * 可直接實例化（用於 useRef），也可透過 useYoloTracker hook 使用。
 * @example
 *   const tracker = new SortTracker({ maxAge: 30, minHits: 3 });
 *   const tracked = tracker.update(yoloDets);
 */
export class SortTracker {
  private maxAge:       number;
  private minHits:      number;
  private iouThreshold: number;
  private tracks:       TrackInternal[] = [];
  private nextId:       number          = 1;

  constructor(config: SortTrackerConfig = {}) {
    this.maxAge       = config.maxAge       ?? 30;
    this.minHits      = config.minHits      ?? 3;
    this.iouThreshold = config.iouThreshold ?? 0.3;
  }

  /**
   * 以當前幀偵測結果更新追蹤器
   * @param detections  YOLO 偵測結果
   * @returns           本幀所有活躍追蹤目標
   */
  update(detections: YoloDetection[]): TrackedObject[] {
    // ── Step 1：卡爾曼預測（簡化版：加上速度向量）──
    for (const t of this.tracks) {
      t.bbox[0] += t.velocity[0];
      t.bbox[1] += t.velocity[1];
      t.bbox[2] += t.velocity[2];
      t.bbox[3] += t.velocity[3];
      // 邊界夾緊
      t.bbox[0] = Math.max(0, Math.min(1 - t.bbox[2], t.bbox[0]));
      t.bbox[1] = Math.max(0, Math.min(1 - t.bbox[3], t.bbox[1]));
      t.bbox[2] = Math.max(0.001, t.bbox[2]);
      t.bbox[3] = Math.max(0.001, t.bbox[3]);
      t.timesSinceUpdate++;
      t.age++;
    }

    // ── Step 2：匹配偵測與軌跡 ──
    const { matched, unmatchedDets, unmatchedTracks } = greedyMatch(
      this.tracks,
      detections,
      this.iouThreshold,
    );

    // ── Step 3：更新已匹配軌跡 ──
    for (const [tIdx, dIdx] of matched) {
      const t   = this.tracks[tIdx];
      const det = detections[dIdx];

      const prevBbox = [...t.bbox] as [number, number, number, number];
      t.bbox        = [det.x, det.y, det.w, det.h];
      // 速度 = 位置差（平滑：0.5 新速度 + 0.5 舊速度）
      const newVx = det.x - prevBbox[0];
      const newVy = det.y - prevBbox[1];
      const newVw = det.w - prevBbox[2];
      const newVh = det.h - prevBbox[3];
      t.velocity = [
        t.velocity[0] * 0.5 + newVx * 0.5,
        t.velocity[1] * 0.5 + newVy * 0.5,
        t.velocity[2] * 0.5 + newVw * 0.5,
        t.velocity[3] * 0.5 + newVh * 0.5,
      ];

      t.lastDet         = det;
      t.hitStreak++;
      t.timesSinceUpdate = 0;
    }

    // ── Step 4：未匹配軌跡的 hitStreak 歸零 ──
    for (const tIdx of unmatchedTracks) {
      this.tracks[tIdx].hitStreak = 0;
    }

    // ── Step 5：為未匹配偵測建立新軌跡 ──
    for (const dIdx of unmatchedDets) {
      const det = detections[dIdx];
      this.tracks.push({
        trackId:         this.nextId++,
        bbox:            [det.x, det.y, det.w, det.h],
        velocity:        [0, 0, 0, 0],
        lastDet:         det,
        age:             1,
        hitStreak:       1,
        timesSinceUpdate: 0,
        state:           "tentative",
      });
    }

    // ── Step 6：更新狀態，刪除過期軌跡 ──
    this.tracks = this.tracks.filter((t) => {
      if (t.timesSinceUpdate === 0) {
        // 本幀有命中
        if (t.hitStreak >= this.minHits) {
          t.state = "confirmed";
        } else {
          t.state = "tentative";
        }
      } else {
        t.state = "lost";
      }
      return t.timesSinceUpdate <= this.maxAge;
    });

    // ── 輸出活躍軌跡（confirmed + tentative，本幀有命中或仍在追蹤）──
    return this.getSnapshot();
  }

  /**
   * 取得目前所有追蹤目標快照
   * @returns 當前所有活躍追蹤目標
   */
  getSnapshot(): TrackedObject[] {
    return this.tracks
      .filter((t) => t.state !== "lost" || t.timesSinceUpdate === 0)
      .map((t) => ({
        ...t.lastDet,
        // 使用預測位置覆蓋（更平滑）
        x: t.bbox[0],
        y: t.bbox[1],
        w: t.bbox[2],
        h: t.bbox[3],
        trackId:          t.trackId,
        age:              t.age,
        hitStreak:        t.hitStreak,
        timesSinceUpdate: t.timesSinceUpdate,
        state:            t.state,
      }));
  }

  /**
   * 重置追蹤器（清除所有軌跡，重設 ID 計數器）
   */
  reset(): void {
    this.tracks = [];
    this.nextId = 1;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   主 Hook
════════════════════════════════════════════════════════════════════════ */

/**
 * SORT 多目標追蹤 Hook
 *
 * 不載入任何 ONNX 模型，純演算法追蹤。
 * 使用 useRef 儲存追蹤器狀態，確保同步運算不觸發 re-render。
 *
 * @param config  追蹤器設定（可選）
 * @example
 *   const { tracks, update, reset } = useYoloTracker({ maxAge: 30 });
 *   const tracked = update(yoloDets); // 每幀呼叫
 */
export function useYoloTracker(config?: SortTrackerConfig) {
  const trackerRef = useRef<SortTracker>(new SortTracker(config));
  const [tracks, setTracks] = useState<TrackedObject[]>([]);

  /**
   * 以當前幀偵測結果更新追蹤器
   * @param dets  useYolo 的 YoloDetection[]
   * @returns     本幀所有活躍追蹤目標
   */
  const update = useCallback((dets: YoloDetection[]): TrackedObject[] => {
    try {
      const result = trackerRef.current.update(dets);
      setTracks(result);
      return result;
    } catch (err) {
      console.error("[SortTracker] update 錯誤：", err);
      return [];
    }
  }, []);

  /**
   * 取得目前追蹤快照（不更新，僅讀取）
   */
  const getSnapshot = useCallback((): TrackedObject[] => {
    return trackerRef.current.getSnapshot();
  }, []);

  /**
   * 重置追蹤器
   */
  const reset = useCallback((): void => {
    trackerRef.current.reset();
    setTracks([]);
  }, []);

  return { tracks, update, reset, getSnapshot };
}
