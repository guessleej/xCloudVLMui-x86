/**
 * lib/yoloTracker.ts
 * IoU-based SORT-like 多目標追蹤器（瀏覽器端，純 JavaScript，無外部依賴）
 *
 * 演算法：
 *   1. 每幀計算新偵測與現有 Track 的 IoU 矩陣
 *   2. 貪婪匹配（Greedy assignment，接近 Hungarian 但更輕量）
 *   3. IoU > threshold → 更新 Track；無匹配 → 新建 Track
 *   4. 未被匹配超過 maxAge 幀的 Track → 移除
 *
 * 適用場景：Events 模式事件偵測，追蹤人員/車輛/危險物品
 *
 * 參考：SORT (Simple, Online and Realtime Tracking)
 *   Bewley et al., 2016, https://arxiv.org/abs/1602.00763
 */

import type { YoloDetection } from "@/hooks/useYolo";

/* ═══════════════════════════════════════════════════════════════════════
   型別定義
════════════════════════════════════════════════════════════════════════ */

export interface TrackedObject extends YoloDetection {
  trackId:    number;    // 唯一追蹤 ID（全局遞增）
  age:        number;    // 連續未匹配幀數（0 = 剛更新）
  hits:       number;    // 累計成功匹配幀數
  isNew:      boolean;   // 此幀才出現的新 Track
}

/** 追蹤歷史快照（存入 DB 用）*/
export interface TrackSnapshot {
  trackId:   number;
  classId:   number;
  label:     string;
  x:         number; y: number; w: number; h: number;
  age:       number;
  hits:      number;
}

/* ═══════════════════════════════════════════════════════════════════════
   工具函式
════════════════════════════════════════════════════════════════════════ */

function calcIoU(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): number {
  const ax2 = ax + aw, ay2 = ay + ah;
  const bx2 = bx + bw, by2 = by + bh;
  const ix1 = Math.max(ax, bx), iy1 = Math.max(ay, by);
  const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
  if (ix2 <= ix1 || iy2 <= iy1) return 0;
  const inter = (ix2 - ix1) * (iy2 - iy1);
  return inter / (aw * ah + bw * bh - inter);
}

/* ═══════════════════════════════════════════════════════════════════════
   SortTracker Class
════════════════════════════════════════════════════════════════════════ */

interface InternalTrack {
  id:      number;
  classId: number;
  x: number; y: number; w: number; h: number;
  age:     number;   // 連續未更新幀數
  hits:    number;   // 累計匹配幀數
  det:     YoloDetection;
}

export class SortTracker {
  private tracks:  InternalTrack[] = [];
  private nextId:  number          = 1;
  private maxAge:  number;         // Track 消失幾幀後移除
  private iouThreshold: number;    // IoU 匹配門檻

  constructor(options: { maxAge?: number; iouThreshold?: number } = {}) {
    this.maxAge       = options.maxAge       ?? 5;
    this.iouThreshold = options.iouThreshold ?? 0.25;
  }

  /**
   * 更新追蹤器：輸入當前幀的 YOLO 偵測結果，輸出帶 trackId 的追蹤物件
   */
  update(detections: YoloDetection[]): TrackedObject[] {
    // Step 1: 老化所有既有 Track
    for (const t of this.tracks) t.age++;

    // Step 2: 計算 IoU 矩陣並執行貪婪匹配
    const matchedDetIdx  = new Set<number>();
    const matchedTrackIdx = new Set<number>();

    // 按信心度降序，確保高信心偵測優先搶佔 Track
    const sortedDetIdx = detections
      .map((_, i) => i)
      .sort((a, b) => detections[b].confidence - detections[a].confidence);

    for (const di of sortedDetIdx) {
      const det = detections[di];
      let bestIoU  = this.iouThreshold;
      let bestTrack = -1;

      for (let ti = 0; ti < this.tracks.length; ti++) {
        if (matchedTrackIdx.has(ti)) continue;
        // 同類別優先（跨類別 IoU 降低 50% 計算）
        const t = this.tracks[ti];
        let iou = calcIoU(det.x, det.y, det.w, det.h, t.x, t.y, t.w, t.h);
        if (det.classId !== t.classId) iou *= 0.5;
        if (iou > bestIoU) {
          bestIoU  = iou;
          bestTrack = ti;
        }
      }

      if (bestTrack >= 0) {
        // 匹配成功：更新 Track
        const t = this.tracks[bestTrack];
        t.x   = det.x; t.y = det.y;
        t.w   = det.w; t.h = det.h;
        t.age = 0;
        t.hits++;
        t.det = det;
        matchedDetIdx.add(di);
        matchedTrackIdx.add(bestTrack);
      }
    }

    // Step 3: 為未匹配的偵測創建新 Track
    for (let di = 0; di < detections.length; di++) {
      if (matchedDetIdx.has(di)) continue;
      const det = detections[di];
      this.tracks.push({
        id:      this.nextId++,
        classId: det.classId,
        x: det.x, y: det.y,
        w: det.w, h: det.h,
        age:  0,
        hits: 1,
        det,
      });
    }

    // Step 4: 移除過老的 Track
    this.tracks = this.tracks.filter((t) => t.age <= this.maxAge);

    // Step 5: 回傳活躍 Track 的追蹤物件（age=0 表示此幀有更新）
    const results: TrackedObject[] = [];
    for (const t of this.tracks) {
      if (t.age > 0) continue;  // 此幀未更新的 Track 不輸出
      results.push({
        ...t.det,
        x: t.x, y: t.y, w: t.w, h: t.h,
        trackId: t.id,
        age:     t.age,
        hits:    t.hits,
        isNew:   t.hits === 1,
      });
    }

    return results;
  }

  /** 重置追蹤器（切換模式時呼叫）*/
  reset(): void {
    this.tracks = [];
    this.nextId = 1;
  }

  /** 取得當前所有活躍 Track 的快照（存入 DB 用）*/
  getSnapshot(): TrackSnapshot[] {
    return this.tracks
      .filter((t) => t.age === 0)
      .map((t) => ({
        trackId: t.id,
        classId: t.classId,
        label:   t.det.className,
        x: parseFloat(t.x.toFixed(4)),
        y: parseFloat(t.y.toFixed(4)),
        w: parseFloat(t.w.toFixed(4)),
        h: parseFloat(t.h.toFixed(4)),
        age:  t.age,
        hits: t.hits,
      }));
  }

  /** 取得 Track 數量統計 */
  getStats(): { activeTracks: number; totalCreated: number } {
    return {
      activeTracks: this.tracks.filter((t) => t.age === 0).length,
      totalCreated: this.nextId - 1,
    };
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   追蹤 ID 顏色生成（HSL，避免相鄰 ID 顏色相似）
════════════════════════════════════════════════════════════════════════ */

export function getTrackColor(trackId: number): string {
  // 黃金角分割，確保顏色分布均勻
  const hue = (trackId * 137.508) % 360;
  return `hsl(${hue.toFixed(0)}, 85%, 60%)`;
}

/**
 * 在偵測框右上角繪製追蹤 ID 標籤
 */
export function drawTrackIds(
  ctx:     CanvasRenderingContext2D,
  tracked: TrackedObject[],
  W:       number,
  H:       number,
): void {
  for (const t of tracked) {
    const color  = getTrackColor(t.trackId);
    const x      = t.x * W;
    const y      = t.y * H;
    const label  = `#${t.trackId}`;

    // 背景標籤
    ctx.font         = "bold 10px monospace";
    const tw         = ctx.measureText(label).width;
    ctx.fillStyle    = color;
    ctx.globalAlpha  = 0.85;
    ctx.fillRect(x + t.w * W - tw - 10, y + 2, tw + 8, 16);

    // 文字
    ctx.fillStyle   = "#000";
    ctx.globalAlpha = 1.0;
    ctx.fillText(label, x + t.w * W - tw - 6, y + 14);

    // 新出現的 Track：閃爍邊框
    if (t.isNew) {
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2.5;
      ctx.globalAlpha = 0.9;
      ctx.strokeRect(x, y, t.w * W, t.h * H);
    }
  }
  ctx.globalAlpha = 1.0;
}
