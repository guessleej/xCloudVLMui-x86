"use client";
/**
 * hooks/useBehaviorDetector.ts
 * 工廠安全行為偵測 Hook（純演算法，無 ONNX 模型）
 *
 * 輸入：
 *   - YOLO 偵測結果（YoloDetection[]）
 *   - 姿態估計結果（PoseDetection[]）
 *   - 追蹤結果（TrackedObject[]）
 *
 * 行為偵測規則（共 9 種）：
 *   1. fall_detected    — 跌倒偵測（bbox 橫寬比 + 腳踝/髖關鍵點判斷）
 *   2. crowding         — 人群聚集（≥3 人）
 *   3. ppe_violation    — PPE 缺失（低信心，需 VLM 確認）
 *   4. hazard_proximity — 危險物品接近（刀/剪刀/棒球棒與人員距離）
 *   5. vehicle_proximity — 車輛人員近距離
 *   6. phone_usage      — 工作中使用手機
 *   7. loitering        — 長時間滯留（60+ 幀位置不動）
 *   8. abnormal_posture — 異常姿態（低頭彎腰/蹲姿）
 *   9. multiple_persons — 多人同場（≥2 人）
 *
 * 效能設計：
 *   - 純 JavaScript 計算，無非同步操作
 *   - useRef 儲存滯留歷史，不觸發 re-render
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
  | "fall_detected"       // 跌倒偵測
  | "crowding"            // 人群聚集
  | "ppe_violation"       // PPE 缺失
  | "hazard_proximity"    // 危險物品接近
  | "vehicle_proximity"   // 車輛人員近距離
  | "phone_usage"         // 工作中使用手機
  | "loitering"           // 長時間滯留
  | "abnormal_posture"    // 異常姿態
  | "no_person_in_zone"   // 無人區域（監控用）
  | "multiple_persons";   // 多人同場

/** 行為警報 */
export interface BehaviorAlert {
  /** 行為類型 */
  type: BehaviorType;
  /** 繁體中文名稱 */
  nameZh: string;
  /** 英文名稱 */
  nameEn: string;
  /** 風險等級 */
  risk: ManufacturingRisk;
  /** 信心度 0~1 */
  confidence: number;
  /** 繁體中文描述 */
  description: string;
  /** 觸發此警報的 trackId 清單（如有追蹤資料）*/
  trackIds?: number[];
  /** 警報時間戳（毫秒）*/
  timestamp: number;
}

/* ═══════════════════════════════════════════════════════════════════════
   行為元數據
════════════════════════════════════════════════════════════════════════ */

const BEHAVIOR_META: Record<BehaviorType, { nameZh: string; nameEn: string; risk: ManufacturingRisk }> = {
  fall_detected:      { nameZh: "跌倒偵測",       nameEn: "Fall Detected",          risk: "critical" },
  crowding:           { nameZh: "人群聚集",        nameEn: "Crowding",                risk: "warning"  },
  ppe_violation:      { nameZh: "PPE 缺失",        nameEn: "PPE Violation",           risk: "critical" },
  hazard_proximity:   { nameZh: "危險物品接近",     nameEn: "Hazard Proximity",        risk: "critical" },
  vehicle_proximity:  { nameZh: "車輛人員近距離",   nameEn: "Vehicle-Person Proximity", risk: "critical" },
  phone_usage:        { nameZh: "工作中使用手機",   nameEn: "Phone Usage",             risk: "warning"  },
  loitering:          { nameZh: "長時間滯留",       nameEn: "Loitering",               risk: "warning"  },
  abnormal_posture:   { nameZh: "異常姿態",         nameEn: "Abnormal Posture",        risk: "warning"  },
  no_person_in_zone:  { nameZh: "無人區域",         nameEn: "No Person in Zone",       risk: "info"     },
  multiple_persons:   { nameZh: "多人同場",         nameEn: "Multiple Persons",        risk: "info"     },
};

/** 風險等級排序（critical=0 最高）*/
const RISK_ORDER: Record<ManufacturingRisk, number> = {
  critical: 0,
  warning:  1,
  safe:     2,
  info:     3,
};

/* ═══════════════════════════════════════════════════════════════════════
   常數
════════════════════════════════════════════════════════════════════════ */

/** 滯留偵測：位置不動（中心點差 < 此值）視為靜止（正規化距離）*/
const LOITER_DIST_THRESH = 0.05;
/** 滯留偵測：連續幀數 ≥ 此值視為滯留 */
const LOITER_FRAME_THRESH = 60;
/** 危險物品接近：中心點距離 < 此值（正規化）視為近距離 */
const HAZARD_CLOSE_THRESH = 0.156;    // ≈ 100px / 640
const HAZARD_FAR_THRESH   = 0.312;    // ≈ 200px / 640

/** COCO classId 映射 */
const COCO_ID = {
  PERSON:        0,
  BICYCLE:       1,
  CAR:           2,
  MOTORCYCLE:    3,
  BUS:           5,
  TRUCK:         7,
  BASEBALL_BAT:  34,
  KNIFE:         43,
  SCISSORS:      76,
  CELL_PHONE:    67,
} as const;

/* ═══════════════════════════════════════════════════════════════════════
   內部工具函式
════════════════════════════════════════════════════════════════════════ */

/**
 * 計算兩個邊界框中心點的正規化距離
 */
function centerDist(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

/**
 * 建立行為警報物件
 */
function makeAlert(
  type: BehaviorType,
  confidence: number,
  description: string,
  trackIds?: number[],
): BehaviorAlert {
  const meta = BEHAVIOR_META[type];
  return {
    type,
    nameZh:      meta.nameZh,
    nameEn:      meta.nameEn,
    risk:        meta.risk,
    confidence,
    description,
    trackIds,
    timestamp:   Date.now(),
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   滯留歷史記錄
════════════════════════════════════════════════════════════════════════ */

interface LoiterRecord {
  /** 首次靜止時的中心座標 */
  centerX: number;
  centerY: number;
  /** 持續靜止幀數 */
  frameCount: number;
}

/* ═══════════════════════════════════════════════════════════════════════
   主 Hook
════════════════════════════════════════════════════════════════════════ */

/**
 * 工廠安全行為偵測 Hook
 *
 * 純演算法實作，不載入任何 ONNX 模型。
 * 結合 YOLO 偵測、姿態估計、追蹤資料，套用工廠安全規則偵測異常行為。
 *
 * @example
 *   const { behaviors, detect, reset } = useBehaviorDetector();
 *   const alerts = detect(yoloDets, poses, tracks);
 */
export function useBehaviorDetector() {
  const [behaviors, setBehaviors] = useState<BehaviorAlert[]>([]);

  /** 滯留歷史：trackId → LoiterRecord */
  const loiterHistoryRef = useRef<Map<number, LoiterRecord>>(new Map());

  /**
   * 執行所有行為偵測規則
   * @param yoloDets  YOLO 偵測結果（來自 useYolo）
   * @param poses     姿態估計結果（來自 useYoloPose）
   * @param tracks    追蹤結果（來自 useYoloTracker）
   * @returns         本幀偵測到的行為警報（依風險降序排列）
   */
  const detect = useCallback(
    (
      yoloDets: YoloDetection[],
      poses:    PoseDetection[],
      tracks:   TrackedObject[],
    ): BehaviorAlert[] => {
      const alerts: BehaviorAlert[] = [];

      // ── 預處理：篩選各類別物件 ──────────────────────────────────────
      const persons  = yoloDets.filter((d) => d.classId === COCO_ID.PERSON);
      const vehicleIds = new Set<number>([COCO_ID.BICYCLE, COCO_ID.CAR, COCO_ID.MOTORCYCLE, COCO_ID.BUS, COCO_ID.TRUCK]);
      const hazardIds  = new Set<number>([COCO_ID.KNIFE, COCO_ID.SCISSORS, COCO_ID.BASEBALL_BAT]);
      const vehicles = yoloDets.filter((d) => vehicleIds.has(d.classId as number));
      const hazards  = yoloDets.filter((d) => hazardIds.has(d.classId as number));
      const phones   = yoloDets.filter((d) => d.classId === COCO_ID.CELL_PHONE);

      // ─────────────────────────────────────────────────────────────────
      // 規則 1：fall_detected — 跌倒偵測
      // 條件 A：pose bbox 橫寬比 > 1.4（躺臥姿）
      // 條件 B：腳踝 y < 髖關節 y（頭腳顛倒）
      // ─────────────────────────────────────────────────────────────────
      for (const pose of poses) {
        try {
          const condA = pose.w > pose.h * 1.4;

          // 取可見的關鍵點（visibility ≥ 0.3）
          const kp = pose.keypoints;
          const leftAnkle  = kp[15];
          const rightAnkle = kp[16];
          const leftHip    = kp[11];
          const rightHip   = kp[12];

          const ankleVis = (leftAnkle.visibility >= 0.3 ? 1 : 0) + (rightAnkle.visibility >= 0.3 ? 1 : 0);
          const hipVis   = (leftHip.visibility >= 0.3   ? 1 : 0) + (rightHip.visibility >= 0.3   ? 1 : 0);

          let condB = false;
          if (ankleVis > 0 && hipVis > 0) {
            const avgAnkleY = (
              (leftAnkle.visibility >= 0.3  ? leftAnkle.y  : 0) +
              (rightAnkle.visibility >= 0.3 ? rightAnkle.y : 0)
            ) / ankleVis;
            const avgHipY = (
              (leftHip.visibility >= 0.3  ? leftHip.y  : 0) +
              (rightHip.visibility >= 0.3 ? rightHip.y : 0)
            ) / hipVis;
            // y 軸向下，腳踝 y < 髖部 y 代表腳比腰高（顛倒）
            condB = avgAnkleY < avgHipY;
          }

          if (condA || condB) {
            const confidence = condA && condB ? 0.8 : 0.6;
            alerts.push(makeAlert(
              "fall_detected",
              confidence,
              `偵測到人員可能跌倒（${condA ? "橫躺姿態" : ""}${condA && condB ? "、" : ""}${condB ? "腳高於腰" : ""}）`,
            ));
            break;  // 每幀只報一次
          }
        } catch {
          // 關鍵點資料不完整，跳過
        }
      }

      // ─────────────────────────────────────────────────────────────────
      // 規則 2：crowding — 人群聚集（≥3 人）
      // ─────────────────────────────────────────────────────────────────
      if (persons.length >= 3) {
        const confidence = Math.min(1, persons.length / 5);
        alerts.push(makeAlert(
          "crowding",
          confidence,
          `偵測到 ${persons.length} 位人員聚集，超過 3 人門檻`,
          tracks.filter((t) => t.classId === COCO_ID.PERSON).map((t) => t.trackId),
        ));
      }

      // ─────────────────────────────────────────────────────────────────
      // 規則 3：ppe_violation — PPE 缺失
      // 說明：COCO-80 無 PPE 類別，僅在有人員時發出低信心警告，
      //       需由 VLM 進行確認
      // ─────────────────────────────────────────────────────────────────
      if (persons.length > 0) {
        alerts.push(makeAlert(
          "ppe_violation",
          0.4,
          `偵測到 ${persons.length} 位人員，無法從 YOLO 判斷 PPE 狀態，建議以 VLM 確認`,
          tracks.filter((t) => t.classId === COCO_ID.PERSON).map((t) => t.trackId),
        ));
      }

      // ─────────────────────────────────────────────────────────────────
      // 規則 4：hazard_proximity — 危險物品接近
      // 條件：人員與危險物品中心距離 < HAZARD_FAR_THRESH
      // ─────────────────────────────────────────────────────────────────
      if (persons.length > 0 && hazards.length > 0) {
        let minDist  = Infinity;
        let hazardEn = "";

        for (const person of persons) {
          for (const hazard of hazards) {
            const dist = centerDist(person, hazard);
            if (dist < minDist) {
              minDist  = dist;
              hazardEn = hazard.classEn;
            }
          }
        }

        if (minDist < HAZARD_FAR_THRESH) {
          const confidence = minDist < HAZARD_CLOSE_THRESH ? 0.9 : 0.7;
          alerts.push(makeAlert(
            "hazard_proximity",
            confidence,
            `人員與危險物品（${hazardEn}）距離過近（正規化距離 ${minDist.toFixed(3)}）`,
          ));
        }
      }

      // ─────────────────────────────────────────────────────────────────
      // 規則 5：vehicle_proximity — 車輛人員近距離
      // 條件：偵測到人員且同幀有車輛
      // ─────────────────────────────────────────────────────────────────
      if (persons.length > 0 && vehicles.length > 0) {
        let minDist     = Infinity;
        let vehicleType = "";

        for (const person of persons) {
          for (const vehicle of vehicles) {
            const dist = centerDist(person, vehicle);
            if (dist < minDist) {
              minDist     = dist;
              vehicleType = vehicle.classEn;
            }
          }
        }

        // 依距離計算信心度
        const confidence = Math.min(0.95, Math.max(0.5, 1 - minDist));
        alerts.push(makeAlert(
          "vehicle_proximity",
          confidence,
          `偵測到人員與車輛（${vehicleType}）同場，最近距離 ${minDist.toFixed(3)}（正規化）`,
          [
            ...tracks.filter((t) => t.classId === COCO_ID.PERSON).map((t) => t.trackId),
            ...tracks.filter((t) => vehicleIds.has(t.classId as number)).map((t) => t.trackId),
          ],
        ));
      }

      // ─────────────────────────────────────────────────────────────────
      // 規則 6：phone_usage — 工作中使用手機
      // 條件：偵測到人員且偵測到手機
      // ─────────────────────────────────────────────────────────────────
      if (persons.length > 0 && phones.length > 0) {
        alerts.push(makeAlert(
          "phone_usage",
          0.85,
          `偵測到 ${phones.length} 支手機，疑似工作中使用手機`,
        ));
      }

      // ─────────────────────────────────────────────────────────────────
      // 規則 7：loitering — 長時間滯留
      // 條件：同一 trackId 在 LOITER_FRAME_THRESH 幀內位置不動
      // ─────────────────────────────────────────────────────────────────
      const loiterMap  = loiterHistoryRef.current;
      const activeTids = new Set(tracks.map((t) => t.trackId));
      const loiterAlertTids: number[] = [];

      // 清除已消失軌跡的記錄
      Array.from(loiterMap.keys()).forEach((tid) => {
        if (!activeTids.has(tid)) loiterMap.delete(tid);
      });

      for (const track of tracks) {
        if (track.classId !== COCO_ID.PERSON) continue;

        const cx = track.x + track.w / 2;
        const cy = track.y + track.h / 2;
        const existing = loiterMap.get(track.trackId);

        if (existing) {
          const moved = Math.sqrt(
            (cx - existing.centerX) ** 2 + (cy - existing.centerY) ** 2,
          );
          if (moved < LOITER_DIST_THRESH) {
            existing.frameCount++;
            if (existing.frameCount >= LOITER_FRAME_THRESH) {
              loiterAlertTids.push(track.trackId);
            }
          } else {
            // 移動了，重置
            existing.centerX    = cx;
            existing.centerY    = cy;
            existing.frameCount = 0;
          }
        } else {
          loiterMap.set(track.trackId, { centerX: cx, centerY: cy, frameCount: 1 });
        }
      }

      if (loiterAlertTids.length > 0) {
        alerts.push(makeAlert(
          "loitering",
          0.8,
          `${loiterAlertTids.length} 位人員在同一位置停留超過 ${LOITER_FRAME_THRESH} 幀`,
          loiterAlertTids,
        ));
      }

      // ─────────────────────────────────────────────────────────────────
      // 規則 8：abnormal_posture — 異常姿態
      // 條件 A：頭部關鍵點 y > 髖關節 y + 0.3（低頭彎腰）
      // 條件 B：膝蓋 y 接近腳踝 y（蹲姿）
      // ─────────────────────────────────────────────────────────────────
      for (const pose of poses) {
        try {
          const kp = pose.keypoints;
          let condA = false;
          let condB = false;

          // 頭部關鍵點（鼻、左眼、右眼）
          const headKps = [kp[0], kp[1], kp[2]].filter((k) => k.visibility >= 0.3);
          const hipKps  = [kp[11], kp[12]].filter((k) => k.visibility >= 0.3);

          if (headKps.length > 0 && hipKps.length > 0) {
            const avgHeadY = headKps.reduce((s, k) => s + k.y, 0) / headKps.length;
            const avgHipY  = hipKps.reduce((s, k) => s + k.y,  0) / hipKps.length;
            // 正規化 y 軸向下，頭部 y > 髖部 y + 0.3 代表頭比腰低很多（彎腰）
            condA = avgHeadY > avgHipY + 0.3;
          }

          // 膝蓋 vs 腳踝（蹲姿：膝蓋 y 接近腳踝 y，差值 < 0.05）
          const leftKnee   = kp[13];
          const leftAnkle  = kp[15];
          const rightKnee  = kp[14];
          const rightAnkle = kp[16];

          if (
            leftKnee.visibility >= 0.3 && leftAnkle.visibility >= 0.3 &&
            rightKnee.visibility >= 0.3 && rightAnkle.visibility >= 0.3
          ) {
            const lDiff = Math.abs(leftKnee.y  - leftAnkle.y);
            const rDiff = Math.abs(rightKnee.y - rightAnkle.y);
            condB = lDiff < 0.05 || rDiff < 0.05;
          }

          if (condA || condB) {
            alerts.push(makeAlert(
              "abnormal_posture",
              0.5,
              `偵測到異常姿態（${condA ? "低頭彎腰" : ""}${condA && condB ? "、" : ""}${condB ? "蹲姿" : ""}），建議確認是否需要協助`,
            ));
            break;  // 每幀只報一次
          }
        } catch {
          // 關鍵點資料不完整，跳過
        }
      }

      // ─────────────────────────────────────────────────────────────────
      // 規則 9：multiple_persons — 多人同場（≥2 人）
      // ─────────────────────────────────────────────────────────────────
      if (persons.length >= 2) {
        alerts.push(makeAlert(
          "multiple_persons",
          1.0,
          `場景中偵測到 ${persons.length} 位人員`,
          tracks.filter((t) => t.classId === COCO_ID.PERSON).map((t) => t.trackId),
        ));
      }

      // ── 去重：同類型行為只保留一個（除非 trackIds 不同）──
      const seen    = new Set<BehaviorType>();
      const deduped = alerts.filter((a) => {
        if (seen.has(a.type)) return false;
        seen.add(a.type);
        return true;
      });

      // ── 依風險等級降序排列（critical 優先）──
      deduped.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]);

      setBehaviors(deduped);
      return deduped;
    },
    [],
  );

  /**
   * 重置行為偵測器（清除滯留歷史與警報狀態）
   */
  const reset = useCallback((): void => {
    loiterHistoryRef.current.clear();
    setBehaviors([]);
  }, []);

  return { behaviors, detect, reset };
}
