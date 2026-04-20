"use client";

/**
 * components/vlm/camera-stream.tsx
 * 跨裝置即時影像辨識元件
 *
 * 支援：筆電（Chrome/Safari/Firefox）、手機（iOS Safari / Android Chrome）、平板
 * 技術棧：
 *   - 影像擷取：navigator.mediaDevices.getUserMedia()（瀏覽器原生 WebRTC）
 *   - 推論串流：WebSocket → /api/vlm/ws（token-by-token 即時輸出）
 *   - 備援方案：HTTP POST → /api/vlm/diagnose（WS 不可用時自動切換）
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Activity,
  Camera,
  CameraOff,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  History,
  Loader2,
  MapPin,
  Package,
  Pause,
  Play,
  ScanSearch,
  Settings2,
  Shield,
  SwitchCamera,
  Sun,
  Users,
  Video,
  X,
  Zap,
  ZoomIn,
} from "lucide-react";
import toast from "react-hot-toast";
import { vlmApi, getVlmWsUrl, modelsApi } from "@/lib/api";
import { useYolo, type YoloDetection, calcManufacturingStats } from "@/hooks/useYolo";
import { useYoloPose, type PoseDetection, drawPoseOverlay, poseToDbFormat } from "@/hooks/useYoloPose";
import { useYoloSegment, type SegmentDetection } from "@/hooks/useYoloSegment";
import { useYoloClassify, type ClassifyResult } from "@/hooks/useYoloClassify";
import { useBehaviorDetector, type BehaviorAlert, type PersonInfo, ACTION_ZH, GENDER_ZH } from "@/hooks/useBehaviorDetector";
import { SortTracker, type TrackedObject, drawTrackIds } from "@/lib/yoloTracker";
import type { TrainedModel } from "@/types";

/* ═══════════════════════════════════════════════════════════════════════════
   型別定義
════════════════════════════════════════════════════════════════════════════ */

export interface AnalysisEntry {
  id: string;
  timestamp: Date;
  thumbnail: string;    // data URL
  result: string;
  prompt: string;
  durationMs: number;
}

type CameraPermission = "prompt" | "granted" | "denied" | "unsupported";
type WsStatus = "disconnected" | "connecting" | "connected" | "error";
type FacingMode = "user" | "environment";

export interface CameraStreamProps {
  /** 每次分析完成後的回調（可用於更新外部狀態）*/
  onAnalysisComplete?: (entry: AnalysisEntry) => void;
  /** 提供最新 (imageBase64, result) 供外部「儲存報告」使用 */
  onFrameCapture?: (imageBase64: string, result: string) => void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   偵測物件與環境資訊型別
════════════════════════════════════════════════════════════════════════════ */

/**
 * 偵測框物件（解析 VLM 輸出後產生）
 * 座標系：正規化 0~1，相對影像寬高
 */
export interface DetectedObject {
  id:         string;
  label:      string;
  status:     "ok" | "warning" | "critical" | "unknown";
  confidence: "high" | "medium" | "low";
  x: number;  y: number;  w: number;  h: number;
}

/**
 * 環境辨識資訊（人員辨識模式專用）
 * 從 VLM 輸出的 ENV: 行解析
 */
export interface EnvironmentInfo {
  scene:    string;                                       // 場景類型
  lighting: "good" | "poor" | "hazard" | "unknown";      // 照明狀況
  floor:    "clear" | "wet" | "cluttered" | "hazard" | "unknown"; // 地面狀況
  risk:     "low" | "medium" | "high" | "unknown";       // 風險等級
  activity: string;                                       // 正在進行的活動
  count:    number;                                       // 偵測人數
}

/* ═══════════════════════════════════════════════════════════════════════════
   辨識模式定義
════════════════════════════════════════════════════════════════════════════ */

interface RecognitionMode {
  key: string;
  label: string;
  labelEn: string;
  icon: React.ReactNode;
  prompt: string;
  color: string;
}

const RECOGNITION_MODES: RecognitionMode[] = [
  {
    key:     "equipment",
    label:   "設備巡檢",
    labelEn: "Equipment",
    icon:    <Zap className="h-3.5 w-3.5" />,
    color:   "brand",
    prompt: `你是資深工業設備診斷工程師，專精機械、電氣、液壓、氣壓與熱力系統故障分析。請對影像中所有設備元件執行完整健康評估。

【偵測清單】每個設備元件或異常徵兆各佔一行（必須先輸出此區塊）：
DETECT: [元件名稱/異常描述] | POS: [left/center/right] | VERT: [top/middle/bottom] | STATUS: [ok/warning/critical] | CONF: [high/medium/low] | TYPE: [mechanical/electrical/thermal/structural/fluid/corrosion/wear]

STATUS 評判標準：
  ok       = 正常運作，無可見異常
  warning  = 輕度異常（建議 7–30 天內排程維護）
  critical = 嚴重異常（需 24 小時內停機檢查）

TYPE 故障類型分類：
  mechanical  = 鬆脫、變形、斷裂、對齊偏差、異常磨耗
  electrical  = 燒焦痕、電弧燒蝕、接線異常、保險絲熔斷、碳化痕跡
  thermal     = 過熱變色、冷卻堵塞、隔熱材料損壞、熱斑
  structural  = 外殼凹陷、裂縫、焊接失效、支撐架變形
  fluid       = 漏油、漏水、液壓管路洩漏、密封件老化、滲漏痕跡
  corrosion   = 鏽蝕、電化學腐蝕、表面氧化、點蝕
  wear        = 磨耗超限、接觸面劣化、密封面刮傷、疲勞紋路

【健康評分】（必須輸出此行）：
VHS: [0–100整數] | REASON: [主要扣分因素，不超過20字]

VHS 評分參考：90–100=優良無異常 / 70–89=輕度老化 / 50–69=中度異常需監控 / 30–49=高風險需盡快維護 / 0–29=嚴重故障需立即停機

【診斷摘要】3–5 句完整診斷，依序包含：
1. 最嚴重異常項目與推測失效模式（如：軸承磨損、絕緣劣化、管路疲勞裂縫）
2. 潛在根本原因分析（潤滑不足、過載、老化、環境腐蝕等）
3. 立即處置建議（停機/降載/增加巡檢頻率）
4. 預防性維護與改善建議`,
  },
  {
    key:     "people",
    label:   "人員辨識",
    labelEn: "People",
    icon:    <Users className="h-3.5 w-3.5" />,
    color:   "emerald",
    prompt: `你是資深工業安全衛生工程師（ISO 45001 / OSHA 標準），請對影像進行全面工安合規評估。

【人員偵測】每位人員各佔一行（必須先輸出此區塊）：
DETECT: [人員ID/特徵描述] | POS: [left/center/right] | VERT: [top/middle/bottom] | STATUS: [ok/warning/critical] | CONF: [high/medium/low] | PPE: [compliant/partial/violation] | POSTURE: [normal/ergonomic-risk/danger]

STATUS 評判標準：
  ok       = 安全合規，PPE 完整正確佩戴，姿勢無風險
  warning  = PPE 部分缺失或有人因工程風險，需即時糾正
  critical = 危險行為、PPE 嚴重不足、高墜落/夾捲/觸電/被撞擊風險

PPE 合規評估項目（依場景適用性判斷）：
  ✔ 安全帽（頭部防護）  ✔ 反光安全背心（可視度）  ✔ 安全手套（手部防護）
  ✔ 安全鞋/鋼頭靴（足部防護）  ✔ 護目鏡/防護面罩（眼臉防護）
  ✔ 耳塞/耳罩（高噪環境）  ✔ 安全帶/扣環（高空或墜落風險）
  ✔ 防護口罩/呼吸器（粉塵/化學品環境）

POSTURE 姿勢評估：
  normal         = 標準站姿/坐姿，脊椎中立，無過度施力
  ergonomic-risk = 彎腰超過 45°、手臂過度伸展、扭轉脊椎、重複性動作
  danger         = 攀爬危險位置、站在不穩定表面、進入旋轉/夾捲危險區

【環境安全評估】（必須輸出此行）：
ENV: [場景類型] | LIGHT: [good/poor/hazard] | FLOOR: [clear/wet/cluttered/hazard] | RISK: [low/medium/high/critical] | ACTIVITY: [正在進行的活動] | COUNT: [人數] | ZONE: [general/restricted/permit-required]

場景類型例：工廠廠房、辦公室、倉庫、戶外工地、實驗室、機電室、高架平台、化學品儲存區...
LIGHT：good=充足 / poor=不足陰暗 / hazard=強光眩目或危險輻射光源
FLOOR：clear=乾淨通暢 / wet=潮濕濕滑 / cluttered=雜亂有障礙 / hazard=危險地面（化學品/破碎/坑洞）
ZONE：general=一般作業區 / restricted=限制區（需特定PPE） / permit-required=許可作業區（需書面許可）

【合規摘要】2–4 句，依序包含：
1. 各人員 PPE 合規狀態與具體缺失項目
2. 姿勢/行為安全風險描述與傷害潛在後果
3. 環境危害因子識別（跌倒/物體打擊/感電/火災等）
4. 立即改善建議與對應安全法規條款（如適用）`,
  },
  {
    key:     "events",
    label:   "事件偵測",
    labelEn: "Events",
    icon:    <ZoomIn className="h-3.5 w-3.5" />,
    color:   "amber",
    prompt: `你是資深工廠事件分析師與緊急應變專家，專精異常事件快速識別、風險評估與應變分級。請分析影像中所有正在發生或即將發生的事件。

【事件偵測清單】每個事件各佔一行（必須先輸出此區塊）：
DETECT: [事件名稱/描述] | POS: [left/center/right] | VERT: [top/middle/bottom] | STATUS: [ok/warning/critical/emergency] | CONF: [high/medium/low] | CATEGORY: [near-miss/hazard/emergency/violation/abnormal/normal] | URGENCY: [immediate/urgent/monitor/none]

STATUS 評判標準：
  ok        = 正常作業活動，無需特別關注
  warning   = 潛在風險已出現，需監控或 30 分鐘內通報
  critical  = 嚴重事件已發生或即將發生，需立即介入
  emergency = 緊急狀態（人員傷亡/火災/爆炸/化學洩漏），啟動緊急應變

CATEGORY 事件分類：
  near-miss  = 意外未遂（險些造成傷亡但未發生）
  hazard     = 危害源暴露（火源、化學品、能量未隔離、高壓電未標示）
  emergency  = 緊急狀況（火災/爆炸/人員受困/化學洩漏/溺水/觸電）
  violation  = 安全規程違反（未依 SOP 作業、擅自解除安全防護）
  abnormal   = 設備或製程異常行為（非預期動作、異常聲音/氣味/震動）
  normal     = 正常作業行為

URGENCY 緊急程度：
  immediate = 立即停工，啟動緊急應變程序（0–5 分鐘內行動）
  urgent    = 緊急通報主管，暫停相關作業（5–30 分鐘內處理）
  monitor   = 持續監控，填寫異常通報單（當班內追蹤）
  none      = 記錄備查，無需立即行動

【風險矩陣評估】（必須輸出此行）：
RISK_MATRIX: 發生可能性=[很低/低/中/高/很高] | 影響嚴重度=[輕微/中等/嚴重/極嚴重/災難性] | 風險等級=[可接受/需監控/不可接受/禁止作業]

【應變摘要】3–5 句，依序包含：
1. 最高風險事件完整描述（Who/What/Where/When）
2. 潛在傷亡後果與財損估計
3. 立即應變措施（疏散/停機/隔離/急救/通報）
4. 責任單位與通報對象（安全主管/消防/急救）
5. 相關 SOP 編號或安全法規條款（如能識別）`,
  },
  {
    key:     "objects",
    label:   "物品辨識",
    labelEn: "Objects",
    icon:    <Package className="h-3.5 w-3.5" />,
    color:   "violet",
    prompt: `你是資深工廠物料管理與品質工程師，熟悉 5S 管理、FIFO/FEFO、危險物品存放法規（CNS/OSHA/GHS）。請對影像中所有可見物品進行完整盤點與合規評估。

【物品偵測清單】每個物品各佔一行（必須先輸出此區塊）：
DETECT: [物品名稱/規格描述] | POS: [left/center/right] | VERT: [top/middle/bottom] | STATUS: [ok/warning/critical] | CONF: [high/medium/low] | CLASS: [raw-material/wip/finished/tool/consumable/hazmat/waste/equipment/unknown] | COMPLIANCE: [compliant/non-compliant/unknown]

STATUS 評判標準：
  ok       = 完好可用，標示清楚，存放位置合規
  warning  = 輕度磨損/標示模糊/位置需改善，建議近期處理
  critical = 嚴重損壞/危險物品暴露/存放嚴重違規，需立即移除或隔離

CLASS 物品分類（GHS/5S 標準）：
  raw-material = 原物料（未加工原料）
  wip          = 在製品（加工中半成品）
  finished     = 成品（已完成製造）
  tool         = 工具（手工具/量具/治具/夾具）
  consumable   = 消耗品（耗材/備品/包材）
  hazmat       = 危險物品（化學品/腐蝕性/易燃/氣瓶/鋰電池組/輻射源）
  waste        = 廢棄物（廢料/廢液/廢氣容器/一般垃圾）
  equipment    = 設備/機台/工業裝置

COMPLIANCE 存放合規評估：
  compliant     = 符合 5S/SOP/法規存放要求（標示清楚、位置正確、固定穩固）
  non-compliant = 違反存放規範（說明：高度超限/混放不相容化學品/無標示/阻塞通道）
  unknown       = 無法從影像判斷

【5S 審計評分】（必須輸出此行）：
5S: 整理=[1-5] | 整頓=[1-5] | 清掃=[1-5] | 清潔=[1-5] | 素養=[1-5] | 總分=[5-25] | 等級=[優/良/中/差]

5S 評分標準：整理=必要品區分；整頓=定位定量；清掃=無塵無汙染；清潔=維持標準化；素養=遵守紀律
等級：20–25=優 / 15–19=良 / 10–14=中 / 5–9=差

【物品盤點摘要】3–5 句，依序包含：
1. 危險物品（hazmat）清單與存放合規狀態（重點標示 GHS 危害分類）
2. 主要 5S 缺失項目與具體改善建議（定點定位/顏色標示/清掃計畫）
3. 物料損壞、變質或流失風險評估
4. FIFO/FEFO 是否可判斷（先進先出/先到期先使用）
5. 是否有不相容物品混放風險（如：氧化劑與可燃物）`,
  },

  // ── AUTO 統一全模式（合併四種模式：Equipment + People + Events + Objects）──
  // YOLO 後端：detect (YOLO26n COCO-80) + pose (YOLO26n-Pose COCO-17kp) 同時並行
  // VLM 提示：整合四種專業角色，單次推論涵蓋所有維度
  {
    key:     "auto",
    label:   "統一全模式",
    labelEn: "AUTO",
    icon:    <Cpu className="h-3.5 w-3.5" />,
    color:   "rose",
    prompt: `你是資深工廠視覺 AI 分析師，同時具備以下四項專業能力：
① 工業設備診斷工程師（ISO 13374 狀態監測）
② 工業安全衛生工程師（ISO 45001 / OSHA）
③ 工廠事件分析師與緊急應變專家
④ 物料管理與品質工程師（5S / GHS）

請對影像執行**全面統一分析**，涵蓋所有可見元素。

【YOLO 偵測背景資訊】（由前端 YOLO26n E2E 即時偵測提供參考）：
- detect 模型：YOLO26n COCO-80（設備/車輛/工具/物品/人員偵測）
- pose 模型：YOLO26n-Pose COCO-17kp（人員姿態 17 關鍵點骨架）
- 偵測類別含：person, car, truck, knife, scissors, bottle, laptop, cell phone 等
- 請結合 YOLO 偵測框與影像內容進行更精確的工業場景分析

【全域偵測清單】每個可見元素各佔一行（必須先輸出此區塊）：
DETECT: [名稱/描述] | POS: [left/center/right] | VERT: [top/middle/bottom] | STATUS: [ok/warning/critical] | CONF: [high/medium/low] | CATEGORY: [equipment/person/event/object/hazard/environment]

CATEGORY 分類：
  equipment   = 機械/電氣/管路/結構/儀表等工業設備元件
  person      = 作業人員（含 PPE：安全帽/反光背心/手套/安全鞋/護目鏡狀態）
  event       = 正在發生的事件或異常活動（near-miss/violation/emergency）
  object      = 物料/工具/成品/廢料等可識別物品
  hazard      = 危害源（危險物品/GHS 化學品/暴露能量/不安全狀態）
  environment = 場景/環境元素（地板/照明/通道/空間/5S 狀態）

【設備健康評分】（若影像含工業設備則必須輸出）：
VHS: [0–100整數] | REASON: [主要扣分因素，不超過20字]
VHS 參考：90–100=優良 / 70–89=輕度老化 / 50–69=需監控 / 30–49=高風險 / 0–29=立即停機

【人員工安評估】（若影像含人員則必須輸出）：
PPE: 合規人數=[N] | 違規人數=[N] | 缺失項目=[安全帽/背心/手套/等] | 姿勢風險=[none/ergonomic/danger]
POSTURE 參考：YOLO26n-Pose 已提供 17 關鍵點（鼻/眼/耳/肩/肘/腕/髖/膝/踝）可輔助判斷彎腰/過伸/扭轉風險

【5S 審計評分】（若影像含工作場所則必須輸出）：
5S: 整理=[1-5] | 整頓=[1-5] | 清掃=[1-5] | 清潔=[1-5] | 素養=[1-5] | 總分=[5-25] | 等級=[優/良/中/差]

【環境安全評估】（必須輸出此行）：
ENV: [場景類型] | LIGHT: [good/poor/hazard] | FLOOR: [clear/wet/cluttered/hazard] | RISK: [low/medium/high/critical] | ACTIVITY: [正在進行的活動] | COUNT: [人數] | ZONE: [general/restricted/permit-required]

【風險矩陣評估】（必須輸出此行）：
RISK_MATRIX: 發生可能性=[很低/低/中/高/很高] | 影響嚴重度=[輕微/中等/嚴重/極嚴重/災難性] | 風險等級=[可接受/需監控/不可接受/禁止作業]

【全面診斷摘要】4–6 句，依序包含：
1. 最高風險項目（設備故障/人員安全/危害事件/GHS 危險物品）及其失效模式
2. PPE 合規狀態與具體缺失項目（若有人員）
3. 環境危害因子、5S 主要缺失與根本原因
4. 立即處置建議（依優先順序：停機/疏散/隔離/急救/通報）
5. 預防性維護與系統改善建議（含 ISO 法規條款如適用）`,
  },
];

const DEFAULT_MODE_KEY = "auto";
const DEFAULT_PROMPT = RECOGNITION_MODES.find((m) => m.key === "auto")!.prompt;

const FRAME_JPEG_QUALITY = 0.75;
const MAX_HISTORY = 20;
const WS_RECONNECT_MS = 3_000;
const VIDEO_CONSTRAINTS = {
  width:  { ideal: 1280, max: 1920 },
  height: { ideal: 720,  max: 1080 },
};

/* ═══════════════════════════════════════════════════════════════════════════
   工具函式
════════════════════════════════════════════════════════════════════════════ */

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * 解析 VLM 輸出中的 DETECT: 行，轉換為偵測框物件
 */
function parseDetections(text: string): DetectedObject[] {
  const POS_MAP: Record<string, { x: number; w: number }> = {
    left:   { x: 0.03, w: 0.38 },
    center: { x: 0.31, w: 0.38 },
    right:  { x: 0.59, w: 0.38 },
  };
  const VERT_MAP: Record<string, { y: number; h: number }> = {
    top:    { y: 0.03, h: 0.38 },
    middle: { y: 0.31, h: 0.38 },
    bottom: { y: 0.59, h: 0.38 },
  };
  const STATUS_MAP: Record<string, DetectedObject["status"]> = {
    ok: "ok", warning: "warning", critical: "critical",
  };
  const CONF_MAP: Record<string, DetectedObject["confidence"]> = {
    high: "high", medium: "medium", low: "low",
  };

  const results: DetectedObject[] = [];
  const lines = text.split(/\n/);

  for (const line of lines) {
    if (!line.trimStart().startsWith("DETECT:")) continue;
    const parts: Record<string, string> = {};
    const segs = line.replace(/^.*?DETECT:\s*/, "").split(/\s*\|\s*/);
    const label = segs[0]?.trim() ?? "Unknown";
    for (let i = 1; i < segs.length; i++) {
      const [k, v] = segs[i].split(":").map((s) => s.trim().toLowerCase());
      if (k && v) parts[k] = v;
    }
    const pos  = POS_MAP[parts["pos"] ?? "center"]  ?? POS_MAP.center;
    const vert = VERT_MAP[parts["vert"] ?? "middle"] ?? VERT_MAP.middle;
    results.push({
      id:         `${Date.now()}-${results.length}`,
      label,
      status:     STATUS_MAP[parts["status"]] ?? "unknown",
      confidence: CONF_MAP[parts["conf"]]     ?? "medium",
      ...pos,
      ...vert,
    });
  }
  return results;
}

/** 從 VLM 文字推算風險等級（與 vlm/page.tsx 共用邏輯）*/
function inferRiskFromText(text: string): "critical" | "elevated" | "moderate" | "low" {
  const t = text.toLowerCase();
  if (/critical|立即|緊急|危險|嚴重故障|immediate|火災|爆炸/.test(t)) return "critical";
  if (/warning|警告|異常|elevated|注意|可能|故障|損壞/.test(t))          return "elevated";
  if (/normal|正常|良好|good|healthy|無異常/.test(t))                     return "low";
  return "moderate";
}

/**
 * 從 VLM 輸出中提取人類可讀摘要（去除 DETECT:/ENV: 結構行）
 * 用於歷史記錄顯示
 */
function extractSummaryText(text: string): string {
  const STRUCTURAL_PREFIXES = ["DETECT:", "ENV:", "VHS:", "5S:", "RISK_MATRIX:"];
  const lines = text.split("\n").filter(
    (l) => !STRUCTURAL_PREFIXES.some((p) => l.trimStart().startsWith(p))
  );
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 解析 VLM 輸出中的 ENV: 行，轉換為環境資訊物件
 * 格式：ENV: [場景] | LIGHT: [good/poor/hazard] | FLOOR: [clear/wet/cluttered/hazard]
 *           | RISK: [low/medium/high] | ACTIVITY: [描述] | COUNT: [人數]
 * 支援部分解析（串流過程中逐步填入）
 */
function parseEnvironment(text: string): EnvironmentInfo | null {
  // 尋找 ENV: 行（可能是部分或完整）
  const envLineMatch = text.match(/ENV:\s*([^\n]+)/i);
  if (!envLineMatch) return null;

  const envLine = envLineMatch[1];
  const segs = envLine.split(/\s*\|\s*/);

  const scene    = segs[0]?.trim() || "場景分析中…";
  const parts: Record<string, string> = {};
  for (let i = 1; i < segs.length; i++) {
    const colonIdx = segs[i].indexOf(":");
    if (colonIdx === -1) continue;
    const k = segs[i].slice(0, colonIdx).trim().toLowerCase();
    const v = segs[i].slice(colonIdx + 1).trim().toLowerCase();
    if (k && v) parts[k] = v;
  }

  const lightRaw = parts["light"] ?? "";
  const lighting: EnvironmentInfo["lighting"] =
    lightRaw === "good" ? "good" :
    lightRaw === "poor" ? "poor" :
    lightRaw === "hazard" ? "hazard" : "unknown";

  const floorRaw = parts["floor"] ?? "";
  const floor: EnvironmentInfo["floor"] =
    floorRaw === "clear" ? "clear" :
    floorRaw === "wet" ? "wet" :
    floorRaw === "cluttered" ? "cluttered" :
    floorRaw === "hazard" ? "hazard" : "unknown";

  const riskRaw = parts["risk"] ?? "";
  const risk: EnvironmentInfo["risk"] =
    riskRaw === "low" ? "low" :
    riskRaw === "medium" ? "medium" :
    riskRaw === "high" ? "high" : "unknown";

  const activity = parts["activity"] ?? "";
  const countStr = parts["count"] ?? "0";
  const count = parseInt(countStr) || 0;

  return { scene, lighting, floor, risk, activity, count };
}

/** 取得偵測狀態對應顏色 */
function getDetectionColor(status: DetectedObject["status"]): { stroke: string; fill: string } {
  switch (status) {
    case "ok":       return { stroke: "#34d399", fill: "rgba(52,211,153,0.15)" };
    case "warning":  return { stroke: "#fbbf24", fill: "rgba(251,191,36,0.15)" };
    case "critical": return { stroke: "#f87171", fill: "rgba(248,113,113,0.18)" };
    default:         return { stroke: "#94a3b8", fill: "rgba(148,163,184,0.12)" };
  }
}

/** 在 Canvas 上繪製偵測框與標籤 */
function drawDetectionOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  objects: DetectedObject[]
): void {
  const rect = video.getBoundingClientRect();
  canvas.width  = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!objects.length) return;

  const W = canvas.width;
  const H = canvas.height;

  for (const obj of objects) {
    const col = getDetectionColor(obj.status);
    const bx = obj.x * W;
    const by = obj.y * H;
    const bw = obj.w * W;
    const bh = obj.h * H;

    ctx.fillStyle = col.fill;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 8);
    ctx.fill();

    ctx.strokeStyle = col.stroke;
    ctx.lineWidth   = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 8);
    ctx.stroke();

    // L 型角落標記
    const cornerLen = Math.min(20, bw * 0.15, bh * 0.15);
    ctx.lineWidth = 3;
    const corners: [number, number, number, number][] = [
      [bx, by, 1, 1], [bx + bw, by, -1, 1],
      [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1],
    ];
    for (const [cx, cy, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * cornerLen, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy * cornerLen);
      ctx.stroke();
    }

    // 標籤
    const confIcon = obj.confidence === "high" ? "●●●" : obj.confidence === "medium" ? "●●○" : "●○○";
    const fontSize  = Math.max(11, Math.min(14, W * 0.018));
    ctx.font        = `bold ${fontSize}px "SF Pro Display", system-ui, sans-serif`;
    const textW     = ctx.measureText(obj.label).width;
    const confW     = ctx.measureText(confIcon).width;
    const labelW    = textW + confW + 16;
    const labelH    = fontSize + 10;
    const labelX    = Math.min(bx, W - labelW - 4);
    const labelY    = by > labelH + 4 ? by - labelH - 2 : by + bh + 2;

    ctx.fillStyle   = col.stroke;
    ctx.beginPath();
    ctx.roundRect(labelX, labelY, labelW, labelH, 5);
    ctx.fill();

    ctx.fillStyle = "#0f172a";
    ctx.fillText(obj.label, labelX + 6, labelY + fontSize + 1);
    ctx.font      = `${fontSize - 2}px monospace`;
    ctx.fillText(confIcon, labelX + textW + 10, labelY + fontSize + 1);
  }
}

/**
 * 製造業 YOLO Canvas 視覺疊加（風險分級色彩）
 *
 * 風險色彩對應（製造業工安標準）：
 *   critical → 紅色   #ef4444  警報閃爍邊框（人員 / 刀具 / 大型車輛）
 *   warning  → 橙色   #f97316  虛線邊框（小車輛 / 手機 / 剪刀）
 *   safe     → 綠色   #22c55e  細實線邊框（一般設備）
 *   info     → 青灰   #64748b  淡虛線邊框（背景物件）
 *
 * 標籤顯示：類別中文名 + 信心度 % + 風險圖示
 */
function drawYoloOverlay(
  canvas: HTMLCanvasElement,
  video:  HTMLVideoElement,
  dets:   YoloDetection[]
): void {
  const rect = video.getBoundingClientRect();
  canvas.width  = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!dets.length) return;

  const W = canvas.width;
  const H = canvas.height;

  // 風險樣式定義
  type RiskStyle = { stroke: string; fill: string; labelBg: string; dash: number[]; lineW: number; icon: string };
  const RISK_STYLE: Record<string, RiskStyle> = {
    critical: { stroke: "#ef4444", fill: "rgba(239,68,68,0.10)",  labelBg: "rgba(185,28,28,0.90)",  dash: [],      lineW: 2.5, icon: "⚠" },
    warning:  { stroke: "#f97316", fill: "rgba(249,115,22,0.08)", labelBg: "rgba(154,52,18,0.88)",  dash: [6, 3],  lineW: 2.0, icon: "●" },
    safe:     { stroke: "#22c55e", fill: "rgba(34,197,94,0.06)",  labelBg: "rgba(20,83,45,0.85)",   dash: [],      lineW: 1.5, icon: "✓" },
    info:     { stroke: "#475569", fill: "rgba(71,85,105,0.04)",  labelBg: "rgba(30,41,59,0.80)",   dash: [4, 4],  lineW: 1.0, icon: "·" },
  };

  for (const d of dets) {
    const x  = d.x * W;
    const y  = d.y * H;
    const w  = d.w * W;
    const h  = d.h * H;
    const st = RISK_STYLE[d.risk] ?? RISK_STYLE.info;
    const alpha = d.risk === "info" ? 0.55 : (0.65 + d.confidence * 0.35);

    ctx.save();
    ctx.globalAlpha = alpha;

    // ── 背景填充 ──
    ctx.fillStyle = st.fill;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill();

    // ── 邊框 ──
    ctx.strokeStyle = st.stroke;
    ctx.lineWidth   = st.lineW;
    ctx.setLineDash(st.dash);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── L 型角落標記 ──
    const cl = Math.min(12, w * 0.14, h * 0.14);
    ctx.lineWidth = st.lineW + 0.5;
    const corners: [number, number, number, number][] = [
      [x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1],
    ];
    for (const [cx2, cy2, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx2 + dx * cl, cy2);
      ctx.lineTo(cx2, cy2);
      ctx.lineTo(cx2, cy2 + dy * cl);
      ctx.stroke();
    }

    // ── 標籤 ──
    const confPct = Math.round(d.confidence * 100);
    const label   = `${st.icon} ${d.className} ${confPct}%`;
    const fs      = Math.max(10, Math.min(13, W * 0.018));
    ctx.font      = `bold ${fs}px "SF Pro Text", system-ui, sans-serif`;
    const tw      = ctx.measureText(label).width + 12;
    const lh      = fs + 8;
    const lx      = Math.min(x, W - tw - 2);
    const ly      = y > lh + 3 ? y - 2 : y + h + 2;

    ctx.globalAlpha = 1;
    ctx.fillStyle   = st.labelBg;
    ctx.beginPath();
    ctx.roundRect(lx, ly - lh + 3, tw, lh, 4);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, lx + 6, ly);

    ctx.restore();
  }
}

/**
 * 人員分析 Canvas 疊加層
 * 在每位人員 bbox 上顯示：性別推測 + 當前動作
 *
 * 標籤格式：[性別圖示] 男/女/人員 · 站立/坐著/行走…
 * 顏色：
 *   男性   → 藍色  #60a5fa
 *   女性   → 粉色  #f472b6
 *   未知   → 青灰  #94a3b8
 */
function drawPersonInfoOverlay(
  canvas: HTMLCanvasElement,
  video:  HTMLVideoElement,
  infos:  PersonInfo[],
): void {
  if (!infos.length) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const W = canvas.width  || video.getBoundingClientRect().width;
  const H = canvas.height || video.getBoundingClientRect().height;

  // 性別顏色設定
  const GENDER_COLOR: Record<string, { border: string; bg: string; icon: string }> = {
    male:    { border: "#3b82f6", bg: "rgba(59,130,246,0.82)",  icon: "♂" },
    female:  { border: "#ec4899", bg: "rgba(236,72,153,0.82)",  icon: "♀" },
    unknown: { border: "#475569", bg: "rgba(30,41,59,0.80)",    icon: "👤" },
  };

  // 動作顏色（特殊動作用警示色）
  const ACTION_COLOR: Record<string, string> = {
    running:      "#ef4444", // 紅色 — 可能緊急
    raising_hand: "#f59e0b", // 琥珀 — 可能求助
    bending:      "#f97316", // 橙色 — 工安注意
    squatting:    "#a78bfa", // 紫色 — 注意
    default:      "#e2e8f0", // 白灰 — 正常
  };

  for (const info of infos) {
    const d  = info.det;
    const bx = d.x * W;
    const by = d.y * H;
    const bw = d.w * W;
    const bh = d.h * H;

    const gCol   = GENDER_COLOR[info.gender] ?? GENDER_COLOR.unknown;
    const aColor = ACTION_COLOR[info.action] ?? ACTION_COLOR.default;

    // ── 人員 bbox 邊框（性別顏色）─────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = gCol.border;
    ctx.lineWidth   = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 6);
    ctx.stroke();

    // ── L 型角落標記 ──────────────────────────────────────────────────
    const cl = Math.min(14, bw * 0.12, bh * 0.08);
    ctx.lineWidth = 2.5;
    const corners: [number, number, number, number][] = [
      [bx,      by,      1,  1],
      [bx + bw, by,     -1,  1],
      [bx,      by + bh, 1, -1],
      [bx + bw, by + bh,-1, -1],
    ];
    for (const [cx2, cy2, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx2 + dx * cl, cy2);
      ctx.lineTo(cx2, cy2);
      ctx.lineTo(cx2, cy2 + dy * cl);
      ctx.stroke();
    }
    ctx.restore();

    // ── 性別 + 動作標籤 ───────────────────────────────────────────────
    ctx.save();
    const genderLabel = GENDER_ZH[info.gender];
    const actionLabel = ACTION_ZH[info.action];
    const confLabel   = info.genderConf > 0.35 ? ` ${Math.round(info.genderConf * 100)}%` : "";
    const labelText   = `${gCol.icon} ${genderLabel}${confLabel} · ${actionLabel}`;

    const fs  = Math.max(10, Math.min(13, W * 0.018));
    ctx.font  = `bold ${fs}px "SF Pro Text", system-ui, sans-serif`;
    const tw  = ctx.measureText(labelText).width + 14;
    const lh  = fs + 9;
    const lx  = Math.min(bx, W - tw - 2);
    const ly  = by > lh + 4 ? by - 3 : by + bh + 3; // 優先放框上方

    // 背景
    ctx.fillStyle = gCol.bg;
    ctx.beginPath();
    ctx.roundRect(lx, ly - lh + 3, tw, lh, 5);
    ctx.fill();

    // 邊框
    ctx.strokeStyle = gCol.border;
    ctx.lineWidth   = 1;
    ctx.stroke();

    // 性別文字（白色）
    ctx.fillStyle = "#ffffff";
    ctx.fillText(labelText.split(" · ")[0], lx + 6, ly);

    // 動作文字（動作顏色）
    const gPartW = ctx.measureText(labelText.split(" · ")[0] + " · ").width;
    ctx.fillStyle = aColor;
    ctx.fillText(actionLabel, lx + 6 + gPartW, ly);

    ctx.restore();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   環境資訊顯示輔助
════════════════════════════════════════════════════════════════════════════ */

function lightingLabel(v: EnvironmentInfo["lighting"]): string {
  return v === "good" ? "光線充足" : v === "poor" ? "光線不足" : v === "hazard" ? "危險光源" : "分析中…";
}
function lightingColor(v: EnvironmentInfo["lighting"]): string {
  return v === "good" ? "text-emerald-300" : v === "poor" ? "text-amber-300" : v === "hazard" ? "text-red-300" : "text-slate-400";
}
function lightingBg(v: EnvironmentInfo["lighting"]): string {
  return v === "good" ? "border-emerald-500/25 bg-emerald-500/10" :
         v === "poor" ? "border-amber-500/25 bg-amber-500/10" :
         v === "hazard" ? "border-red-500/25 bg-red-500/10" :
         "border-slate-600/25 bg-slate-700/10";
}

function floorLabel(v: EnvironmentInfo["floor"]): string {
  return v === "clear" ? "地面通暢" : v === "wet" ? "地面潮濕" : v === "cluttered" ? "雜亂障礙" : v === "hazard" ? "地面危險" : "分析中…";
}
function floorColor(v: EnvironmentInfo["floor"]): string {
  return v === "clear" ? "text-emerald-300" : v === "wet" ? "text-amber-300" :
         v === "cluttered" ? "text-amber-300" : v === "hazard" ? "text-red-300" : "text-slate-400";
}
function floorBg(v: EnvironmentInfo["floor"]): string {
  return v === "clear" ? "border-emerald-500/25 bg-emerald-500/10" :
         (v === "wet" || v === "cluttered") ? "border-amber-500/25 bg-amber-500/10" :
         v === "hazard" ? "border-red-500/25 bg-red-500/10" :
         "border-slate-600/25 bg-slate-700/10";
}

function riskLabel(v: EnvironmentInfo["risk"]): string {
  return v === "low" ? "低風險" : v === "medium" ? "中風險" : v === "high" ? "高風險" : "評估中…";
}
function riskColor(v: EnvironmentInfo["risk"]): string {
  return v === "low" ? "text-emerald-300" : v === "medium" ? "text-amber-300" : v === "high" ? "text-red-300" : "text-slate-400";
}
function riskBg(v: EnvironmentInfo["risk"]): string {
  return v === "low" ? "border-emerald-500/40 bg-emerald-500/15" :
         v === "medium" ? "border-amber-500/40 bg-amber-500/15" :
         v === "high" ? "border-red-500/40 bg-red-500/15" :
         "border-slate-600/25 bg-slate-700/10";
}
function riskDot(v: EnvironmentInfo["risk"]): string {
  return v === "low" ? "bg-emerald-400" : v === "medium" ? "bg-amber-400" : v === "high" ? "bg-red-400 animate-pulse" : "bg-slate-500";
}

/* ═══════════════════════════════════════════════════════════════════════════
   子元件
════════════════════════════════════════════════════════════════════════════ */

function WsStatusBadge({ status }: { status: WsStatus }) {
  const cfg = {
    connected:    { dot: "bg-emerald-400", text: "text-emerald-300", label: "推論連線中" },
    connecting:   { dot: "bg-amber-400 animate-pulse", text: "text-amber-300", label: "連線中…" },
    disconnected: { dot: "bg-slate-500", text: "text-slate-400", label: "未連線" },
    error:        { dot: "bg-red-500", text: "text-red-400", label: "連線錯誤" },
  }[status];

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-white/8 bg-black/30 px-2.5 py-1 backdrop-blur-sm">
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      <span className={`text-[10px] font-medium ${cfg.text}`}>{cfg.label}</span>
    </div>
  );
}

function PermissionBlocker({ onRequest }: { onRequest: () => void }) {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
        <CameraOff className="h-7 w-7 text-slate-400" />
      </div>
      <div>
        <p className="text-sm font-semibold text-white">需要攝影機權限</p>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          請點擊下方按鈕，並在瀏覽器提示時允許攝影機存取。
        </p>
      </div>
      <button onClick={onRequest} className="primary-button">
        <Camera className="h-4 w-4" />
        允許攝影機存取
      </button>
    </div>
  );
}

function PermissionDenied() {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10">
        <CameraOff className="h-7 w-7 text-red-400" />
      </div>
      <div>
        <p className="text-sm font-semibold text-white">攝影機存取被拒絕</p>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          請在瀏覽器網址列旁的 🔒 圖示中，將攝影機權限改為「允許」後重新整理頁面。
        </p>
      </div>
    </div>
  );
}

function UnsupportedBrowser() {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10">
        <Video className="h-7 w-7 text-amber-400" />
      </div>
      <div>
        <p className="text-sm font-semibold text-white">瀏覽器不支援攝影機存取</p>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          請使用 Chrome 80+、Firefox 75+、Safari 14+ 或 Edge 80+，
          並確保頁面以 HTTPS 或 localhost 存取。
        </p>
      </div>
    </div>
  );
}

function AnalyzingOverlay({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-end justify-end bg-gradient-to-t from-slate-950/90 via-transparent to-transparent p-4">
      <div className="max-w-full rounded-[16px] border border-brand-500/30 bg-slate-950/85 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2 border-b border-white/8 pb-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-400" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-400">AI 分析中</span>
        </div>
        <p className="mt-2 max-h-24 overflow-hidden text-xs leading-5 text-slate-200">
          {text || <span className="animate-pulse text-slate-500">等待推論引擎回應…</span>}
        </p>
      </div>
    </div>
  );
}

/**
 * 人員辨識模式：環境即時辨識面板
 * 在分析過程中即時更新場景、照明、地面、風險等資訊
 */
function EnvironmentContextPanel({
  envInfo,
  isStreaming,
}: {
  envInfo: EnvironmentInfo | null;
  isStreaming: boolean;
}) {
  const hasInfo = envInfo !== null;

  return (
    <div className="overflow-hidden rounded-[20px] border border-emerald-500/20 bg-slate-950/80 backdrop-blur-sm">
      {/* 標題列 */}
      <div className="flex items-center gap-2 border-b border-white/8 px-4 py-2.5">
        <MapPin className="h-3.5 w-3.5 text-emerald-400" />
        <span className="text-xs font-semibold text-white">環境辨識</span>
        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
          People
        </span>
        {isStreaming && (
          <div className="ml-auto flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin text-emerald-400" />
            <span className="text-[10px] text-emerald-400">即時分析中</span>
          </div>
        )}
      </div>

      {/* 內容 */}
      <div className="p-4">
        {!hasInfo && isStreaming ? (
          /* 等待模型輸出 ENV: 行 */
          <div className="flex items-center gap-2 py-1">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            <span className="animate-pulse text-xs text-slate-500">正在分析場景環境…</span>
          </div>
        ) : !hasInfo ? (
          <span className="text-xs text-slate-500">尚未辨識環境資訊</span>
        ) : (
          <div className="space-y-3">
            {/* 場景 + 人數 */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-200">
                <MapPin className="h-3 w-3" />
                {envInfo.scene || "場景分析中…"}
              </span>
              {envInfo.count > 0 && (
                <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300">
                  <Users className="h-3 w-3 text-emerald-400" />
                  偵測到 <span className="font-bold text-white">{envInfo.count}</span> 人
                </span>
              )}
              {/* 風險等級（突出顯示）*/}
              <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${riskBg(envInfo.risk)}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${riskDot(envInfo.risk)}`} />
                <span className={riskColor(envInfo.risk)}>{riskLabel(envInfo.risk)}</span>
              </span>
            </div>

            {/* 照明 + 地面狀況（雙欄）*/}
            <div className="grid grid-cols-2 gap-2">
              <div className={`rounded-[14px] border px-3 py-2.5 ${lightingBg(envInfo.lighting)}`}>
                <div className="flex items-center gap-1.5">
                  <Sun className="h-3 w-3 text-slate-400" />
                  <span className="text-[10px] text-slate-500">照明</span>
                </div>
                <p className={`mt-1 text-xs font-semibold ${lightingColor(envInfo.lighting)}`}>
                  {lightingLabel(envInfo.lighting)}
                </p>
              </div>
              <div className={`rounded-[14px] border px-3 py-2.5 ${floorBg(envInfo.floor)}`}>
                <div className="flex items-center gap-1.5">
                  <Activity className="h-3 w-3 text-slate-400" />
                  <span className="text-[10px] text-slate-500">地面</span>
                </div>
                <p className={`mt-1 text-xs font-semibold ${floorColor(envInfo.floor)}`}>
                  {floorLabel(envInfo.floor)}
                </p>
              </div>
            </div>

            {/* 活動描述 */}
            {envInfo.activity ? (
              <div className="rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <Shield className="h-3 w-3 text-slate-400" />
                  <span className="text-[10px] text-slate-500">正在進行的活動</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-200">{envInfo.activity}</p>
              </div>
            ) : isStreaming ? (
              <div className="rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-2">
                <p className="animate-pulse text-xs text-slate-500">活動分析中…</p>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   主元件
════════════════════════════════════════════════════════════════════════════ */

export default function CameraStream({
  onAnalysisComplete,
  onFrameCapture,
}: CameraStreamProps) {

  /* ── YOLO Hooks（多任務）────────────────────────────────────────── */
  const yolo         = useYolo();           // 偵測模型：COCO-80 物件偵測
  const yoloPose     = useYoloPose();       // 姿態模型：17 關鍵點骨架
  const yoloSegment  = useYoloSegment();    // 分割模型：實例分割（Segment）
  const yoloClassify = useYoloClassify();   // 分類模型：場景分類（Classify）

  /* ── 行為偵測 Hook ────────────────────────────────────────────── */
  const behaviorDetector = useBehaviorDetector();

  /* ── SORT 追蹤器（Events 模式）──────────────────────────────────── */
  const sortTrackerRef = useRef(new SortTracker({ maxAge: 5, iouThreshold: 0.25 }));

  /* ── 多模態偵測結果 refs（供 saveSessionToDb 同步讀取）─────────── */
  const yoloDetectionsRef = useRef<YoloDetection[]>([]);
  const poseDetectionsRef = useRef<PoseDetection[]>([]);

  /* ── 攝影機狀態 ───────────────────────────────────────────────────── */
  const videoRef         = useRef<HTMLVideoElement>(null);
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);   // VLM 分析框（z-20）
  const yoloCanvasRef    = useRef<HTMLCanvasElement>(null);   // YOLO 即時框（z-10）
  const streamRef        = useRef<MediaStream | null>(null);

  const [isCameraOn,        setIsCameraOn]        = useState(false);
  const [permission,        setPermission]        = useState<CameraPermission>("prompt");
  const [cameras,           setCameras]           = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId,    setActiveDeviceId]    = useState("");
  const [facingMode,        setFacingMode]        = useState<FacingMode>("environment");
  const [hasMultipleCams,   setHasMultipleCams]   = useState(false);
  const [videoSize,         setVideoSize]         = useState({ w: 0, h: 0 });

  /* ── 分析狀態 ─────────────────────────────────────────────────────── */
  const [isAnalyzing,       setIsAnalyzing]       = useState(false);
  const isAnalyzingRef      = useRef(false);
  const [streamingText,     setStreamingText]     = useState("");
  const [currentResult,     setCurrentResult]     = useState("");
  const [history,           setHistory]           = useState<AnalysisEntry[]>([]);
  const [lastThumbnail,     setLastThumbnail]     = useState<string | null>(null);

  /* ── 偵測框 overlay ───────────────────────────────────────────────── */
  const [detectedObjects,   setDetectedObjects]   = useState<DetectedObject[]>([]);
  const [showOverlay,       setShowOverlay]       = useState(true);
  const overlayFadeTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── 環境辨識（人員模式專用）─────────────────────────────────────── */
  const [envInfo,           setEnvInfo]           = useState<EnvironmentInfo | null>(null);

  /* ── YOLO 即時偵測狀態 ────────────────────────────────────────────── */
  const [yoloEnabled,       setYoloEnabled]       = useState(false);
  const [yoloDetections,    setYoloDetections]    = useState<YoloDetection[]>([]);
  const [yoloFps,           setYoloFps]           = useState(0);
  const [yoloInferMs,       setYoloInferMs]       = useState(0);
  const yoloRafRef          = useRef<number | null>(null);
  const yoloFpsCountRef     = useRef({ count: 0, ts: 0 });

  /* ── 行為偵測狀態 ─────────────────────────────────────────────────── */
  const [behaviorAlerts,    setBehaviorAlerts]    = useState<BehaviorAlert[]>([]);
  const [personInfos,       setPersonInfos]       = useState<PersonInfo[]>([]);

  /* ── 場景分類結果 ─────────────────────────────────────────────────── */
  const [sceneClasses,      setSceneClasses]      = useState<ClassifyResult[]>([]);

  /* ── 實例分割結果 ─────────────────────────────────────────────────── */
  const [segDetections,     setSegDetections]     = useState<SegmentDetection[]>([]);

  /* ── 自動模式 ─────────────────────────────────────────────────────── */
  const [autoMode,          setAutoMode]          = useState(false);
  const [intervalSec,       setIntervalSec]       = useState(5);
  const autoTimerRef        = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── 辨識模式 ─────────────────────────────────────────────────────── */
  const [activeMode,        setActiveMode]        = useState<string>(DEFAULT_MODE_KEY);
  const activeModeRef       = useRef<string>(DEFAULT_MODE_KEY);

  /* ── 模型登錄（動態載入啟用的 ONNX 模型）────────────────────────── */
  const [activeModels,      setActiveModels]      = useState<Record<string, TrainedModel>>({});
  const [modelsLoading,     setModelsLoading]     = useState(false);

  /* ── 從模型登錄載入啟用的模型 ──────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    modelsApi.getActive()
      .then((res) => { if (!cancelled) setActiveModels(res.data.models ?? {}); })
      .catch(() => { /* 模型登錄不可用時靜默降級 */ })
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  /* ── Prompt ───────────────────────────────────────────────────────── */
  const [prompt,            setPrompt]            = useState(DEFAULT_PROMPT);
  const promptRef           = useRef(DEFAULT_PROMPT);
  useEffect(() => { promptRef.current = prompt; }, [prompt]);

  /* ── 解析 VLM 輸出中的分數 ──────────────────────────────────────── */
  const parseVhsScore = useCallback((text: string): number | undefined => {
    const m = text.match(/VHS:\s*(\d+)/i);
    return m ? Math.min(100, Math.max(0, parseInt(m[1]))) : undefined;
  }, []);

  const parseFiveSScore = useCallback((text: string): number | undefined => {
    const m = text.match(/總分[=:：\[]+\s*(\d+)/);
    return m ? Math.min(25, Math.max(5, parseInt(m[1]))) : undefined;
  }, []);

  /** 分析完成後自動儲存 YOLO+VLM 合併結果至 DB（靜默失敗，不影響主功能）*/
  const saveSessionToDb = useCallback(async (entry: AnalysisEntry) => {
    try {
      const mode    = "auto";             // 永遠是 AUTO 統一全模式
      const dets    = yoloDetectionsRef.current;
      const stats   = calcManufacturingStats(dets);

      const risk       = inferRiskFromText(entry.result);
      const vhsScore   = parseVhsScore(entry.result);
      const fiveSScore = parseFiveSScore(entry.result);

      // AUTO 模式：同時執行 detect + pose，統一儲存
      const yoloModel = "yolo26n-pose";   // AUTO 模式永遠使用 pose 模型（含 detect）
      const yoloTask  = "unified";        // AUTO 模式統一任務

      const poseKps = poseToDbFormat(poseDetectionsRef.current);
      const tracks  = sortTrackerRef.current.getSnapshot();

      const detPayload = dets.map((d) => ({
        class_id:   d.classId,
        label:      d.className,
        label_en:   d.classEn,
        confidence: parseFloat(d.confidence.toFixed(3)),
        x: d.x, y: d.y, w: d.w, h: d.h,
        risk:     d.risk,
        category: d.category,
      }));

      await fetch("/backend-api/api/vision/sessions", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          mode,
          vlm_prompt:    entry.prompt,
          vlm_result:    entry.result,
          risk_level:    risk,
          vhs_score:     vhsScore,
          five_s_score:  fiveSScore,
          yolo_model:    yoloModel,
          yolo_task:     yoloTask,
          detections:    detPayload,
          person_count:  stats.personnelCount,
          vehicle_count: stats.vehicleCount,
          hazard_count:  stats.hazardCount,
          pose_keypoints: poseKps ?? null,
          track_history:  tracks  ?? null,
          thumbnail:      entry.thumbnail.startsWith("data:") ? entry.thumbnail : `data:image/jpeg;base64,${entry.thumbnail}`,
          duration_ms:    entry.durationMs,
        }),
      });
    } catch (err) {
      console.warn("[VisionDB] auto-save failed:", err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parseVhsScore, parseFiveSScore]);

  /** 切換模式時自動更新 prompt，並清除環境資訊（保留結果直到下次分析）*/
  const handleModeChange = useCallback((modeKey: string) => {
    setActiveMode(modeKey);
    activeModeRef.current = modeKey;
    const mode = RECOGNITION_MODES.find((m) => m.key === modeKey);
    if (mode) {
      setPrompt(mode.prompt);
      promptRef.current = mode.prompt;
    }
    // 切換模式：清除環境資訊、重置追蹤器、清空偵測結果
    setEnvInfo(null);
    sortTrackerRef.current.reset();
    yoloDetectionsRef.current = [];
    poseDetectionsRef.current = [];
  }, []);

  /* ── WebSocket ────────────────────────────────────────────────────── */
  const wsRef               = useRef<WebSocket | null>(null);
  const [wsStatus,          setWsStatus]          = useState<WsStatus>("disconnected");
  const wantWsRef           = useRef(false);
  const wsReconnectRef      = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── 分析追蹤 refs ────────────────────────────────────────────────── */
  const analysisStartRef     = useRef(0);
  const analysisThumbnailRef = useRef("");
  const streamingAccRef      = useRef("");

  /* ── UI 展開狀態 ──────────────────────────────────────────────────── */
  const [showSettings,      setShowSettings]      = useState(false);
  const [showHistory,       setShowHistory]       = useState(false);

  /* ─────────────────────────────────────────────────────────────────────
     攝影機函式
  ───────────────────────────────────────────────────────────────────── */

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraOn(false);
    setVideoSize({ w: 0, h: 0 });
  }, []);

  const startCamera = useCallback(
    async (deviceId?: string, facing?: FacingMode) => {
      stopCamera();

      // 桌面瀏覽器（非行動裝置）：不指定 facingMode 以避免優先選到 iPhone Continuity Camera
      // 行動裝置：使用 facingMode 選擇前/後鏡頭
      const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
      let videoConstraints: MediaTrackConstraints;
      if (deviceId) {
        videoConstraints = { deviceId: { exact: deviceId }, ...VIDEO_CONSTRAINTS };
      } else if (isMobile) {
        videoConstraints = { facingMode: facing ?? "environment", ...VIDEO_CONSTRAINTS };
      } else {
        // 桌機/Mac：優先選第一個「內建」或 label 含 FaceTime 的相機
        // 若找不到則不限制，讓瀏覽器選預設
        videoConstraints = { ...VIDEO_CONSTRAINTS };
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
        streamRef.current = stream;
        const vid = videoRef.current!;
        vid.srcObject = stream;
        vid.onloadedmetadata = () => {
          vid.play().catch(() => {});
          setVideoSize({ w: vid.videoWidth, h: vid.videoHeight });
        };
        const trackSettings = stream.getVideoTracks()[0]?.getSettings();
        if (trackSettings?.deviceId) setActiveDeviceId(trackSettings.deviceId);
        setIsCameraOn(true);
        setPermission("granted");
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevs = devices.filter((d) => d.kind === "videoinput");
        setCameras(videoDevs);
        setHasMultipleCams(videoDevs.length > 1);
      } catch (err: any) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setPermission("denied");
          toast.error("攝影機權限被拒絕，請在瀏覽器設定中允許攝影機存取。");
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          toast.error("找不到攝影機裝置，請確認攝影機已連接。");
        } else if (err.name === "OverconstrainedError") {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            streamRef.current = stream;
            videoRef.current!.srcObject = stream;
            await videoRef.current!.play().catch(() => {});
            setIsCameraOn(true);
            setPermission("granted");
          } catch {
            toast.error("無法啟動攝影機，請嘗試重新整理頁面。");
          }
        } else {
          toast.error(`攝影機啟動失敗：${err.message}`);
        }
      }
    },
    [stopCamera]
  );

  const switchCamera = useCallback(async () => {
    const newFacing: FacingMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newFacing);
    if (isCameraOn) await startCamera(undefined, newFacing);
  }, [facingMode, isCameraOn, startCamera]);

  const selectCamera = useCallback(
    async (deviceId: string) => {
      setActiveDeviceId(deviceId);
      if (isCameraOn) await startCamera(deviceId);
    },
    [isCameraOn, startCamera]
  );

  /* ─────────────────────────────────────────────────────────────────────
     影像幀擷取
  ───────────────────────────────────────────────────────────────────── */

  const captureFrame = useCallback((): string | null => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", FRAME_JPEG_QUALITY).split(",")[1];
  }, []);

  /* ─────────────────────────────────────────────────────────────────────
     偵測框 + 環境資訊共用處理邏輯
  ───────────────────────────────────────────────────────────────────── */

  const handleDetectionResult = useCallback((finalText: string) => {
    // 解析偵測框
    const detected = parseDetections(finalText);
    setDetectedObjects(detected);
    if (detected.length > 0) {
      setShowOverlay(true);
      requestAnimationFrame(() => {
        if (overlayCanvasRef.current && videoRef.current) {
          drawDetectionOverlay(overlayCanvasRef.current, videoRef.current, detected);
        }
      });
      if (overlayFadeTimer.current) clearTimeout(overlayFadeTimer.current);
      overlayFadeTimer.current = setTimeout(() => {
        setShowOverlay(false);
        setDetectedObjects([]);
        overlayCanvasRef.current?.getContext("2d")?.clearRect(
          0, 0,
          overlayCanvasRef.current.width,
          overlayCanvasRef.current.height
        );
      }, 15_000);
    }

    // AUTO 統一全模式：解析環境資訊（含人員/場景評估）
    const env = parseEnvironment(finalText);
    setEnvInfo(env);
  }, []);

  /* ─────────────────────────────────────────────────────────────────────
     WebSocket 管理
  ───────────────────────────────────────────────────────────────────── */

  const connectWs = useCallback(() => {
    if (!wantWsRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    if (wsReconnectRef.current) {
      clearTimeout(wsReconnectRef.current);
      wsReconnectRef.current = null;
    }

    setWsStatus("connecting");
    const url = getVlmWsUrl();

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      setWsStatus("error");
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => setWsStatus("connected");

    ws.onclose = () => {
      setWsStatus("disconnected");
      if (isAnalyzingRef.current) {
        setIsAnalyzing(false);
        isAnalyzingRef.current = false;
        setStreamingText("");
      }
      if (wantWsRef.current) {
        wsReconnectRef.current = setTimeout(connectWs, WS_RECONNECT_MS);
      }
    };

    ws.onerror = () => {
      setWsStatus("error");
      ws.close();
    };

    ws.onmessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          type: string;
          content?: string;
          finish_reason?: string;
          message?: string;
        };

        switch (msg.type) {
          case "start":
            // analyzeNow 已預先設定狀態；此處僅確保同步（防備直連無 analyzeNow 的情況）
            streamingAccRef.current = "";
            setStreamingText("");
            setIsAnalyzing(true);
            isAnalyzingRef.current = true;
            break;

          case "token": {
            const token = msg.content ?? "";
            streamingAccRef.current += token;
            setStreamingText(streamingAccRef.current);

            // AUTO 統一全模式：即時解析 ENV: 行（逐 token 更新）
            {
              const partialEnv = parseEnvironment(streamingAccRef.current);
              if (partialEnv) setEnvInfo(partialEnv);
            }
            break;
          }

          case "done": {
            const finalText = streamingAccRef.current;
            setCurrentResult(finalText);
            setIsAnalyzing(false);
            isAnalyzingRef.current = false;

            // 解析偵測框 + 環境資訊
            handleDetectionResult(finalText);

            const entry: AnalysisEntry = {
              id:         `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              timestamp:  new Date(),
              thumbnail:  analysisThumbnailRef.current,
              result:     finalText,
              prompt:     promptRef.current,
              durationMs: Date.now() - analysisStartRef.current,
            };
            setHistory((prev) => [entry, ...prev.slice(0, MAX_HISTORY - 1)]);
            onAnalysisComplete?.(entry);
            saveSessionToDb(entry);           // ← 自動儲存合併結果至 DB
            if (finalText) {
              const b64 = analysisThumbnailRef.current.split(",")[1] ?? "";
              onFrameCapture?.(b64, finalText);
            }
            break;
          }

          case "skip":
            break;

          case "error":
            toast.error(msg.message ?? "推論錯誤");
            setIsAnalyzing(false);
            isAnalyzingRef.current = false;
            setStreamingText("");
            break;

          case "ping":
            ws.send(JSON.stringify({ type: "pong" }));
            break;
        }
      } catch {
        /* 忽略解析錯誤 */
      }
    };
  }, [onAnalysisComplete, onFrameCapture, handleDetectionResult]);

  /* ─────────────────────────────────────────────────────────────────────
     推論觸發
  ───────────────────────────────────────────────────────────────────── */

  const analyzeNow = useCallback(async () => {
    if (!isCameraOn || isAnalyzingRef.current) return;

    const b64 = captureFrame();
    if (!b64) {
      toast.error("無法擷取影像，請確認攝影機已開啟。");
      return;
    }

    const thumbDataUrl = `data:image/jpeg;base64,${b64}`;
    setLastThumbnail(thumbDataUrl);
    analysisThumbnailRef.current = thumbDataUrl;
    analysisStartRef.current = Date.now();

    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      // WS 路徑：立即設定分析中狀態，不等 server 回 start
      setIsAnalyzing(true);
      isAnalyzingRef.current = true;
      setStreamingText("");
      streamingAccRef.current = "";
      setEnvInfo(null);
      ws.send(JSON.stringify({
        image_base64: b64,
        prompt:       promptRef.current,
        max_tokens:   768,
        temperature:  0.05,
      }));
    } else {
      // 備援：HTTP POST
      setIsAnalyzing(true);
      isAnalyzingRef.current = true;
      setStreamingText("");
      setEnvInfo(null);
      try {
        const res = await vlmApi.diagnose({
          prompt:       promptRef.current,
          image_base64: b64,
          max_tokens:   512,
        });
        const result = res.data.content ?? "";
        streamingAccRef.current = result;
        setStreamingText(result);
        setCurrentResult(result);
        handleDetectionResult(result);

        const entry: AnalysisEntry = {
          id:         `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp:  new Date(),
          thumbnail:  thumbDataUrl,
          result,
          prompt:     promptRef.current,
          durationMs: Date.now() - analysisStartRef.current,
        };
        setHistory((prev) => [entry, ...prev.slice(0, MAX_HISTORY - 1)]);
        onAnalysisComplete?.(entry);
        saveSessionToDb(entry);               // ← 自動儲存合併結果至 DB
        onFrameCapture?.(b64, result);
      } catch (err: any) {
        toast.error(err?.response?.data?.detail ?? "推論失敗，請確認推論引擎是否啟動。");
        setStreamingText("");
      } finally {
        setIsAnalyzing(false);
        isAnalyzingRef.current = false;
      }
    }
  }, [isCameraOn, captureFrame, onAnalysisComplete, onFrameCapture, handleDetectionResult]);

  /* ─────────────────────────────────────────────────────────────────────
     Effects
  ───────────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (isCameraOn) {
      wantWsRef.current = true;
      connectWs();
    } else {
      wantWsRef.current = false;
      wsRef.current?.close();
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current);
      setWsStatus("disconnected");
      setAutoMode(false);
    }
  }, [isCameraOn, connectWs]);

  useEffect(() => {
    if (autoTimerRef.current) {
      clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    if (autoMode && isCameraOn) {
      analyzeNow();
      autoTimerRef.current = setInterval(() => analyzeNow(), intervalSec * 1000);
    }
    return () => {
      if (autoTimerRef.current) clearInterval(autoTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMode, isCameraOn, intervalSec]);

  /* ─────────────────────────────────────────────────────────────────────
     Effect：YOLO 即時推論循環
     - 每 ~125ms（8fps 目標）執行一次推論
     - busyRef 防止堆積（前一幀未完成則跳過）
     - FPS 計數每秒更新一次
  ───────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    // 關閉 YOLO 或攝影機未開啟時清空畫布並結束循環
    // AUTO 統一全模式：兩個模型都必須 ready 才啟動 RAF loop
    const needsReady = yolo.status !== "ready" || yoloPose.status !== "ready";
    if (!yoloEnabled || !isCameraOn || needsReady) {
      if (yoloRafRef.current) cancelAnimationFrame(yoloRafRef.current);
      yoloRafRef.current = null;
      setYoloDetections([]);
      setYoloFps(0);
      if (yoloCanvasRef.current) {
        yoloCanvasRef.current.getContext("2d")?.clearRect(
          0, 0, yoloCanvasRef.current.width, yoloCanvasRef.current.height
        );
      }
      return;
    }

    const TARGET_INTERVAL = 125; // 8fps
    let lastRunTime = 0;
    yoloFpsCountRef.current = { count: 0, ts: performance.now() };

    const loop = (timestamp: number) => {
      yoloRafRef.current = requestAnimationFrame(loop);
      if (timestamp - lastRunTime < TARGET_INTERVAL) return;
      lastRunTime = timestamp;

      const video  = videoRef.current;
      const canvas = yoloCanvasRef.current;
      if (!video || !canvas || video.videoWidth === 0) return;

      const t0   = performance.now();

      // AUTO 統一全模式（固定）：detect + pose + segment + classify 並行
      if (yolo.status === "ready" && yoloPose.status === "ready") {
        // 核心任務：detect + pose（必須）
        // 選用任務：segment + classify（模型就緒才執行）
        const tasks: Promise<any>[] = [
          yolo.detect(video),
          yoloPose.detect(video),
          yoloSegment.status === "ready" ? yoloSegment.detect(video) : Promise.resolve([]),
          yoloClassify.status === "ready" ? yoloClassify.detect(video, 3) : Promise.resolve([]),
        ];

        (Promise.all(tasks) as Promise<[YoloDetection[], any[], SegmentDetection[], ClassifyResult[]]>)
        .then(([dets, poses, segs, classes]) => {
          yoloDetectionsRef.current = dets;
          poseDetectionsRef.current = poses;

          // SORT 追蹤（非人員物件 + 人員均追蹤）
          const tracked = sortTrackerRef.current.update(dets);
          setYoloDetections(dets);

          // 行為偵測（detect + pose + track 三路輸入）→ 同時產生 personInfos
          const behaviors = behaviorDetector.detect(dets, poses, tracked);
          setBehaviorAlerts(behaviors);
          setPersonInfos(behaviorDetector.personInfos);

          // 場景分類結果
          if (classes.length > 0) setSceneClasses(classes);

          // 實例分割結果
          if (segs.length > 0) setSegDetections(segs);

          // 清空並重繪：detect 框 → pose 骨架 → trackId → 行為標籤
          const rect = video.getBoundingClientRect();
          canvas.width  = rect.width  || video.videoWidth;
          canvas.height = rect.height || video.videoHeight;
          const ctx2d = canvas.getContext("2d");
          if (ctx2d) {
            ctx2d.clearRect(0, 0, canvas.width, canvas.height);
            // 1. YOLO detect 框（非人員）
            const nonPersonDets = dets.filter((d) => d.category !== "personnel");
            drawYoloOverlay(canvas, video, nonPersonDets);
            // 2. Pose 骨架（人員）
            drawPoseOverlay(canvas as HTMLCanvasElement, video, poses);
            // 3. Track ID 標籤（所有追蹤目標）
            drawTrackIds(ctx2d, tracked as TrackedObject[], canvas.width, canvas.height);
            // 4. 人員分析標籤（性別推測 + 動作偵測）
            drawPersonInfoOverlay(canvas, video, behaviorDetector.personInfos);
          }

          const now = performance.now();
          yoloFpsCountRef.current.count++;
          if (now - yoloFpsCountRef.current.ts >= 1000) {
            setYoloFps(yoloFpsCountRef.current.count);
            setYoloInferMs(Math.round(now - t0));
            yoloFpsCountRef.current = { count: 0, ts: now };
          }
        });

      }
      // 兩個模型尚未就緒時靜默等待（不渲染空幀）
    };

    yoloRafRef.current = requestAnimationFrame(loop);
    return () => {
      if (yoloRafRef.current) cancelAnimationFrame(yoloRafRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yoloEnabled, isCameraOn, yolo.status, yoloPose.status]);

  /* ─────────────────────────────────────────────────────────────────────
     Effect：YOLO 啟用時自動觸發模型載入（模式相關）
  ───────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!yoloEnabled) return;
    // AUTO 統一全模式（固定）：必要模型同步載入，選用模型延遲載入
    // detect   → YOLO26n COCO-80 物件偵測（必要）
    // pose     → YOLO26n-Pose 17 關鍵點骨架（必要）
    // segment  → YOLO11n-Seg 實例分割（選用，背景載入）
    // classify → YOLO11n-Cls 場景分類（選用，背景載入）
    if (yolo.status === "idle" || yolo.status === "error") yolo.loadModel();
    if (yoloPose.status === "idle" || yoloPose.status === "error") yoloPose.loadModel();
    // 分割與分類模型在核心模型就緒後再載入（避免競爭 WASM 記憶體）
    if (yolo.status === "ready" && yoloPose.status === "ready") {
      if (yoloSegment.status === "idle") yoloSegment.loadModel();
      if (yoloClassify.status === "idle") yoloClassify.loadModel();
    }
  }, [
    yoloEnabled,
    yolo.status, yoloPose.status, yoloSegment.status, yoloClassify.status,
    yolo.loadModel, yoloPose.loadModel, yoloSegment.loadModel, yoloClassify.loadModel,
  ]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPermission("unsupported");
    }
    return () => {
      wantWsRef.current = false;
      wsRef.current?.close();
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current);
      if (autoTimerRef.current) clearInterval(autoTimerRef.current);
      if (overlayFadeTimer.current) clearTimeout(overlayFadeTimer.current);
      if (yoloRafRef.current) cancelAnimationFrame(yoloRafRef.current);
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─────────────────────────────────────────────────────────────────────
     Derived state
  ───────────────────────────────────────────────────────────────────── */

  const canAnalyze    = isCameraOn && !isAnalyzing;
  // AUTO 統一全模式：固定使用 auto，不再允許切換至單一模式
  const isPeopleMode  = false;           // 已整合進 AUTO（pose 在 auto 中並行執行）
  const isAutoMode    = true;            // 永遠是 AUTO 模式
  const isYoloLoading = yolo.status === "loading" || yoloPose.status === "loading";
  const isYoloReady   = yolo.status === "ready" && yoloPose.status === "ready";

  /* ═══════════════════════════════════════════════════════════════════════
     Render
  ══════════════════════════════════════════════════════════════════════ */

  return (
    <div className="space-y-3">

      {/* ── 0. AUTO 統一全模式 + 辨識能力標籤 ───────────────────────── */}
      <div className="flex flex-col gap-2">

        {/* AUTO 模式主狀態列 */}
        <div className="flex items-center gap-2.5 rounded-[16px] border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 backdrop-blur-sm">
          <Cpu className="h-4 w-4 flex-shrink-0 text-rose-400" />
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-semibold text-rose-200">統一全模式</span>
            <span className="text-[10px] text-rose-300/60">AUTO · 4-in-1 Unified Analysis</span>
          </div>

          {/* YOLO 推論狀態 */}
          <div className="ml-auto flex items-center gap-2">
            {isYoloLoading && (
              <div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1">
                <Loader2 className="h-2.5 w-2.5 animate-spin text-amber-400" />
                <span className="text-[9px] text-amber-300">載入模型中…</span>
              </div>
            )}
            {isYoloReady && (
              <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                <span className="text-[9px] font-medium text-emerald-300">YOLO 就緒</span>
              </div>
            )}
            <span className="hidden rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[9px] font-bold tracking-wider text-rose-300 sm:inline">
              4-IN-1
            </span>
          </div>
        </div>

        {/* 四種辨識能力提示（非可選，純顯示）*/}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          <span className="flex-shrink-0 text-[10px] text-slate-500">涵蓋能力：</span>
          {RECOGNITION_MODES.filter((m) => m.key !== "auto").map((cap) => {
            const capColorMap: Record<string, string> = {
              brand:   "border-brand-500/25 bg-brand-500/8 text-brand-300/80",
              emerald: "border-emerald-500/25 bg-emerald-500/8 text-emerald-300/80",
              amber:   "border-amber-500/25 bg-amber-500/8 text-amber-300/80",
              violet:  "border-violet-500/25 bg-violet-500/8 text-violet-300/80",
            };
            return (
              <div
                key={cap.key}
                title={cap.labelEn}
                className={`
                  flex flex-shrink-0 cursor-default items-center gap-1.5 rounded-full
                  border px-2.5 py-1 text-[10px] font-medium select-none
                  ${capColorMap[cap.color] ?? "border-white/10 bg-white/[0.03] text-slate-400"}
                `}
              >
                {cap.icon}
                <span>{cap.label}</span>
                <span className="hidden opacity-50 sm:inline">{cap.labelEn}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 1. 攝影機主畫面 ──────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden rounded-[24px] border border-white/8 bg-slate-950/80"
        style={{ minHeight: "clamp(280px, 56vw, 720px)" }}
      >
        {/* 狀態角標 */}
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
          <WsStatusBadge status={wsStatus} />
          {isCameraOn && videoSize.w > 0 && (
            <div className="hidden rounded-full border border-white/8 bg-black/30 px-2.5 py-1 backdrop-blur-sm sm:block">
              <span className="text-[10px] text-slate-400">{videoSize.w}×{videoSize.h}</span>
            </div>
          )}
        </div>

        {/* YOLO 狀態角標（右上，z-30）*/}
        <div className="absolute right-3 top-3 z-30 flex flex-col items-end gap-1.5">
          {/* 自動模式 */}
          {autoMode && isCameraOn && (
            <div className="flex items-center gap-1.5 rounded-full border border-brand-500/30 bg-brand-500/20 px-2.5 py-1 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" />
              <span className="text-[10px] font-semibold text-brand-300">每 {intervalSec}s 自動分析</span>
            </div>
          )}
          {/* YOLO 載入中 */}
          {yoloEnabled && isYoloLoading && (
            <div className="flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-950/80 px-2.5 py-1 backdrop-blur-sm">
              <Loader2 className="h-3 w-3 animate-spin text-cyan-400" />
              <span className="text-[10px] text-cyan-300">YOLO 模型載入中…</span>
            </div>
          )}
          {/* YOLO 執行中 */}
          {yoloEnabled && isYoloReady && isCameraOn && (
            <div className="flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-950/85 px-2.5 py-1 backdrop-blur-sm">
              <ScanSearch className="h-3 w-3 text-cyan-400" />
              <span className="text-[10px] font-semibold text-cyan-300">
                YOLO
                {yoloDetections.length > 0 && (
                  <span className="ml-1 rounded-full bg-cyan-500/30 px-1.5 py-0.5 text-[9px] text-cyan-200">
                    {yoloDetections.length} 項
                  </span>
                )}
                {yoloFps > 0 && (
                  <span className="ml-1 text-[9px] text-cyan-500">{yoloFps}fps</span>
                )}
              </span>
            </div>
          )}
          {/* YOLO 錯誤 */}
          {yoloEnabled && yolo.status === "error" && (
            <div className="flex flex-col gap-1 rounded-xl border border-red-500/40 bg-red-950/90 px-3 py-2 backdrop-blur-sm max-w-[280px]">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-400" />
                <span className="text-[10px] font-semibold text-red-300">YOLO 載入失敗</span>
                <button
                  onClick={() => yolo.loadModel()}
                  className="ml-auto flex items-center gap-1 rounded-full border border-red-500/40 bg-red-900/60 px-2 py-0.5 text-[9px] text-red-300 hover:bg-red-800/60 active:scale-95 transition-all"
                >
                  ↺ 重試
                </button>
              </div>
              {yolo.loadError && (
                <span className="text-[9px] text-red-400/80 leading-tight break-all">
                  {yolo.loadError.slice(0, 120)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* AUTO 統一全模式：環境資訊即時疊加（左下角）*/}
        {isCameraOn && (isAnalyzing || envInfo) && (
          <div className="absolute bottom-[72px] left-3 z-20 w-[min(280px,60vw)]">
            <div className="overflow-hidden rounded-[16px] border border-emerald-500/30 bg-slate-950/90 backdrop-blur-md shadow-xl">
              {/* 小標題 */}
              <div className="flex items-center gap-1.5 border-b border-white/8 px-3 py-2">
                <MapPin className="h-3 w-3 text-emerald-400" />
                <span className="text-[10px] font-semibold text-emerald-300">環境辨識</span>
                {isAnalyzing && <Loader2 className="ml-auto h-3 w-3 animate-spin text-emerald-400" />}
              </div>
              <div className="px-3 py-2.5 space-y-1.5">
                {/* 場景 */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {envInfo?.scene ? (
                    <span className="text-xs font-semibold text-emerald-200">{envInfo.scene}</span>
                  ) : (
                    <span className="animate-pulse text-[11px] text-slate-500">場景分析中…</span>
                  )}
                  {envInfo?.count !== undefined && envInfo.count > 0 && (
                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-slate-300">
                      {envInfo.count} 人
                    </span>
                  )}
                </div>
                {/* 三欄狀態 */}
                {envInfo ? (
                  <div className="flex gap-1.5">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${lightingBg(envInfo.lighting)} ${lightingColor(envInfo.lighting)}`}>
                      {lightingLabel(envInfo.lighting)}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${floorBg(envInfo.floor)} ${floorColor(envInfo.floor)}`}>
                      {floorLabel(envInfo.floor)}
                    </span>
                    <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${riskBg(envInfo.risk)}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${riskDot(envInfo.risk)}`} />
                      <span className={riskColor(envInfo.risk)}>{riskLabel(envInfo.risk)}</span>
                    </span>
                  </div>
                ) : isAnalyzing ? (
                  <div className="flex gap-1.5">
                    {["", "", ""].map((_, i) => (
                      <span key={i} className="h-5 w-14 animate-pulse rounded-full bg-white/5" />
                    ))}
                  </div>
                ) : null}
                {/* 活動 */}
                {envInfo?.activity && (
                  <p className="text-[10px] leading-4 text-slate-400 line-clamp-2">{envInfo.activity}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 影像串流 */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          playsInline
          muted
          className={`h-full w-full object-cover transition-opacity duration-300 ${
            isCameraOn ? "opacity-100" : "opacity-0 absolute inset-0"
          }`}
          style={{ minHeight: "clamp(280px, 56vw, 720px)" }}
        />
        {/* 隱藏 Canvas（幀擷取）*/}
        <canvas ref={canvasRef} className="hidden" />

        {/* YOLO Canvas（z-10，青色即時偵測框）*/}
        <canvas
          ref={yoloCanvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ zIndex: 10 }}
        />

        {/* VLM Overlay Canvas（z-20，語意分析框，覆蓋在 YOLO 之上）*/}
        <canvas
          ref={overlayCanvasRef}
          className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-500`}
          style={{ zIndex: 20, opacity: showOverlay && detectedObjects.length > 0 ? 1 : 0 }}
        />

        {/* 偵測框數量角標（右下） */}
        {showOverlay && detectedObjects.length > 0 && !isAnalyzing && (
          <div className="absolute right-3 bottom-20 z-20 flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-950/80 px-2.5 py-1 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="text-[10px] text-slate-300">
              偵測到 <span className="font-bold text-white">{detectedObjects.length}</span> 個物件
            </span>
            <button
              onClick={() => {
                setShowOverlay(false);
                setDetectedObjects([]);
                overlayCanvasRef.current?.getContext("2d")?.clearRect(
                  0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height
                );
              }}
              className="ml-1 text-slate-500 hover:text-slate-300"
            >✕</button>
          </div>
        )}

        {/* ── 統一警示列：YOLO 物件偵測 + 行為偵測（畫面正下方中央）── */}
        {isCameraOn && (() => {
          const critical = yoloDetections.filter((d) => d.risk === "critical");
          const warning  = yoloDetections.filter((d) => d.risk === "warning");
          const allItems = [...critical, ...warning];

          // 行為警報（critical 優先）
          const behaviorCrit = behaviorAlerts.filter((b) => b.risk === "critical");
          const behaviorWarn = behaviorAlerts.filter((b) => b.risk === "warning");

          const hasAnything = allItems.length > 0 || behaviorAlerts.length > 0;
          if (!hasAnything) return null;

          const hasCrit = critical.length > 0 || behaviorCrit.length > 0;

          // 依類別合併同名物件（取最高 conf）
          const merged: { name: string; count: number; maxConf: number; risk: string; isBehavior?: boolean }[] = [];
          for (const d of allItems) {
            const ex = merged.find((m) => m.name === d.className && !m.isBehavior);
            if (ex) { ex.count++; ex.maxConf = Math.max(ex.maxConf, d.confidence); }
            else     merged.push({ name: d.className, count: 1, maxConf: d.confidence, risk: d.risk });
          }
          // 行為警報加入
          for (const b of [...behaviorCrit, ...behaviorWarn]) {
            merged.push({ name: b.nameZh, count: 1, maxConf: b.confidence, risk: b.risk, isBehavior: true });
          }

          return (
            <div className="absolute bottom-[68px] left-1/2 z-30 -translate-x-1/2 pointer-events-none max-w-[90vw]">
              <div className={`
                flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-2.5
                backdrop-blur-xl shadow-2xl
                ${hasCrit
                  ? "border-red-500/70 bg-red-950/88 shadow-red-500/30"
                  : "border-amber-500/60 bg-amber-950/85 shadow-amber-500/20"
                }
              `}>
                {/* 風險等級大標 */}
                <div className={`flex items-center gap-1.5 flex-shrink-0 ${hasCrit ? "text-red-300" : "text-amber-300"}`}>
                  <span className={`text-lg font-black ${hasCrit ? "animate-pulse" : ""}`}>⚠</span>
                  <span className="text-sm font-extrabold tracking-widest uppercase">
                    {hasCrit ? "高危" : "警告"}
                  </span>
                </div>

                {/* 分隔線 */}
                <div className="h-5 w-px bg-white/20 flex-shrink-0" />

                {/* 偵測物件 + 行為警報清單 */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {merged.slice(0, 6).map((item, i) => (
                    <div
                      key={i}
                      className={`
                        flex items-center gap-1.5 rounded-xl border px-3 py-1
                        ${item.risk === "critical"
                          ? item.isBehavior
                            ? "border-rose-400/70 bg-rose-500/30 text-rose-100"
                            : "border-red-400/50 bg-red-500/25 text-red-100"
                          : item.isBehavior
                            ? "border-orange-400/60 bg-orange-500/25 text-orange-100"
                            : "border-amber-400/40 bg-amber-500/20 text-amber-100"
                        }
                      `}
                    >
                      {/* 行為標籤加上動作圖示 */}
                      {item.isBehavior && <span className="text-[10px]">🔔</span>}
                      <span className="text-sm font-bold">{item.name}</span>
                      {item.count > 1 && (
                        <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold bg-white/10">
                          ×{item.count}
                        </span>
                      )}
                      <span className="text-sm font-semibold opacity-90">
                        {Math.round(item.maxConf * 100)}%
                      </span>
                    </div>
                  ))}
                  {merged.length > 6 && (
                    <span className="text-xs text-white/50">+{merged.length - 6}</span>
                  )}
                </div>

                {/* 骨架提示 + 場景分類 */}
                {(() => {
                  const personCount = yoloDetections.filter((d) => d.category === "personnel").length;
                  const topScene = sceneClasses[0];
                  return (
                    <>
                      {personCount > 0 && (
                        <>
                          <div className="h-5 w-px bg-white/20 flex-shrink-0" />
                          <span className="text-[10px] text-violet-300 font-semibold flex-shrink-0">
                            骨架 ×{personCount}
                          </span>
                        </>
                      )}
                      {topScene && topScene.isFactoryRelevant && (
                        <>
                          <div className="h-5 w-px bg-white/20 flex-shrink-0" />
                          <span className="text-[10px] text-cyan-300 font-semibold flex-shrink-0 max-w-[120px] truncate">
                            {topScene.labelZh ?? topScene.label} {Math.round(topScene.confidence * 100)}%
                          </span>
                        </>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          );
        })()}

        {/* 未開啟攝影機時的佔位畫面 */}
        {!isCameraOn && (
          <div className="absolute inset-0 flex items-center justify-center">
            {permission === "unsupported" && <UnsupportedBrowser />}
            {permission === "denied"      && <PermissionDenied />}
            {(permission === "prompt" || permission === "granted") && (
              <PermissionBlocker onRequest={() => startCamera(undefined, facingMode)} />
            )}
          </div>
        )}

        {/* 分析中疊加層 */}
        {isAnalyzing && isCameraOn && <AnalyzingOverlay text={streamingText} />}

        {/* 底部控制列 */}
        {isCameraOn && (
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 bg-gradient-to-t from-slate-950/95 via-slate-950/60 to-transparent p-3 sm:p-4">
            {/* 左側：鏡頭選擇 */}
            <div className="flex items-center gap-2">
              {cameras.length > 1 && (
                <select
                  value={activeDeviceId}
                  onChange={(e) => selectCamera(e.target.value)}
                  className="hidden max-w-[160px] rounded-xl border border-white/10 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-brand-500/50 sm:block"
                >
                  {cameras.map((cam, i) => (
                    <option key={cam.deviceId} value={cam.deviceId}>
                      {cam.label || `攝影機 ${i + 1}`}
                    </option>
                  ))}
                </select>
              )}
              {hasMultipleCams && (
                <button
                  onClick={switchCamera}
                  disabled={isAnalyzing}
                  title={facingMode === "environment" ? "切換為前鏡頭" : "切換為後鏡頭"}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-slate-900/80 text-slate-300 transition-colors hover:bg-white/10 disabled:opacity-40 sm:hidden"
                >
                  <SwitchCamera className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={stopCamera}
                title="關閉攝影機"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-slate-900/80 text-slate-400 transition-colors hover:bg-red-500/20 hover:text-red-400"
              >
                <CameraOff className="h-4 w-4" />
              </button>
            </div>

            {/* 中間：拍攝按鈕 */}
            <button
              onClick={analyzeNow}
              disabled={!canAnalyze}
              title={isAnalyzing ? "推論中…" : "擷取並分析"}
              className={`
                flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full border-2 transition-all
                ${isAnalyzing
                  ? "border-slate-600 bg-slate-800 text-slate-500"
                  : canAnalyze
                    ? "border-brand-400 bg-brand-500/30 text-brand-300 hover:bg-brand-500/50 active:scale-95"
                    : "border-slate-600 bg-slate-800 text-slate-500 opacity-40"}
              `}
            >
              {isAnalyzing
                ? <Loader2 className="h-6 w-6 animate-spin" />
                : <Zap className="h-6 w-6" />
              }
            </button>

            {/* 右側：自動模式 + 設定 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAutoMode((v) => !v)}
                disabled={!canAnalyze && !autoMode}
                title={autoMode ? "停止自動分析" : "開啟自動分析"}
                className={`
                  flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors
                  ${autoMode
                    ? "border-brand-500/50 bg-brand-500/20 text-brand-300 hover:bg-brand-500/30"
                    : "border-white/10 bg-slate-900/80 text-slate-400 hover:bg-white/10"}
                `}
              >
                {autoMode ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{autoMode ? "停止" : "自動"}</span>
              </button>
              {/* YOLO 切換按鈕 */}
              <button
                onClick={() => setYoloEnabled((v) => !v)}
                title={yoloEnabled ? "停用 YOLO 偵測" : "啟用 YOLO 即時物件偵測"}
                className={`flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition-colors ${
                  yoloEnabled
                    ? "border-cyan-500/50 bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30"
                    : "border-white/10 bg-slate-900/80 text-slate-400 hover:bg-white/10"
                }`}
              >
                {isYoloLoading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <ScanSearch className="h-3.5 w-3.5" />
                }
                <span className="hidden sm:inline">YOLO</span>
              </button>

              <button
                onClick={() => setShowSettings((v) => !v)}
                title="設定"
                className={`flex h-9 w-9 items-center justify-center rounded-xl border text-xs transition-colors ${
                  showSettings
                    ? "border-brand-500/50 bg-brand-500/20 text-brand-300"
                    : "border-white/10 bg-slate-900/80 text-slate-400 hover:bg-white/10"
                }`}
              >
                <Settings2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 2. AI 推論結果（主要顯示區，緊接在畫面下方）────────────────── */}
      {(streamingText || currentResult || isAnalyzing) && (
        <div className="overflow-hidden rounded-[20px] border border-white/12 bg-slate-900/70 shadow-lg">
          {/* 標題列 */}
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className={`flex h-7 w-7 items-center justify-center rounded-xl ${
                isAnalyzing ? "bg-brand-500/20" : "bg-brand-500/15"
              }`}>
                {isAnalyzing
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-400" />
                  : <Zap className="h-3.5 w-3.5 text-brand-400" />
                }
              </div>
              <div>
                <p className="text-sm font-semibold text-white">AI 辨識結果</p>
                <p className="text-[10px] text-slate-500">
                  {isAnalyzing ? "推論串流中…" : "分析完成"}
                </p>
              </div>
              {(() => {
                const m = RECOGNITION_MODES.find((x) => x.key === activeMode);
                return m ? (
                  <span className="flex items-center gap-1 rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-[10px] text-slate-400">
                    {m.icon}
                    <span>{m.label}</span>
                    <span className="opacity-50">{m.labelEn}</span>
                  </span>
                ) : null;
              })()}
            </div>
            {lastThumbnail && (
              <img src={lastThumbnail} alt="最後分析幀" className="h-12 w-20 rounded-xl object-cover opacity-75 ring-1 ring-white/10" />
            )}
          </div>

          {/* 推論文字（串流即時顯示）*/}
          <div className="px-5 py-4">
            {(streamingText || currentResult) ? (
              <p className="whitespace-pre-wrap text-sm leading-8 text-slate-100">
                {streamingText || currentResult}
                {isAnalyzing && (
                  <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-brand-400 align-middle" />
                )}
              </p>
            ) : isAnalyzing ? (
              <div className="flex items-center gap-2 py-2">
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
                <span className="text-sm text-slate-500">等待推論引擎回應…</span>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ── 2b. YOLO 製造業即時偵測面板 ────────────────────────────────── */}
      {yoloEnabled && isYoloReady && isCameraOn && (() => {
        const mStats = calcManufacturingStats(yoloDetections);
        const hasCritical = mStats.criticalItems.length > 0;
        const borderCls   = hasCritical ? "border-red-500/40" : "border-cyan-500/20";

        // 按風險等級分組
        type RiskGroup = { name: string; count: number; maxConf: number; risk: string };
        const byRisk: Record<string, RiskGroup[]> = { critical: [], warning: [], safe: [], info: [] };
        for (const d of yoloDetections) {
          const rg = byRisk[d.risk];
          const existing = rg.find(g => g.name === d.className);
          if (existing) {
            existing.count++;
            existing.maxConf = Math.max(existing.maxConf, d.confidence);
          } else {
            rg.push({ name: d.className, count: 1, maxConf: d.confidence, risk: d.risk });
          }
        }

        const RISK_CFG = {
          critical: { label: "⚠ 高危", cls: "border-red-500/40 bg-red-500/10 text-red-300",  badgeCls: "bg-red-500/20 text-red-200" },
          warning:  { label: "● 警告", cls: "border-orange-500/35 bg-orange-500/8 text-orange-300", badgeCls: "bg-orange-500/15 text-orange-200" },
          safe:     { label: "✓ 安全", cls: "border-green-500/30 bg-green-500/8 text-green-300", badgeCls: "bg-green-500/10 text-green-200" },
          info:     { label: "· 資訊", cls: "border-slate-600/25 bg-slate-700/8 text-slate-400", badgeCls: "bg-white/5 text-slate-400" },
        } as const;

        return (
          <div className={`overflow-hidden rounded-[20px] border bg-slate-950/70 ${borderCls}`}>
            {/* 標題列 */}
            <div className={`flex items-center gap-2.5 border-b border-white/8 px-4 py-2.5 ${hasCritical ? "bg-red-950/20" : ""}`}>
              <div className={`flex h-7 w-7 items-center justify-center rounded-xl ${hasCritical ? "bg-red-500/20" : "bg-cyan-500/15"}`}>
                <ScanSearch className={`h-3.5 w-3.5 ${hasCritical ? "text-red-400" : "text-cyan-400"}`} />
              </div>
              <div>
                <p className="text-xs font-semibold text-white">YOLO 製造業即時偵測</p>
                <p className="text-[10px] text-slate-500">
                  YOLO11n · {yolo.modelPath}
                  {yoloFps > 0 && <span className="ml-1.5 text-cyan-600">{yoloFps} fps · {yoloInferMs}ms</span>}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
                {/* 製造業統計摘要 */}
                {mStats.personnelCount > 0 && (
                  <span className="flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                    <Users className="h-3 w-3" />
                    {mStats.personnelCount} 人
                  </span>
                )}
                {mStats.vehicleCount > 0 && (
                  <span className="rounded-full border border-orange-500/30 bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold text-orange-300">
                    🚗 {mStats.vehicleCount} 輛
                  </span>
                )}
                {mStats.hazardCount > 0 && (
                  <span className="rounded-full border border-red-500/40 bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-200 animate-pulse">
                    ⚠ {mStats.hazardCount} 危險
                  </span>
                )}
                {yoloDetections.length === 0 && (
                  <span className="text-[10px] text-slate-600">掃描中…</span>
                )}
              </div>
            </div>

            {/* 偵測結果：按風險等級分組顯示 */}
            <div className="p-3 space-y-2">
              {yoloDetections.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-3">
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-500" />
                  <span className="text-xs text-slate-600">即時掃描中…</span>
                </div>
              ) : (
                (["critical", "warning", "safe", "info"] as const).map((risk) => {
                  const items = byRisk[risk];
                  if (items.length === 0) return null;
                  const cfg = RISK_CFG[risk];
                  return (
                    <div key={risk} className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-wide ${cfg.cls}`}>
                        {cfg.label}
                      </span>
                      {items.map(({ name, count, maxConf }) => (
                        <div
                          key={name}
                          className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${cfg.cls}`}
                        >
                          <span>{name}</span>
                          {count > 1 && (
                            <span className={`rounded-full px-1 text-[9px] ${cfg.badgeCls}`}>×{count}</span>
                          )}
                          <span className="text-[9px] opacity-60">{Math.round(maxConf * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })()}

      {/* ── 3. AUTO 統一全模式：環境詳細資訊面板（含人員/場景評估）──── */}
      {(isAnalyzing || envInfo) && (
        <EnvironmentContextPanel envInfo={envInfo} isStreaming={isAnalyzing} />
      )}

      {/* ── 4. 設定面板 ──────────────────────────────────────────────── */}
      {showSettings && isCameraOn && (
        <div className="rounded-[20px] border border-white/10 bg-slate-950/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold text-white">分析設定</p>
            <button onClick={() => setShowSettings(false)} className="ghost-button h-7 w-7 rounded-lg px-0 text-slate-500">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-[11px] text-slate-400">分析提示詞</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-[14px] border border-white/10 bg-slate-950/50 px-3 py-2.5 text-xs text-white placeholder-slate-600 outline-none transition-colors focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20"
              />
              <button onClick={() => setPrompt(DEFAULT_PROMPT)} className="mt-1 text-[10px] text-slate-500 hover:text-slate-300">
                恢復預設
              </button>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] text-slate-400">
                自動分析間隔：<span className="text-brand-300">{intervalSec} 秒</span>
              </label>
              <input
                type="range" min={2} max={30} step={1}
                value={intervalSec}
                onChange={(e) => setIntervalSec(Number(e.target.value))}
                className="w-full accent-brand-500"
              />
              <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                <span>2s（快）</span><span>30s（慢）</span>
              </div>
            </div>
            {cameras.length > 1 && (
              <div>
                <label className="mb-1.5 block text-[11px] text-slate-400">攝影機裝置</label>
                <select
                  value={activeDeviceId}
                  onChange={(e) => selectCamera(e.target.value)}
                  className="w-full rounded-[14px] border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-200 outline-none"
                >
                  {cameras.map((cam, i) => (
                    <option key={cam.deviceId} value={cam.deviceId}>{cam.label || `攝影機 ${i + 1}`}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 5. 未開啟攝影機時的引導說明 ─────────────────────────────── */}
      {!isCameraOn && permission === "prompt" && (
        <div className="rounded-[20px] border border-brand-500/15 bg-brand-500/5 p-4">
          <div className="flex items-start gap-3">
            <Zap className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-400" />
            <div className="text-xs leading-5 text-slate-300">
              <p className="font-semibold text-white">跨裝置即時影像辨識</p>
              <p className="mt-1">
                點擊「允許攝影機存取」啟動相機，系統將透過 AI 即時分析視野中的設備狀況。
                支援筆電、手機、平板的前後鏡頭，無需安裝任何額外軟體。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── 6. 分析歷史記錄面板 ──────────────────────────────────────── */}
      {history.length > 0 && (
        <div className="rounded-[20px] border border-white/10 bg-slate-950/60">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 hover:bg-white/[0.02]"
          >
            <div className="flex items-center gap-2">
              <History className="h-3.5 w-3.5 text-slate-400" />
              <p className="text-xs font-semibold text-white">分析歷史</p>
              <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-[10px] text-slate-400">{history.length}</span>
            </div>
            {showHistory ? <ChevronUp className="h-4 w-4 text-slate-500" /> : <ChevronDown className="h-4 w-4 text-slate-500" />}
          </button>
          {showHistory && (
            <div className="border-t border-white/8 px-4 pb-4 pt-3 space-y-3">
              {history.length === 0 && (
                <p className="py-4 text-center text-xs text-slate-500">尚無分析記錄</p>
              )}
              {history.map((entry) => {
                const summary = extractSummaryText(entry.result);
                const detectCount = (entry.result.match(/^DETECT:/gm) ?? []).length;
                return (
                  <div key={entry.id} className="rounded-[16px] border border-white/10 bg-white/[0.03] overflow-hidden">
                    {/* 縮圖 + meta */}
                    <div className="flex gap-3 p-3">
                      <img
                        src={entry.thumbnail}
                        alt="分析截圖"
                        className="h-20 w-28 flex-shrink-0 rounded-xl object-cover ring-1 ring-white/10"
                      />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-medium text-slate-300">
                            {formatTimestamp(entry.timestamp)}
                          </span>
                          <span className="flex items-center gap-1 text-[10px] text-slate-500">
                            <Clock className="h-3 w-3" />
                            {formatDuration(entry.durationMs)}
                          </span>
                          {detectCount > 0 && (
                            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                              {detectCount} 項偵測
                            </span>
                          )}
                        </div>
                        {summary ? (
                          <p className="line-clamp-4 text-xs leading-5 text-slate-200">{summary}</p>
                        ) : entry.result ? (
                          <p className="line-clamp-4 text-xs leading-5 text-slate-400">{entry.result}</p>
                        ) : (
                          <p className="text-xs text-slate-600 italic">（推論結果為空）</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {history.length >= MAX_HISTORY && (
                <p className="text-center text-[10px] text-slate-500">最多顯示 {MAX_HISTORY} 筆記錄</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
