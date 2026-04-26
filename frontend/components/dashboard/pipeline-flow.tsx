"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Cpu,
  DatabaseZap,
  RefreshCw,
  Sparkles,
  WifiOff,
  AlertTriangle,
} from "lucide-react";
import { dashboardApi } from "@/lib/api";
import type { PipelineStage, PipelineStatus } from "@/types";

// ── 靜態設定（icon + 顏色）────────────────────────────────────────────
const STAGE_META: Record<string, {
  icon:         React.ElementType;
  onlineColor:  string;
  onlineBg:     string;
  onlineBorder: string;
}> = {
  vision: {
    icon:         Camera,
    onlineColor:  "text-accent-200",
    onlineBg:     "bg-accent-400/10",
    onlineBorder: "border-accent-400/25",
  },
  inference: {
    icon:         Cpu,
    onlineColor:  "text-brand-200",
    onlineBg:     "bg-brand-400/10",
    onlineBorder: "border-brand-400/25",
  },
  rag: {
    icon:         DatabaseZap,
    onlineColor:  "text-violet-300",
    onlineBg:     "bg-violet-400/10",
    onlineBorder: "border-violet-400/25",
  },
  output: {
    icon:         Sparkles,
    onlineColor:  "text-emerald-300",
    onlineBg:     "bg-emerald-400/10",
    onlineBorder: "border-emerald-400/25",
  },
};

const STATUS_DOT: Record<string, { dot: string; ring: string; pulse: boolean }> = {
  online:  { dot: "bg-emerald-400", ring: "ring-emerald-400/30", pulse: true  },
  warning: { dot: "bg-amber-400",   ring: "ring-amber-400/30",   pulse: true  },
  offline: { dot: "bg-rose-500",    ring: "ring-rose-500/25",    pulse: false },
  unknown: { dot: "bg-slate-500",   ring: "ring-slate-500/25",   pulse: false },
};

const OVERALL_CONFIG: Record<string, { label: string; chip: string; icon: React.ElementType }> = {
  online:   { label: "全線上",  chip: "status-pill status-pill-ok",   icon: CheckCircle2 },
  degraded: { label: "部分離線", chip: "status-pill status-pill-warn", icon: AlertTriangle },
  offline:  { label: "系統離線", chip: "status-pill status-pill-danger", icon: WifiOff },
};

// ── 單段卡片（水平緊湊版）────────────────────────────────────────────
function StageCard({ stage, index }: { stage: PipelineStage; index: number }) {
  const meta    = STAGE_META[stage.key] ?? STAGE_META.vision;
  const Icon    = meta.icon;
  const dotCfg  = STATUS_DOT[stage.status] ?? STATUS_DOT.unknown;
  const isOnline = stage.status === "online";

  // 每段只顯示前 3 個 metrics
  const metrics = Object.entries(stage.metrics).slice(0, 3);

  return (
    <div className={`flex flex-col gap-3 rounded-2xl border p-3 transition-all duration-300 ${
      isOnline ? `${meta.onlineBorder} ${meta.onlineBg}` : "border-white/8 bg-white/[0.025]"
    }`}>
      {/* 頂列：步驟號 + 名稱 + 狀態燈 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-slate-950/40 ${isOnline ? meta.onlineColor : "text-slate-500"}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="table-chip !px-1.5 !py-0 !text-[9px]">0{index + 1}</span>
              <p className="text-[13px] font-semibold text-white">{stage.label}</p>
            </div>
            <p className="truncate text-[11px] text-slate-500">{stage.subtitle}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dotCfg.dot} ring-2 ${dotCfg.ring}`}>
            {dotCfg.pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotCfg.dot} opacity-50`} />}
          </span>
          <span className={`text-[10px] font-medium ${
            isOnline ? "text-emerald-400" : stage.status === "warning" ? "text-amber-400" : stage.status === "offline" ? "text-rose-400" : "text-slate-500"
          }`}>{stage.status_label}</span>
        </div>
      </div>

      {/* Metrics — 單欄堆疊 */}
      <div className="flex flex-col gap-1">
        {metrics.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2 rounded-xl border border-white/6 bg-slate-950/30 px-2.5 py-1.5">
            <p className="shrink-0 text-[10px] uppercase tracking-[0.15em] text-slate-600">{k}</p>
            <p className={`truncate text-right text-[11px] font-medium ${isOnline ? "text-slate-200" : "text-slate-500"}`}>{v}</p>
          </div>
        ))}
      </div>

      <p className="text-right text-[10px] text-slate-700">
        {new Date(stage.checked_at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
      </p>
    </div>
  );
}

// ── 主元件 ────────────────────────────────────────────────────────────
export default function PipelineFlow() {
  const [status, setStatus]   = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const timerRef              = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await dashboardApi.getPipelineStatus();
      setStatus(res.data as PipelineStatus);
    } catch {
      setError("無法取得管線狀態，後端可能尚未就緒");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    timerRef.current = setInterval(fetch, 30_000); // 30 秒自動刷新
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetch]);

  const overallCfg = OVERALL_CONFIG[status?.overall ?? "unknown"] ?? OVERALL_CONFIG.offline;
  const OverallIcon = overallCfg.icon;

  return (
    <div className="panel-soft rounded-2xl p-3">
      {/* Header — 一行緊湊 */}
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/8 pb-3">
        <div className="flex items-center gap-2">
          <span className="section-kicker">System Flow</span>
          <span className="text-[11px] text-slate-500">四段式即時管線 · 30s 自動刷新</span>
          {error && !status && (
            <div className="flex items-center gap-1.5 rounded-xl border border-amber-400/20 bg-amber-400/8 px-2.5 py-1">
              <AlertTriangle className="h-3 w-3 text-amber-300" />
              <span className="text-[11px] text-amber-300">後端連接中</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <span className={`${overallCfg.chip} !py-0.5 !text-[10px]`}>
              <OverallIcon className="h-3 w-3" />
              {overallCfg.label}
            </span>
          )}
          <button onClick={fetch} disabled={loading} className="secondary-button py-1 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "檢測中" : "刷新"}
          </button>
        </div>
      </div>

      {/* Pipeline stages — 水平 4 欄 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {status ? (
          status.stages.map((stage, i) => (
            <StageCard key={stage.key} stage={stage} index={i} />
          ))
        ) : (
          FALLBACK_STAGES.map((s, i) => (
            <div key={s.key} className="flex flex-col gap-2 rounded-2xl border border-white/8 bg-white/[0.025] p-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 animate-pulse items-center justify-center rounded-xl border border-white/8 bg-slate-800/60">
                  <s.icon className="h-4 w-4 text-slate-600" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="table-chip !px-1.5 !py-0 !text-[9px]">0{i + 1}</span>
                    <p className="text-[13px] font-semibold text-white">{s.label}</p>
                  </div>
                  <p className="text-[11px] text-slate-500">{s.detail}</p>
                </div>
              </div>
              <div className="h-2 w-3/4 animate-pulse rounded-full bg-slate-800" />
              <div className="h-2 w-1/2 animate-pulse rounded-full bg-slate-800/60" />
            </div>
          ))
        )}
      </div>

      {status && (
        <p className="mt-2 text-right text-[10px] text-slate-700">
          {new Date(status.checked_at).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </div>
  );
}

const FALLBACK_STAGES = [
  { key: "vision",    label: "視覺取像", detail: "RealSense D455 / WebRTC",       icon: Camera      },
  { key: "inference", label: "邊緣推論", detail: "Gemma 4 E4B + llama.cpp",        icon: Cpu         },
  { key: "rag",       label: "知識整合", detail: "SEGMA RAG + SOP",                icon: DatabaseZap },
  { key: "output",    label: "維護輸出", detail: "報告 / 工單 / LINE",              icon: Sparkles    },
];
