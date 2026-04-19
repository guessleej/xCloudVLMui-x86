"use client";

/**
 * app/main/vlm/page.tsx — 現場影像巡檢頁面
 *
 * 功能：
 *   1. 即時相機影像 + VLM 推論（CameraStream）
 *   2. 儲存為報告 — 將 VLM 分析結果 + YOLO 資訊轉為 Markdown 報告
 *   3. 知識庫比對 — 以 VLM 分析結果自動查詢維修知識庫，返回相關 SOP
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Database,
  Download,
  ExternalLink,
  Info,
  Loader2,
  Maximize2,
  Minimize2,
  Radar,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import { reportsApi, vlmApi, ragApi } from "@/lib/api";
import type { RagSource } from "@/types";
import CameraStream, { type AnalysisEntry } from "@/components/vlm/camera-stream";

/* ═══════════════════════════════════════════════════════════════════════════
   常數
════════════════════════════════════════════════════════════════════════════ */

const INSPECTION_SCENARIOS = [
  { title: "外觀與管線異常掃描", detail: "漏油、漏水、鬆脫、外殼變形與異常磨耗。" },
  { title: "控制面板與燈號診斷", detail: "辨識 HMI 錯誤代碼與實體警示燈狀態。" },
  { title: "內部電氣元件檢查",   detail: "觀察 NFB、保險絲、接線鬆脫與燒毀痕跡。" },
  { title: "RUL / 預防維護評估", detail: "根據視覺老化跡象判讀健康分數與建議保養時機。" },
];

const CHECKLIST = [
  "確認瀏覽器攝影機權限已允許（網址列旁的 🔒 → 允許攝影機）。",
  "選擇本次巡檢場景與目標設備，避免在同一輪混入多台設備。",
  "若需維修建議，先完成現象拍攝，再點「知識庫比對」查 SOP。",
];

/* ═══════════════════════════════════════════════════════════════════════════
   工具函式
════════════════════════════════════════════════════════════════════════════ */

/** 從 VLM 文字推算風險等級 */
function inferRiskFromText(text: string): "critical" | "elevated" | "moderate" | "low" {
  const t = text.toLowerCase();
  if (/critical|立即|緊急|危險|嚴重故障|immediate|火災|爆炸/.test(t)) return "critical";
  if (/warning|警告|異常|elevated|注意|可能|故障|損壞/.test(t))          return "elevated";
  if (/normal|正常|良好|good|healthy|無異常/.test(t))                     return "low";
  return "moderate";
}

const RISK_CONFIG = {
  critical: { emoji: "🔴", label: "CRITICAL", color: "text-red-400",    bg: "bg-red-500/10  border-red-500/30"  },
  elevated: { emoji: "🟠", label: "ELEVATED", color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30" },
  moderate: { emoji: "🔵", label: "MODERATE", color: "text-sky-400",    bg: "bg-sky-500/10  border-sky-500/30"  },
  low:      { emoji: "🟢", label: "LOW",      color: "text-emerald-400",bg: "bg-emerald-500/10 border-emerald-500/30" },
};

/** 從 AnalysisEntry 建立 Markdown 報告 */
function buildReportMarkdown(entry: AnalysisEntry, risk: string): string {
  const now = entry.timestamp.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const cfg = RISK_CONFIG[risk as keyof typeof RISK_CONFIG] ?? RISK_CONFIG.moderate;

  return [
    `# 現場巡檢報告`,
    ``,
    `**巡檢時間**：${now}`,
    `**推論耗時**：${entry.durationMs} ms`,
    `**風險等級**：${cfg.emoji} ${cfg.label}`,
    `**推論提示**：${entry.prompt || "（預設場景）"}`,
    ``,
    `---`,
    ``,
    `## 影像推論分析`,
    ``,
    entry.result || "（無分析結果）",
    ``,
    `---`,
    ``,
    `*由 xCloudVLMui Platform 自動產生*`,
  ].join("\n");
}

/* ═══════════════════════════════════════════════════════════════════════════
   子元件
════════════════════════════════════════════════════════════════════════════ */

function Collapsible({
  title, kicker, icon, defaultOpen = false, children,
}: {
  title: string; kicker?: string; icon?: React.ReactNode;
  defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel-soft rounded-[28px] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-3">
          {icon && (
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
              {icon}
            </div>
          )}
          <div>
            {kicker && <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">{kicker}</p>}
            <p className="mt-0.5 text-sm font-semibold text-white">{title}</p>
          </div>
        </div>
        {open
          ? <ChevronUp className="h-4 w-4 flex-shrink-0 text-slate-500" />
          : <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-500" />
        }
      </button>
      {open && <div className="border-t border-white/8 px-5 pb-5 pt-4">{children}</div>}
    </div>
  );
}

function StatusDot({ ok, loading, label }: { ok: boolean; loading: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1">
      <span className={`h-1.5 w-1.5 rounded-full ${loading ? "animate-pulse bg-slate-500" : ok ? "bg-emerald-400" : "bg-red-500"}`} />
      <span className="text-[11px] text-slate-400">{label}</span>
    </div>
  );
}

function StatusTile({
  label, statusLabel, value, detail, tone,
}: { label: string; statusLabel: string; value: string; detail: string; tone: string }) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
        <span className={`status-pill ${tone}`}>{statusLabel}</span>
      </div>
      <p className="mt-3 break-all text-sm font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   主頁面
════════════════════════════════════════════════════════════════════════════ */

type VlmStatus = {
  webui_ok:  boolean;
  llm_ok:    boolean;
  webui_url: string;
  llm_url:   string;
  model?:    string | null;
};

export default function VlmPage() {
  /* ── 狀態 ──────────────────────────────────────────────────────────── */
  const [saving,          setSaving]          = useState(false);
  const [savedReportId,   setSavedReportId]   = useState<string | null>(null);
  const [sessionId,       setSessionId]       = useState<string | null>(null);
  const [status,          setStatus]          = useState<VlmStatus | null>(null);
  const [statusLoading,   setStatusLoading]   = useState(false);
  const [cameraActive,    setCameraActive]    = useState(false);
  const [isMaximized,     setIsMaximized]     = useState(false);

  // 知識庫比對
  const [showCompare,     setShowCompare]     = useState(false);
  const [compareQuery,    setCompareQuery]    = useState("");
  const [comparing,       setComparing]       = useState(false);
  const [compareResult,   setCompareResult]   = useState<{
    answer: string; sources: RagSource[]; latency_ms?: number;
  } | null>(null);

  // 最新完整分析記錄（AnalysisEntry 含縮圖 + 結果文字）
  const lastEntryRef = useRef<AnalysisEntry | null>(null);

  // 儲存前預覽風險
  const [previewRisk, setPreviewRisk] = useState<string | null>(null);

  /* ── 載入 LLM 狀態 ──────────────────────────────────────────────── */
  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const response = await vlmApi.status();
      setStatus(response.data);
    } catch {
      setStatus({ webui_ok: false, llm_ok: false, webui_url: "", llm_url: "http://localhost:8080", model: null });
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  /* ── CameraStream 回調 ─────────────────────────────────────────── */
  const handleFrameCapture = useCallback((imageBase64: string, result: string) => {
    // 僅作為舊版相容（實際用 handleAnalysisComplete）
    void imageBase64; void result;
  }, []);

  const handleAnalysisComplete = useCallback((entry: AnalysisEntry) => {
    lastEntryRef.current = entry;
    setCameraActive(true);
    // 即時推算風險
    const risk = inferRiskFromText(entry.result);
    setPreviewRisk(risk);
  }, []);

  /* ── 儲存為報告 ─────────────────────────────────────────────────── */
  const handleSaveReport = async () => {
    const entry = lastEntryRef.current;
    if (!entry?.result) {
      toast.error("請先進行影像分析，再儲存報告。");
      return;
    }

    setSaving(true);
    try {
      const risk        = inferRiskFromText(entry.result);
      const capturedAt  = entry.timestamp.toISOString();
      const mdContent   = buildReportMarkdown(entry, risk);
      const title       = `現場巡檢報告 — ${capturedAt.slice(0, 16).replace("T", " ")}`;

      const response = await reportsApi.captureVlmSession({
        session_id:       sessionId ?? `vlm-${Date.now()}`,
        source:           "camera-stream",
        captured_at:      capturedAt,
        title,
        risk_level:       risk,
        markdown_content: mdContent,
      });

      const id = response.data.id ?? response.data.title;
      setSessionId(id);
      setSavedReportId(id);
      toast.success("✅ 巡檢報告已儲存！");
    } catch (error: any) {
      toast.error(error?.response?.data?.detail ?? "儲存失敗，請確認後端服務是否運作。");
    } finally {
      setSaving(false);
    }
  };

  /* ── 知識庫比對 ─────────────────────────────────────────────────── */
  const handleCompare = async (queryOverride?: string) => {
    const q = (queryOverride ?? compareQuery).trim();
    if (!q) return;
    if (queryOverride) setCompareQuery(queryOverride);
    setComparing(true);
    setCompareResult(null);
    try {
      const res = await ragApi.query({ question: q, top_k: 5 });
      setCompareResult({
        answer:     res.data.answer,
        sources:    res.data.sources,
        latency_ms: res.data.latency_ms,
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "知識庫比對失敗");
    } finally {
      setComparing(false);
    }
  };

  /** 將最新 VLM 分析填入比對查詢框 */
  const autoFillFromAnalysis = () => {
    const entry = lastEntryRef.current;
    if (!entry?.result) {
      toast.error("尚無分析結果，請先進行影像推論。");
      return;
    }
    // 取前 300 字作為查詢（避免 token 超限）
    const excerpt = entry.result.replace(/#+\s*/g, "").replace(/\*\*/g, "").trim().slice(0, 300);
    setCompareQuery(excerpt);
    setCompareResult(null);
  };

  /* ══════════════════════════════════════════════════════════════════
     Render
  ══════════════════════════════════════════════════════════════════ */
  const riskCfg = previewRisk ? RISK_CONFIG[previewRisk as keyof typeof RISK_CONFIG] : null;

  return (
    <div className="space-y-4">

      {/* ══════════════════════════════════════════════════════════════
          1. 現場影像主畫面
          ══════════════════════════════════════════════════════════ */}
      <section
        className={
          isMaximized
            ? "fixed inset-0 z-50 overflow-y-auto bg-[#050a12] p-3 sm:p-4"
            : "panel-soft rounded-[32px] p-4 sm:p-5"
        }
      >

        {/* 標題列 + 操作按鈕 */}
        <div className="flex flex-col gap-3 border-b border-white/8 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-brand-400/30 bg-brand-500/15">
              <Camera className="h-4.5 w-4.5 text-brand-300" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Live Inspection Surface</p>
              <h1 className="mt-0.5 text-xl font-semibold text-white">現場影像與推論畫面</h1>
            </div>
            <div className="ml-2 hidden items-center gap-2 sm:flex">
              <StatusDot ok={cameraActive}        loading={false}          label="攝影機"   />
              <StatusDot ok={status?.llm_ok ?? false} loading={statusLoading} label="推論引擎" />
              {savedReportId && (
                <span className="status-pill status-pill-ok">報告已儲存</span>
              )}
              {/* 即時風險徽章 */}
              {riskCfg && !savedReportId && (
                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${riskCfg.bg} ${riskCfg.color}`}>
                  {riskCfg.emoji} {riskCfg.label}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={loadStatus} className="secondary-button" disabled={statusLoading}>
              <RefreshCw className={`h-4 w-4 ${statusLoading ? "animate-spin" : ""}`} />
              狀態
            </button>

            {/* ── 儲存為報告 ── */}
            <button
              onClick={handleSaveReport}
              disabled={saving || !previewRisk}
              className={`primary-button ${!previewRisk ? "opacity-50 cursor-not-allowed" : ""}`}
              title={!previewRisk ? "請先進行影像分析" : ""}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "儲存中…" : "儲存為報告"}
            </button>

            {/* ── 知識庫比對 ── */}
            <button
              onClick={() => {
                setShowCompare((v) => !v);
                setCompareResult(null);
              }}
              className={`secondary-button ${showCompare ? "border-brand-500/50 bg-brand-500/15 text-brand-200" : ""}`}
            >
              <Database className="h-4 w-4" />
              知識庫比對
            </button>

            {/* ── 最大化/還原 ── */}
            <button
              onClick={() => setIsMaximized((v) => !v)}
              className="secondary-button"
              title={isMaximized ? "還原視窗" : "最大化畫面"}
            >
              {isMaximized
                ? <Minimize2 className="h-4 w-4" />
                : <Maximize2 className="h-4 w-4" />
              }
              {isMaximized ? "還原" : "最大化"}
            </button>
          </div>
        </div>

        {/* ── 攝影機串流主畫面 ── */}
        <div className="mt-4">
          <CameraStream
            onFrameCapture={handleFrameCapture}
            onAnalysisComplete={handleAnalysisComplete}
          />
        </div>

        {/* ════════════════════════════════════════════════════════
            儲存為報告 — 預覽面板（分析完成後顯示）
            ════════════════════════════════════════════════════ */}
        {previewRisk && !showCompare && (
          <div className={`mt-4 rounded-[24px] border p-4 ${riskCfg?.bg ?? ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <ClipboardList className={`h-4 w-4 flex-shrink-0 ${riskCfg?.color}`} />
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">最新分析摘要</p>
                  <p className={`mt-0.5 text-sm font-semibold ${riskCfg?.color}`}>
                    {riskCfg?.emoji} 風險等級：{riskCfg?.label}
                  </p>
                </div>
              </div>
              {/* 縮圖 */}
              {lastEntryRef.current?.thumbnail && (
                <img
                  src={lastEntryRef.current.thumbnail}
                  alt="分析截圖"
                  className="h-16 w-24 flex-shrink-0 rounded-xl object-cover border border-white/10 opacity-80"
                />
              )}
            </div>

            {/* 分析文字摘要 */}
            {lastEntryRef.current?.result && (
              <p className="mt-3 text-xs leading-5 text-slate-400 line-clamp-3">
                {lastEntryRef.current.result.slice(0, 200)}…
              </p>
            )}

            {/* 操作按鈕 */}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={handleSaveReport}
                disabled={saving}
                className="primary-button text-xs py-1.5"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {saving ? "儲存中…" : "確認儲存報告"}
              </button>
              <button
                onClick={() => { setShowCompare(true); setCompareResult(null); }}
                className="secondary-button text-xs py-1.5"
              >
                <Database className="h-3.5 w-3.5" />
                查詢知識庫
              </button>
              {savedReportId && (
                <a
                  href={`/main/reports/${savedReportId}`}
                  className="secondary-button text-xs py-1.5"
                  target="_blank" rel="noopener noreferrer"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  查看報告
                </a>
              )}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════
            知識庫比對面板
            ════════════════════════════════════════════════════ */}
        {showCompare && (
          <div className="mt-4 rounded-[28px] border border-brand-500/20 bg-slate-950/70 p-5">

            {/* 面板標題 */}
            <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/10">
                  <Database className="h-4 w-4 text-brand-300" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Knowledge Compare</p>
                  <h3 className="mt-0.5 text-sm font-semibold text-white">知識庫比對</h3>
                </div>
              </div>
              <button
                onClick={() => { setShowCompare(false); setCompareResult(null); }}
                className="ghost-button h-8 w-8 rounded-xl px-0 text-slate-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 縮圖 + 查詢欄 */}
            <div className="mt-4 flex gap-3">
              {/* 截圖縮圖 */}
              {lastEntryRef.current?.thumbnail && (
                <div className="flex-shrink-0">
                  <img
                    src={lastEntryRef.current.thumbnail}
                    alt="分析截圖"
                    className="h-20 w-28 rounded-xl border border-white/10 object-cover"
                  />
                  <p className="mt-1 text-center text-[9px] text-slate-600">
                    {lastEntryRef.current.timestamp.toLocaleTimeString("zh-TW")}
                  </p>
                </div>
              )}

              {/* 查詢欄 + 按鈕 */}
              <div className="flex flex-1 flex-col gap-2">
                <div className="flex gap-2">
                  <textarea
                    value={compareQuery}
                    onChange={(e) => setCompareQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleCompare();
                    }}
                    placeholder="描述異常現象或貼入分析結果，查詢知識庫中的相關維修資訊…（Ctrl+Enter 送出）"
                    rows={3}
                    className="flex-1 resize-none rounded-[16px] border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20"
                  />
                  <button
                    onClick={() => handleCompare()}
                    disabled={comparing || !compareQuery.trim()}
                    className="primary-button self-start whitespace-nowrap"
                  >
                    {comparing
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Search className="h-4 w-4" />
                    }
                    {comparing ? "比對中…" : "比對"}
                  </button>
                </div>

                {/* 快捷工具列 */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={autoFillFromAnalysis}
                    disabled={!lastEntryRef.current?.result}
                    className="ghost-button h-7 gap-1.5 rounded-full border border-white/10 px-3 text-[11px] text-slate-400 hover:text-white disabled:opacity-40"
                  >
                    <Sparkles className="h-3 w-3" />
                    使用最新分析結果
                  </button>
                  {compareQuery && (
                    <button
                      onClick={() => { setCompareQuery(""); setCompareResult(null); }}
                      className="ghost-button h-7 gap-1.5 rounded-full border border-white/10 px-3 text-[11px] text-slate-500 hover:text-white"
                    >
                      <X className="h-3 w-3" />
                      清除
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 比對結果 */}
            {comparing && (
              <div className="mt-4 flex items-center justify-center gap-3 rounded-[20px] border border-white/8 bg-white/[0.02] py-8">
                <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
                <p className="text-sm text-slate-400">正在比對知識庫…</p>
              </div>
            )}

            {compareResult && !comparing && (
              <div className="mt-4 space-y-3">
                {/* AI 回答 */}
                <div className="rounded-[20px] border border-brand-500/15 bg-brand-500/5 p-4">
                  <div className="flex items-center gap-2 border-b border-white/8 pb-3">
                    <BookOpen className="h-3.5 w-3.5 text-brand-400" />
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                      知識庫回應
                    </p>
                    {compareResult.latency_ms && (
                      <span className="ml-auto text-[10px] text-slate-600">
                        {(compareResult.latency_ms / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                  <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-200">
                    {compareResult.answer}
                  </div>
                </div>

                {/* 參考來源 */}
                {compareResult.sources.length > 0 ? (
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                      參考來源（{compareResult.sources.length} 筆）
                    </p>
                    <div className="space-y-1.5">
                      {compareResult.sources.map((s, i) => {
                        const pct = s.score != null ? Math.round(s.score * 100) : null;
                        const barColor = pct && pct >= 70 ? "bg-emerald-400" : pct && pct >= 40 ? "bg-amber-400" : "bg-slate-500";
                        return (
                          <div
                            key={i}
                            className="flex items-center gap-3 rounded-[14px] border border-white/8 bg-slate-950/40 px-4 py-2.5"
                          >
                            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/8 text-[10px] text-slate-400">
                              {i + 1}
                            </span>
                            <p className="flex-1 truncate text-sm text-slate-300">{s.filename}</p>
                            {s.page && (
                              <span className="text-[10px] text-slate-600">p.{s.page}</span>
                            )}
                            {pct != null && (
                              <div className="flex items-center gap-1.5">
                                <div className="h-1 w-16 overflow-hidden rounded-full bg-white/10">
                                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                                </div>
                                <span className={`text-[10px] font-semibold ${barColor.replace("bg-", "text-")}`}>
                                  {pct}%
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-[16px] border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                    <Info className="h-4 w-4 flex-shrink-0 text-amber-400" />
                    <p className="text-xs text-amber-300">
                      知識庫中尚無相關文件。請至「知識作業台」上傳維修手冊後再試。
                    </p>
                  </div>
                )}

                {/* 操作工具列 */}
                <div className="flex flex-wrap gap-2 border-t border-white/8 pt-3">
                  <button
                    onClick={() => handleCompare()}
                    className="ghost-button h-8 gap-1.5 rounded-full border border-white/10 px-3 text-[11px] text-slate-400 hover:text-white"
                  >
                    <RefreshCw className="h-3 w-3" />
                    重新比對
                  </button>
                  <button
                    onClick={handleSaveReport}
                    disabled={saving}
                    className="ghost-button h-8 gap-1.5 rounded-full border border-white/10 px-3 text-[11px] text-slate-400 hover:text-white"
                  >
                    <Save className="h-3 w-3" />
                    同時儲存報告
                  </button>
                  {savedReportId && (
                    <a
                      href={`/main/reports/${savedReportId}`}
                      className="ghost-button h-8 gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 text-[11px] text-emerald-300 hover:text-emerald-100"
                      target="_blank" rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-3 w-3" />
                      查看報告
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════════
          2. 次要資訊：可折疊區塊
          ══════════════════════════════════════════════════════════ */}
      <section className="grid gap-4 lg:grid-cols-3">

        {/* 系統狀態 */}
        <Collapsible
          kicker="System"
          title="推論引擎狀態"
          icon={<Radar className="h-4 w-4 text-slate-300" />}
        >
          <div className="grid grid-cols-2 gap-3">
            <StatusTile
              label="攝影機"
              statusLabel={cameraActive ? "Active" : "Standby"}
              value={cameraActive ? "Camera On" : "未啟動"}
              detail="瀏覽器原生 getUserMedia"
              tone={cameraActive ? "status-pill-ok" : "status-pill-warn"}
            />
            <StatusTile
              label="推論引擎"
              statusLabel={status?.llm_ok ? "Ready" : "Offline"}
              value={status?.llm_ok ? "Gemma Ready" : "Engine Offline"}
              detail={status?.model ?? "Gemma 4 E4B"}
              tone={status?.llm_ok ? "status-pill-ok" : "status-pill-danger"}
            />
            <StatusTile
              label="串流端點"
              statusLabel="WS"
              value="/api/vlm/ws"
              detail="WebSocket 逐 token 串流"
              tone="status-pill-warn"
            />
            <StatusTile
              label="報告儲存"
              statusLabel={savedReportId ? "Saved" : "Standby"}
              value={savedReportId ? "報告已建立" : "等待巡檢結果"}
              detail={savedReportId ? `ID: ${savedReportId.slice(0, 8)}…` : "支援轉出維護報告"}
              tone={savedReportId ? "status-pill-ok" : "status-pill-warn"}
            />
          </div>
        </Collapsible>

        {/* 巡檢前確認 */}
        <Collapsible
          kicker="Preflight"
          title="巡檢前確認"
          icon={<ShieldCheck className="h-4 w-4 text-emerald-300" />}
        >
          <div className="space-y-2.5">
            {CHECKLIST.map((item) => (
              <div key={item} className="flex items-start gap-3 rounded-[16px] border border-white/8 bg-slate-950/30 px-3.5 py-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-300" />
                <p className="text-xs leading-5 text-slate-300">{item}</p>
              </div>
            ))}
          </div>
        </Collapsible>

        {/* 建議巡檢場景 */}
        <Collapsible
          kicker="Inspection Scenarios"
          title="建議巡檢場景"
          icon={<Info className="h-4 w-4 text-brand-300" />}
        >
          <div className="space-y-2.5">
            {INSPECTION_SCENARIOS.map((s, i) => (
              <div key={s.title} className="rounded-[18px] border border-white/8 bg-white/[0.03] p-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="table-chip">0{i + 1}</span>
                  <p className="text-xs font-semibold text-white">{s.title}</p>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-slate-400">{s.detail}</p>
              </div>
            ))}
            <div className="rounded-[18px] border border-amber-400/15 bg-amber-500/8 p-3.5">
              <div className="flex items-start gap-2.5">
                <Zap className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-300" />
                <p className="text-xs leading-5 text-slate-300">
                  拍攝異常 → 等待推論完成 → 點「儲存為報告」或「知識庫比對 → 使用最新分析結果」，3 步完成現場診斷記錄。
                </p>
              </div>
            </div>
          </div>
        </Collapsible>
      </section>
    </div>
  );
}
