import {
  ActivitySquare,
  BookOpenText,
  Camera,
  Cpu,
  FileSearch,
  Radio,
  Settings2,
  SlidersHorizontal,
  Bell,
} from "lucide-react";

export const NAV_ITEMS = [
  {
    href: "/main/dashboard",
    icon: ActivitySquare,
    label: "戰情總覽",
    sublabel: "設備健康與風險節奏",
    badge: "LIVE",
  },
  {
    href: "/main/vlm",
    icon: Camera,
    label: "視覺巡檢",
    sublabel: "影像推論與現場導檢",
    badge: "EDGE",
  },
  {
    href: "/main/mqtt",
    icon: Radio,
    label: "MQTT 監控",
    sublabel: "感測器即時資料與設備管理",
    badge: "IoT",
  },
  {
    href: "/main/mqtt-devices",
    icon: SlidersHorizontal,
    label: "感測器管理",
    sublabel: "設備登錄、閾值設定、歷史圖表",
    badge: "MGT",
  },
  {
    href: "/main/knowledge",
    icon: BookOpenText,
    label: "知識作業台",
    sublabel: "問答、文件管理、OCR、向量索引",
    badge: "RAG",
  },
  {
    href: "/main/reports",
    icon: FileSearch,
    label: "維護報告",
    sublabel: "診斷輸出與交付管理",
    badge: "MD",
  },
  {
    href: "/main/events",
    icon: Bell,
    label: "事件中心",
    sublabel: "全站 Syslog、操作紀錄、錯誤追蹤",
    badge: "LOG",
  },
  {
    href: "/main/models",
    icon: Cpu,
    label: "模型管理",
    sublabel: "YOLO 模型登錄、啟用、效能指標",
    badge: "AI",
  },
  {
    href: "/main/settings",
    icon: Settings2,
    label: "系統設定",
    sublabel: "模型、OCR 引擎、RAG 參數",
    badge: "CFG",
  },
];

export const PAGE_META: Record<
  string,
  { title: string; description: string; eyebrow: string }
> = {
  "/main/dashboard": {
    title: "設備維護戰情總覽",
    description: "集中掌握設備健康、異常節奏與 AIR-030 邊緣推論狀態。",
    eyebrow: "Mission Control",
  },
  "/main/vlm": {
    title: "視覺巡檢指揮台",
    description: "整合 WebRTC、RealSense 與本地推論引擎的即時現場診斷流程。",
    eyebrow: "Visual Inspection",
  },
  "/main/knowledge": {
    title: "知識作業台",
    description: "上傳維修手冊、SOP 與現場圖片，透過 OCR 與向量嵌入建立知識庫，再以 AI 問答方式直接提取診斷依據。",
    eyebrow: "Knowledge Ops",
  },
  "/main/reports": {
    title: "維護報告工作區",
    description: "整理巡檢結果、風險等級與後續維護建議，快速完成交付。",
    eyebrow: "Report Workspace",
  },
  "/main/settings": {
    title: "系統設定",
    description: "設定 OCR 引擎、向量嵌入模型與 RAG 推論參數。",
    eyebrow: "System Config",
  },
  "/main/mqtt": {
    title: "MQTT 感測器監控",
    description: "即時接收並監控 MQTT 感應器回傳的設備數據，支援溫度、振動、壓力等多類型感測器。",
    eyebrow: "IoT Sensor Hub",
  },
  "/main/mqtt-devices": {
    title: "MQTT 感測器管理",
    description: "管理所有已登錄的 MQTT 感測器設備，設定警報閾值並查看歷史讀值趨勢。",
    eyebrow: "Device Management",
  },
  "/main/events": {
    title: "事件中心",
    description: "收集全站所有操作日誌與系統事件，提供即時追蹤、等級過濾與備查功能。",
    eyebrow: "System Events",
  },
  "/main/models": {
    title: "視覺模型管理",
    description: "登錄、啟用並管理 YOLO ONNX 推論模型，支援 detect / pose / segment / classify / obb 五種任務類型。",
    eyebrow: "Model Registry",
  },
};
