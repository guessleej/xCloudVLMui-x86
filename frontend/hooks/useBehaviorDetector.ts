"use client";
/**
 * hooks/useBehaviorDetector.ts
 * 工廠安全行為偵測 Hook（純演算法，無 ONNX 模型）v2
 *
 * 輸入：
 *   - YOLO 偵測結果（YoloDetection[]）
 *   - 姿態估計結果（PoseDetection[]）
 *   - 追蹤結果（TrackedObject[]）
 *
 * 行為偵測規則（共 11 種）：
 *   1.  fall_detected       — 跌倒偵測（bbox 橫寬比 + 腳踝/髖關鍵點）
 *   2.  crowding            — 人群聚集（≥3 人）
 *   3.  ppe_violation       — PPE 缺失（低信心，需 VLM 確認）
 *   4.  hazard_proximity    — 危險物品接近
 *   5.  vehicle_proximity   — 車輛人員近距離
 *   6.  phone_usage         — 工作中使用手機（三重過濾）
 *   7.  loitering           — 長時間滯留（60+ 幀位置不動）
 *   8.  abnormal_posture    — 異常姿態（低頭彎腰/蹲姿）
 *   9.  multiple_persons    — 多人同場（≥2 人）
 *   10. person_running      — 奔跑偵測（速度 > 閾值，可能緊急情況）
 *   11. person_raising_hand — 舉手偵測（手腕高於肩膀，可能求助）
 *
 * 人員分析（PersonInfo[]）：
 *   gender — 性別推測（肩寬/髖寬比 heuristic，最高信心 0.70）
 *   action — 動作偵測（站立/坐著/行走/奔跑/舉手/彎腰/蹲下/未知）
 */

import { useRef, useCallback, useState } from "react";
import type { YoloDetection, ManufacturingRisk } from "./useYolo";
import type { PoseDetection } from "./useYoloPose";
import type { TrackedObject } from "@/lib/yoloTracker";

/* ═══════════════════════════════════════════════════════════════════════
   型別定義
════════════════════════════════════════════════════════════════════════ */

/** 可偵測的行為類型 */
export type BehaviorType =
  | "fall_detected"        // 跌倒偵測
  | "crowding"             // 人群聚集
  | "ppe_violation"        // PPE 缺失
  | "hazard_proximity"     // 危險物品接近
  | "vehicle_proximity"    // 車輛人員近距離
  | "phone_usage"          // 工作中使用手機
  | "loitering"            // 長時間滯留
  | "abnormal_posture"     // 異常姿態
  | "no_person_in_zone"    // 無人區域（監控用）
  | "multiple_persons"     // 多人同場
  | "person_running"       // 奔跑偵測（可能緊急情況）
  | "person_raising_hand"; // 舉手偵測（可能求助）

/**
 * 人員動作類型
 * 由姿態關鍵點 + 追蹤速度推導
 */
export type PersonAction =
  | "standing"      // 站立
  | "sitting"       // 坐著
  | "walking"       // 行走
  | "running"       // 奔跑
  | "raising_hand"  // 舉手
  | "bending"       // 彎腰
  | "squatting"     // 蹲下
  | "unknown";      // 無法判斷

/**
 * 性別推測
 * ⚠️ Heuristic only：肩寬/髖寬比，正面站立時較準，側面/背面誤差大
 */
export type GenderEstimate = "male" | "female" | "unknown";

/**
 * 人員分析結果
 * 每位 person 偵測結果對應一筆分析
 */
export interface PersonInfo {
  /** 對應的 YOLO person 偵測（bbox 座標等）*/
  det:         YoloDetection;
  /** 配對的姿態估計（若有）*/
  pose?:       PoseDetection;
  /** 追蹤 ID */
  trackId?:    number;
  /**
   * 性別推測
   * ⚠️ 僅供工廠場景參考，不適用做識別依據
   * 準確性受到：服裝/角度/遮擋/肢體比例個人差異 影響
   */
  gender:      GenderEstimate;
  /** 性別信心 0~0.70（heuristic 上限）*/
  genderConf:  number;
  /** 推測依據：shoulderHipRatio（肩髖比）*/
  genderBasis: string;
  /** 目前動作 */
  action:      PersonAction;
  /** 動作信心 0~1 */
  actionConf:  number;
  /** 動作推測依據（供 UI tooltip）*/
  actionBasis: string;
}

/** 行為警報 */
export interface BehaviorAlert {
  type:        BehaviorType;
  nameZh:      string;
  nameEn:      string;
  risk:        ManufacturingRisk;
  confidence:  number;
  description: string;
  trackIds?:   number[];
  timestamp:   number;
}

/* ═══════════════════════════════════════════════════════════════════════
   行為元數據
════════════════════════════════════════════════════════════════════════ */

const BEHAVIOR_META: Record<BehaviorType, { nameZh: string; nameEn: string; risk: ManufacturingRisk }> = {
  fall_detected:       { nameZh: "跌倒偵測",         nameEn: "Fall Detected",            risk: "critical" },
  crowding:            { nameZh: "人群聚集",          nameEn: "Crowding",                 risk: "warning"  },
  ppe_violation:       { nameZh: "PPE 缺失",          nameEn: "PPE Violation",            risk: "critical" },
  hazard_proximity:    { nameZh: "危險物品接近",       nameEn: "Hazard Proximity",         risk: "critical" },
  vehicle_proximity:   { nameZh: "車輛人員近距離",     nameEn: "Vehicle-Person Proximity", risk: "critical" },
  phone_usage:         { nameZh: "工作中使用手機",     nameEn: "Phone Usage",              risk: "warning"  },
  loitering:           { nameZh: "長時間滯留",         nameEn: "Loitering",                risk: "warning"  },
  abnormal_posture:    { nameZh: "異常姿態",           nameEn: "Abnormal Posture",         risk: "warning"  },
  no_person_in_zone:   { nameZh: "無人區域",           nameEn: "No Person in Zone",        risk: "info"     },
  multiple_persons:    { nameZh: "多人同場",           nameEn: "Multiple Persons",         risk: "info"     },
  person_running:      { nameZh: "人員奔跑",           nameEn: "Person Running",           risk: "warning"  },
  person_raising_hand: { nameZh: "人員舉手",           nameEn: "Person Raising Hand",      risk: "info"     },
};

/** 動作中文顯示名稱 */
export const ACTION_ZH: Record<PersonAction, string> = {
  standing:     "站立",
  sitting:      "坐著",
  walking:      "行走",
  running:      "奔跑",
  raising_hand: "舉手",
  bending:      "彎腰",
  squatting:    "蹲下",
  unknown:      "偵測中",
};

/** 性別中文顯示名稱 */
export const GENDER_ZH: Record<GenderEstimate, string> = {
  male:    "男",
  female:  "女",
  unknown: "人員",
};

/** 風險等級排序（critical=0 最高）*/
const RISK_ORDER: Record<ManufacturingRisk, number> = { critical: 0, warning: 1, safe: 2, info: 3 };

/* ═══════════════════════════════════════════════════════════════════════
   常數
════════════════════════════════════════════════════════════════════════ */

const LOITER_DIST_THRESH  = 0.05;
const LOITER_FRAME_THRESH = 60;
const HAZARD_CLOSE_THRESH = 0.156;   // ≈ 100px / 640
const HAZARD_FAR_THRESH   = 0.312;   // ≈ 200px / 640

/**
 * 行走速度門檻（每幀正規化距離）
 * 640px 畫面中約 3.8px/frame 移動
 */
const WALK_SPEED_THRESH = 0.006;
/**
 * 奔跑速度門檻（每幀正規化距離）
 * 640px 畫面中約 14px/frame 移動
 */
const RUN_SPEED_THRESH  = 0.022;

/** COCO classId 映射 */
const COCO_ID = {
  PERSON:       0,
  BICYCLE:      1,
  CAR:          2,
  MOTORCYCLE:   3,
  BUS:          5,
  TRUCK:        7,
  BASEBALL_BAT: 34,
  KNIFE:        43,
  SCISSORS:     76,
  CELL_PHONE:   67,
} as const;

/* ═══════════════════════════════════════════════════════════════════════
   內部狀態型別
════════════════════════════════════════════════════════════════════════ */

interface MovementRecord {
  centerX:    number;   // 上一幀中心 X（正規化）
  centerY:    number;   // 上一幀中心 Y（正規化）
  velocity:   number;   // 最近一幀正規化速度（行走/奔跑判斷用）
  frameCount: number;   // 靜止幀計數（滯留偵測用）
}

/* ═══════════════════════════════════════════════════════════════════════
   內部工具函式
════════════════════════════════════════════════════════════════════════ */

/** 計算兩個 bbox 中心點的正規化距離 */
function centerDist(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  return Math.sqrt(
    (a.x + a.w / 2 - (b.x + b.w / 2)) ** 2 +
    (a.y + a.h / 2 - (b.y + b.h / 2)) ** 2,
  );
}

/** 建立行為警報物件 */
function makeAlert(
  type: BehaviorType,
  confidence: number,
  description: string,
  trackIds?: number[],
): BehaviorAlert {
  const m = BEHAVIOR_META[type];
  return { type, nameZh: m.nameZh, nameEn: m.nameEn, risk: m.risk, confidence, description, trackIds, timestamp: Date.now() };
}

/**
 * 找到與 person bbox 最接近的 Pose（中心點距離 < 0.25 才配對）
 */
function matchPose(person: YoloDetection, poses: PoseDetection[]): PoseDetection | undefined {
  let best: PoseDetection | undefined;
  let bestD = 0.25;
  for (const p of poses) {
    const d = centerDist(person, p);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/**
 * 找到與 person bbox 最接近的 Track（中心點距離 < 0.15 且為 person 類別）
 */
function matchTrack(person: YoloDetection, tracks: TrackedObject[]): TrackedObject | undefined {
  let best: TrackedObject | undefined;
  let bestD = 0.15;
  for (const t of tracks) {
    if (t.classId !== COCO_ID.PERSON) continue;
    const d = centerDist(person, t);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/**
 * 從肩寬/髖寬比推測性別（heuristic）
 *
 * 依據人體測量學統計：
 *   男性：肩寬明顯大於髖寬，肩/髖比通常 > 1.25
 *   女性：肩寬與髖寬接近或髖寬更大，肩/髖比通常 < 0.95
 *
 * ⚠️ 準確度受以下因素影響：
 *   - 服裝（寬鬆外套誇大肩寬）
 *   - 攝影角度（側面/斜面偏差大）
 *   - 姿勢（雙臂開合影響視覺肩寬）
 *   - 個人差異（體型、年齡）
 */
function estimateGender(kp: PoseDetection["keypoints"]): {
  gender:  GenderEstimate;
  conf:    number;
  basis:   string;
} {
  const lS = kp[5]; const rS = kp[6];  // left/right shoulder
  const lH = kp[11]; const rH = kp[12]; // left/right hip

  const shoulderOk = lS.visibility >= 0.40 && rS.visibility >= 0.40;
  const hipOk      = lH.visibility >= 0.40 && rH.visibility >= 0.40;

  if (!shoulderOk || !hipOk) {
    return { gender: "unknown", conf: 0, basis: "關鍵點可見度不足" };
  }

  const sw = Math.abs(lS.x - rS.x);
  const hw = Math.abs(lH.x - rH.x);
  if (hw < 0.01) return { gender: "unknown", conf: 0, basis: "髖部距離過小" };

  const ratio = sw / hw;
  const basisStr = `肩/髖比=${ratio.toFixed(2)}`;

  if (ratio > 1.25) {
    // 肩膀明顯比髖寬 → 男性特徵
    const conf = Math.min(0.70, 0.45 + (ratio - 1.25) * 0.70);
    return { gender: "male", conf, basis: basisStr };
  }
  if (ratio < 0.95) {
    // 髖部接近或寬過肩膀 → 女性特徵
    const conf = Math.min(0.70, 0.45 + (0.95 - ratio) * 0.70);
    return { gender: "female", conf, basis: basisStr };
  }
  // 比例居中 → 無法判斷
  return { gender: "unknown", conf: 0.20, basis: `${basisStr}（比例居中）` };
}

/**
 * 從關鍵點 + 速度推測動作
 *
 * 優先順序（高信心優先）：
 *   舉手(0.85) > 坐著(0.80) > 蹲下(0.75) > 彎腰(0.75) > 奔跑(0.72) > 行走(0.68) > 站立(0.65)
 */
function detectAction(
  pose:     PoseDetection | undefined,
  velocity: number,
): { action: PersonAction; conf: number; basis: string } {
  // 無 Pose 時只能從速度判斷
  if (!pose) {
    if (velocity > RUN_SPEED_THRESH)  return { action: "running",  conf: 0.55, basis: `速度=${velocity.toFixed(3)}` };
    if (velocity > WALK_SPEED_THRESH) return { action: "walking",  conf: 0.50, basis: `速度=${velocity.toFixed(3)}` };
    return { action: "unknown", conf: 0, basis: "無姿態資料" };
  }

  const kp  = pose.keypoints;
  const vis = (i: number) => kp[i].visibility >= 0.35;

  // ── 規則 1：舉手 ───────────────────────────────────────────────────
  // 手腕 y 明顯高於同側肩膀 y（y 軸向下，故手腕 y < 肩 y）
  const lHandUp = vis(9)  && vis(5)  && kp[9].y  < kp[5].y  - 0.04;
  const rHandUp = vis(10) && vis(6)  && kp[10].y < kp[6].y  - 0.04;
  if (lHandUp || rHandUp) {
    const which = lHandUp && rHandUp ? "雙手" : lHandUp ? "左手" : "右手";
    return { action: "raising_hand", conf: 0.85, basis: `${which}腕高於肩膀` };
  }

  // ── 規則 2：坐著 ───────────────────────────────────────────────────
  // 膝蓋 y 與髖部 y 差值 < 0.10（坐姿時膝蓋與腰幾乎等高）
  const lSit = vis(11) && vis(13) && Math.abs(kp[11].y - kp[13].y) < 0.10;
  const rSit = vis(12) && vis(14) && Math.abs(kp[12].y - kp[14].y) < 0.10;
  if (lSit || rSit) {
    return { action: "sitting", conf: 0.80, basis: "膝蓋與髖部等高（坐姿）" };
  }

  // ── 規則 3：蹲下 ───────────────────────────────────────────────────
  // 膝蓋 y 接近腳踝 y（差值 < 0.07）且左右腿均可見
  const lSq = vis(13) && vis(15) && Math.abs(kp[13].y - kp[15].y) < 0.07;
  const rSq = vis(14) && vis(16) && Math.abs(kp[14].y - kp[16].y) < 0.07;
  if (lSq && rSq) {
    return { action: "squatting", conf: 0.75, basis: "膝蓋接近腳踝（蹲姿）" };
  }

  // ── 規則 4：彎腰 ───────────────────────────────────────────────────
  // 鼻尖 y > 平均髖部 y（頭比腰低，y 軸向下）
  const hipCnt = (vis(11) ? 1 : 0) + (vis(12) ? 1 : 0);
  if (vis(0) && hipCnt > 0) {
    const avgHipY = ((vis(11) ? kp[11].y : 0) + (vis(12) ? kp[12].y : 0)) / hipCnt;
    if (kp[0].y > avgHipY + 0.04) {
      return { action: "bending", conf: 0.75, basis: `頭部 y=${kp[0].y.toFixed(2)} > 髖部 y=${avgHipY.toFixed(2)}` };
    }
  }

  // ── 規則 5：奔跑 / 行走（速度判斷）────────────────────────────────
  if (velocity > RUN_SPEED_THRESH)  return { action: "running",  conf: 0.72, basis: `速度=${velocity.toFixed(3)}（>奔跑閾值）` };
  if (velocity > WALK_SPEED_THRESH) return { action: "walking",  conf: 0.68, basis: `速度=${velocity.toFixed(3)}（>行走閾值）` };

  // ── 預設：站立 ───────────────────────────────────────────────────────
  return { action: "standing", conf: 0.65, basis: "無特殊姿態特徵" };
}

/* ═══════════════════════════════════════════════════════════════════════
   主 Hook
════════════════════════════════════════════════════════════════════════ */

/**
 * 工廠安全行為偵測 Hook
 *
 * 純演算法實作，不載入任何 ONNX 模型。
 * 結合 YOLO 偵測、姿態估計、追蹤資料，套用工廠安全規則偵測異常行為
 * 並對每位人員進行性別推測與動作偵測。
 *
 * @example
 *   const { behaviors, personInfos, detect, reset } = useBehaviorDetector();
 *   const alerts = detect(yoloDets, poses, tracks);
 */
export function useBehaviorDetector() {
  const [behaviors,   setBehaviors]   = useState<BehaviorAlert[]>([]);
  const [personInfos, setPersonInfos] = useState<PersonInfo[]>([]);

  /** 移動歷史：trackId → MovementRecord */
  const movHistoryRef = useRef<Map<number, MovementRecord>>(new Map());

  const detect = useCallback(
    (
      yoloDets: YoloDetection[],
      poses:    PoseDetection[],
      tracks:   TrackedObject[],
    ): BehaviorAlert[] => {
      const alerts: BehaviorAlert[] = [];

      // ── 預處理：篩選各類別 ──────────────────────────────────────────
      const persons    = yoloDets.filter((d) => d.classId === COCO_ID.PERSON);
      const vehicleIds = new Set<number>([COCO_ID.BICYCLE, COCO_ID.CAR, COCO_ID.MOTORCYCLE, COCO_ID.BUS, COCO_ID.TRUCK]);
      const hazardIds  = new Set<number>([COCO_ID.KNIFE, COCO_ID.SCISSORS, COCO_ID.BASEBALL_BAT]);
      const vehicles   = yoloDets.filter((d) => vehicleIds.has(d.classId as number));
      const hazards    = yoloDets.filter((d) => hazardIds.has(d.classId as number));
      const phones     = yoloDets.filter((d) => d.classId === COCO_ID.CELL_PHONE);

      // ── 更新移動歷史（計算速度 + 靜止幀數）──────────────────────────
      const movMap     = movHistoryRef.current;
      const activeTids = new Set(tracks.map((t) => t.trackId));
      // 清除已消失軌跡
      Array.from(movMap.keys()).forEach((tid) => { if (!activeTids.has(tid)) movMap.delete(tid); });

      for (const track of tracks) {
        const cx = track.x + track.w / 2;
        const cy = track.y + track.h / 2;
        const rec = movMap.get(track.trackId);
        if (rec) {
          const dist    = Math.sqrt((cx - rec.centerX) ** 2 + (cy - rec.centerY) ** 2);
          rec.velocity  = dist;
          rec.centerX   = cx;
          rec.centerY   = cy;
          rec.frameCount = dist < LOITER_DIST_THRESH ? rec.frameCount + 1 : 0;
        } else {
          movMap.set(track.trackId, { centerX: cx, centerY: cy, velocity: 0, frameCount: 1 });
        }
      }

      // ── 人員分析：性別推測 + 動作偵測 ──────────────────────────────
      const infos: PersonInfo[] = persons.map((person) => {
        const pose    = matchPose(person, poses);
        const track   = matchTrack(person, tracks);
        const vel     = track ? (movMap.get(track.trackId)?.velocity ?? 0) : 0;

        const gResult = pose ? estimateGender(pose.keypoints) : { gender: "unknown" as GenderEstimate, conf: 0, basis: "無姿態資料" };
        const aResult = detectAction(pose, vel);

        return {
          det:         person,
          pose,
          trackId:     track?.trackId,
          gender:      gResult.gender,
          genderConf:  gResult.conf,
          genderBasis: gResult.basis,
          action:      aResult.action,
          actionConf:  aResult.conf,
          actionBasis: aResult.basis,
        };
      });
      setPersonInfos(infos);

      // ── 規則 1：fall_detected ────────────────────────────────────────
      for (const pose of poses) {
        try {
          const kp   = pose.keypoints;
          const condA = pose.w > pose.h * 1.4; // 橫臥比例
          const lA = kp[15]; const rA = kp[16]; const lH = kp[11]; const rH = kp[12];
          const aVis = (lA.visibility >= 0.3 ? 1 : 0) + (rA.visibility >= 0.3 ? 1 : 0);
          const hVis = (lH.visibility >= 0.3 ? 1 : 0) + (rH.visibility >= 0.3 ? 1 : 0);
          let condB = false;
          if (aVis > 0 && hVis > 0) {
            const ankY = ((lA.visibility >= 0.3 ? lA.y : 0) + (rA.visibility >= 0.3 ? rA.y : 0)) / aVis;
            const hipY = ((lH.visibility >= 0.3 ? lH.y : 0) + (rH.visibility >= 0.3 ? rH.y : 0)) / hVis;
            condB = ankY < hipY; // 腳高於腰（顛倒）
          }
          if (condA || condB) {
            alerts.push(makeAlert("fall_detected", condA && condB ? 0.85 : 0.65,
              `偵測到人員可能跌倒（${condA ? "橫躺比例" : ""}${condA && condB ? "＋" : ""}${condB ? "腳高於腰" : ""}）`));
            break;
          }
        } catch { /* 關鍵點資料不完整 */ }
      }

      // ── 規則 2：crowding ─────────────────────────────────────────────
      if (persons.length >= 3) {
        alerts.push(makeAlert("crowding", Math.min(1, persons.length / 5),
          `偵測到 ${persons.length} 位人員聚集（門檻 3 人）`,
          tracks.filter((t) => t.classId === COCO_ID.PERSON).map((t) => t.trackId)));
      }

      // ── 規則 3：ppe_violation ────────────────────────────────────────
      if (persons.length > 0) {
        alerts.push(makeAlert("ppe_violation", 0.40,
          `偵測到 ${persons.length} 位人員，YOLO 無法判斷 PPE 狀態，建議 VLM 確認`,
          tracks.filter((t) => t.classId === COCO_ID.PERSON).map((t) => t.trackId)));
      }

      // ── 規則 4：hazard_proximity ─────────────────────────────────────
      if (persons.length > 0 && hazards.length > 0) {
        let minD = Infinity; let hName = "";
        for (const p of persons) for (const h of hazards) {
          const d = centerDist(p, h);
          if (d < minD) { minD = d; hName = h.classEn; }
        }
        if (minD < HAZARD_FAR_THRESH) {
          alerts.push(makeAlert("hazard_proximity", minD < HAZARD_CLOSE_THRESH ? 0.90 : 0.70,
            `人員與危險物品（${hName}）距離過近（正規化距離 ${minD.toFixed(3)}）`));
        }
      }

      // ── 規則 5：vehicle_proximity ────────────────────────────────────
      if (persons.length > 0 && vehicles.length > 0) {
        let minD = Infinity; let vType = "";
        for (const p of persons) for (const v of vehicles) {
          const d = centerDist(p, v);
          if (d < minD) { minD = d; vType = v.classEn; }
        }
        alerts.push(makeAlert("vehicle_proximity", Math.min(0.95, Math.max(0.50, 1 - minD)),
          `偵測到人員與車輛（${vType}）同場，最近距離 ${minD.toFixed(3)}`,
          [...tracks.filter((t) => t.classId === COCO_ID.PERSON).map((t) => t.trackId),
           ...tracks.filter((t) => vehicleIds.has(t.classId as number)).map((t) => t.trackId)]));
      }

      // ── 規則 6：phone_usage（三重過濾，避免 AirPods/遙控器誤判）────
      if (persons.length > 0 && phones.length > 0) {
        const usagePhones = phones.filter((phone) => {
          // ① 形狀：h/w > 1.3（直向）或 < 0.7（橫向）— 排除近正方形物件
          const ar = phone.w > 0 ? phone.h / phone.w : 0;
          if (!(ar > 1.3 || ar < 0.7)) return false;
          // ② 面積：> 0.005 正規化面積
          if (phone.w * phone.h < 0.005) return false;
          // ③ 上半身接近：手機中心在人員上 3/4 範圍內（含水平 ±30% 容差）
          const pcx = phone.x + phone.w / 2;
          const pcy = phone.y + phone.h / 2;
          return persons.some((p) => {
            const mx = p.w * 0.30;
            return pcx >= p.x - mx && pcx <= p.x + p.w + mx &&
                   pcy >= p.y    && pcy <= p.y + p.h * 0.75;
          });
        });
        if (usagePhones.length > 0) {
          const maxConf = Math.max(...usagePhones.map((p) => p.confidence));
          alerts.push(makeAlert("phone_usage", Math.min(0.95, maxConf + 0.10),
            `偵測到 ${usagePhones.length} 支手機在人員上半身附近，疑似工作中使用手機`));
        }
      }

      // ── 規則 7：loitering ────────────────────────────────────────────
      const loiterTids: number[] = [];
      for (const t of tracks) {
        if (t.classId !== COCO_ID.PERSON) continue;
        const rec = movMap.get(t.trackId);
        if (rec && rec.frameCount >= LOITER_FRAME_THRESH) loiterTids.push(t.trackId);
      }
      if (loiterTids.length > 0) {
        alerts.push(makeAlert("loitering", 0.80,
          `${loiterTids.length} 位人員在同一位置停留超過 ${LOITER_FRAME_THRESH} 幀`,
          loiterTids));
      }

      // ── 規則 8：abnormal_posture ─────────────────────────────────────
      for (const pose of poses) {
        try {
          const kp = pose.keypoints;
          const heads = [kp[0], kp[1], kp[2]].filter((k) => k.visibility >= 0.3);
          const hips  = [kp[11], kp[12]].filter((k) => k.visibility >= 0.3);
          let condA = false;
          if (heads.length && hips.length) {
            const hY = heads.reduce((s, k) => s + k.y, 0) / heads.length;
            const wY = hips.reduce((s,  k) => s + k.y, 0) / hips.length;
            condA = hY > wY + 0.30; // 頭比腰低 30% 以上（深度彎腰）
          }
          const lK = kp[13]; const lA2 = kp[15]; const rK = kp[14]; const rA2 = kp[16];
          const condB = lK.visibility >= 0.3 && lA2.visibility >= 0.3 &&
                        rK.visibility >= 0.3 && rA2.visibility >= 0.3 &&
                        (Math.abs(lK.y - lA2.y) < 0.05 || Math.abs(rK.y - rA2.y) < 0.05);
          if (condA || condB) {
            alerts.push(makeAlert("abnormal_posture", 0.55,
              `偵測到異常姿態（${condA ? "深度彎腰" : ""}${condA && condB ? "、" : ""}${condB ? "蹲姿" : ""}），建議確認是否需要協助`));
            break;
          }
        } catch { /* 關鍵點資料不完整 */ }
      }

      // ── 規則 9：multiple_persons ─────────────────────────────────────
      if (persons.length >= 2) {
        const genderSummary = infos
          .filter((i) => i.gender !== "unknown")
          .reduce((acc, i) => {
            acc[i.gender] = (acc[i.gender] ?? 0) + 1;
            return acc;
          }, {} as Record<string, number>);
        const gStr = Object.entries(genderSummary)
          .map(([g, n]) => `${GENDER_ZH[g as GenderEstimate]}性 ${n} 人`)
          .join("、");
        alerts.push(makeAlert("multiple_persons", 1.0,
          `場景中偵測到 ${persons.length} 位人員${gStr ? `（${gStr}）` : ""}`,
          tracks.filter((t) => t.classId === COCO_ID.PERSON).map((t) => t.trackId)));
      }

      // ── 規則 10：person_running（奔跑 → 可能緊急情況）───────────────
      const runnerTids: number[] = [];
      for (const t of tracks) {
        if (t.classId !== COCO_ID.PERSON) continue;
        if ((movMap.get(t.trackId)?.velocity ?? 0) > RUN_SPEED_THRESH) runnerTids.push(t.trackId);
      }
      if (runnerTids.length > 0) {
        alerts.push(makeAlert("person_running", 0.75,
          `偵測到 ${runnerTids.length} 位人員快速移動，疑似奔跑，可能為緊急情況`,
          runnerTids));
      }

      // ── 規則 11：person_raising_hand（舉手 → 可能求助）──────────────
      const raiseTids: number[] = [];
      for (const info of infos) {
        if (info.action === "raising_hand" && info.trackId !== undefined) {
          raiseTids.push(info.trackId);
        }
      }
      if (raiseTids.length > 0) {
        alerts.push(makeAlert("person_raising_hand", 0.70,
          `偵測到 ${raiseTids.length} 位人員舉手，可能需要協助`,
          raiseTids));
      }

      // ── 去重 + 依風險排序 ────────────────────────────────────────────
      const seen = new Set<BehaviorType>();
      const deduped = alerts.filter((a) => { if (seen.has(a.type)) return false; seen.add(a.type); return true; });
      deduped.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]);

      setBehaviors(deduped);
      return deduped;
    },
    [],
  );

  /** 重置行為偵測器（清除移動歷史與所有狀態）*/
  const reset = useCallback((): void => {
    movHistoryRef.current.clear();
    setBehaviors([]);
    setPersonInfos([]);
  }, []);

  return { behaviors, personInfos, detect, reset };
}
