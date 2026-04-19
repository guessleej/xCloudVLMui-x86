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

// ── 單段卡片 ──────────────────────────────────────────────────────────
function StageCard({ stage, index }: { stage: PipelineStage; index: number }) {
  const meta   = STAGE_META[stage.key] ?? STAGE_META.vision;
  const Icon   = meta.icon;
  const dotCfg = STATUS_DOT[stage.status] ?? STATUS_DOT.unknown;

  const isOnline  = stage.status === "online";
  const cardBorder = isOnline ? meta.onlineBorder : "border-white/8";
  const cardBg     = isOnline ? meta.onlineBg : "bg-white/[0.025]";

  return (
    <div className={`relative overflow-hidden rounded-[24px] border ${cardBorder} ${cardBg} p-4 transition-all duration-500`}>
      {/* Step number + status dot */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-slate-950/40 ${isOnline ? meta.onlineColor : "text-slate-500"}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="table-chip">0{index + 1}</span>
              <p className="text-sm font-semibold text-white">{stage.label}</p>
            </div>
            <p className="mt-1 text-xs text-slate-500">{stage.subtitle}</p>
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex flex-col items-end gap-1">
          <div className={`relative flex h-3 w-3 items-center justify-center`}>
            <span className={`relative inline-flex h-3 w-3 rounded-full ${dotCfg.dot} ring-2 ${dotCfg.ring}`}>
              {dotCfg.pulse && (
                <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotCfg.dot} opacity-50`} />
              )}
            </span>
          </div>
          <span className={`text-[10px] font-medium ${
            stage.status === "online"  ? "text-emerald-400" :
            stage.status === "warning" ? "text-amber-400"   :
            stage.status === "offline" ? "text-rose-400"    : "text-slate-500"
          }`}>
            {stage.status_label}
          </span>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {Object.entries(stage.metrics).map(([k, v]) => (
          <div key={k} className="rounded-[16px] border border-white/6 bg-slate-950/30 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-600">{k}</p>
            <p className={`mt-1 text-xs font-medium leading-4 ${isOnline ? "text-slate-200" : "text-slate-500"}`}>
              {v}
            </p>
          </div>
        ))}
      </div>

      {/* Last checked */}
      <p className="mt-3 text-right text-[10px] text-slate-600">
        更新於 {new Date(stage.checked_at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
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
    <div className="panel-soft rounded-[30px] p-5 sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="section-kicker">System Flow</div>
          <h2 className="mt-3 text-2xl font-semibold text-white">資料流與輸出節奏</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            依照巡檢架構圖，將整體任務拆成四段式即時管線，每 30 秒自動刷新。
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {status && (
            <span className={overallCfg.chip}>
              <OverallIcon className="h-3 w-3" />
              {overallCfg.label}
            </span>
          )}
          <button
            onClick={fetch}
            disabled={loading}
            className="secondary-button"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "檢測中" : "刷新"}
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && !status && (
        <div className="mt-6 rounded-[22px] border border-amber-400/20 bg-amber-400/8 px-5 py-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-300" />
            <p className="text-sm text-amber-200">{error}</p>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            顯示靜態管線架構，連線後將自動切換為即時狀態。
          </p>
        </div>
      )}

      {/* Pipeline stages */}
      <div className="mt-6 space-y-4">
        {status ? (
          status.stages.map((stage, i) => (
            <StageCard key={stage.key} stage={stage} index={i} />
          ))
        ) : (
          /* Skeleton fallback（後端未就緒時顯示靜態架構）*/
          FALLBACK_STAGES.map((s, i) => (
            <div key={s.key} className="relative overflow-hidden rounded-[24px] border border-white/8 bg-white/[0.035] p-4">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 animate-pulse items-center justify-center rounded-2xl border border-white/8 bg-slate-800/60">
                  <s.icon className="h-5 w-5 text-slate-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="table-chip">0{i + 1}</span>
                    <p className="text-sm font-semibold text-white">{s.label}</p>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{s.detail}</p>
                  <div className="mt-3 h-2 w-3/4 animate-pulse rounded-full bg-slate-800" />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Last checked timestamp */}
      {status && (
        <p className="mt-4 text-right text-[11px] text-slate-600">
          最後檢測：{new Date(status.checked_at).toLocaleString("zh-TW", {
            month: "2-digit", day: "2-digit",
            hour: "2-digit",  minute: "2-digit", second: "2-digit",
          })}
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
