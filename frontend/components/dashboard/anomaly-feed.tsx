"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, Siren, TimerReset, Trash2 } from "lucide-react";
import type { Alert } from "@/types";

interface AnomalyFeedProps {
  alerts: Alert[];
  onResolve?: (alertId: string) => Promise<void>;
  onDelete?: (alertId: string) => Promise<void>;
}

const LEVEL_CONFIG = {
  critical: {
    icon: Siren,
    label: "危急",
    chip: "badge-critical",
    accent: "bg-rose-400",
    border: "border-rose-400/18",
    surface: "bg-rose-400/8",
    action: "立即安排停機檢查",
  },
  elevated: {
    icon: AlertTriangle,
    label: "升高",
    chip: "badge-elevated",
    accent: "bg-amber-300",
    border: "border-amber-300/16",
    surface: "bg-amber-300/8",
    action: "今日內建立工單",
  },
  moderate: {
    icon: Info,
    label: "中等",
    chip: "badge-moderate",
    accent: "bg-sky-300",
    border: "border-sky-300/16",
    surface: "bg-sky-300/8",
    action: "本週完成預防維護",
  },
  low: {
    icon: Info,
    label: "低",
    chip: "badge-low",
    accent: "bg-emerald-300",
    border: "border-emerald-300/16",
    surface: "bg-emerald-300/8",
    action: "納入例行檢查",
  },
};

export default function AnomalyFeed({ alerts, onResolve, onDelete }: AnomalyFeedProps) {
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [deletingId,  setDeletingId]  = useState<string | null>(null);

  const handleResolve = async (alertId: string) => {
    if (!onResolve || resolvingId) return;
    setResolvingId(alertId);
    try {
      await onResolve(alertId);
    } finally {
      setResolvingId(null);
    }
  };

  const handleDelete = async (alertId: string) => {
    if (!onDelete || deletingId) return;
    setDeletingId(alertId);
    try {
      await onDelete(alertId);
    } finally {
      setDeletingId(null);
    }
  };

  if (alerts.length === 0) {
    return (
      <div className="panel-soft flex min-h-[280px] flex-col items-center justify-center rounded-[28px] p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10">
          <CheckCircle2 className="h-6 w-6 text-emerald-300" />
        </div>
        <h3 className="mt-4 text-lg font-semibold text-white">目前沒有未解決警報</h3>
        <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
          所有設備皆維持在可控範圍內，建議持續執行例行巡檢與歷史趨勢比對。
        </p>
      </div>
    );
  }

  return (
    <div className="panel-soft overflow-hidden rounded-[28px] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">異常事件時間軸</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            依風險等級排列，協助現場快速決定優先順序。
          </p>
        </div>
        <span className="signal-chip">{alerts.length} Active</span>
      </div>

      <div className="mt-5 space-y-4">
        {alerts.map((alert) => {
          const config =
            LEVEL_CONFIG[alert.level as keyof typeof LEVEL_CONFIG] ?? LEVEL_CONFIG.moderate;
          const Icon = config.icon;
          const isResolving = resolvingId === alert.id;
          const isDeleting  = deletingId  === alert.id;

          return (
            <div
              key={alert.id}
              className={`rounded-[24px] border ${config.border} ${config.surface} p-4 transition-opacity duration-300 ${
                isResolving || isDeleting ? "opacity-50" : "opacity-100"
              }`}
            >
              <div className="flex items-start gap-4">
                <div className="relative flex flex-col items-center pt-1">
                  <span className={`h-3 w-3 rounded-full ${config.accent}`} />
                  <span className="mt-2 h-full w-px flex-1 bg-white/10" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={config.chip}>{config.label}</span>
                    <p className="text-sm font-semibold text-white">{alert.equipment_name}</p>
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      <TimerReset className="h-3.5 w-3.5" />
                      {new Date(alert.created_at).toLocaleString("zh-TW", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>

                  <div className="mt-3 flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/40">
                      <Icon className="h-[18px] w-[18px] text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-6 text-slate-200">{alert.message}</p>
                      <div className="mt-3 rounded-2xl border border-white/8 bg-slate-950/30 px-3 py-2.5">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                          建議處置節奏
                        </p>
                        <p className="mt-1 text-sm font-medium text-white">{config.action}</p>
                      </div>
                    </div>
                  </div>

                  {/* Action row */}
                  {(onResolve || onDelete) && (
                    <div className="mt-3 flex items-center gap-2">
                      {onResolve && (
                        <button
                          onClick={() => handleResolve(alert.id)}
                          disabled={isResolving || isDeleting}
                          className="flex items-center gap-1.5 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs font-medium text-emerald-300 transition-colors hover:border-emerald-400/50 hover:bg-emerald-400/18 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isResolving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          標記已解決
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => handleDelete(alert.id)}
                          disabled={isResolving || isDeleting}
                          className="flex items-center gap-1.5 rounded-xl border border-rose-400/20 bg-rose-400/8 px-3 py-2 text-xs font-medium text-rose-300 transition-colors hover:border-rose-400/40 hover:bg-rose-400/15 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isDeleting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          刪除
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
