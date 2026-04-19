"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Loader2,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  Siren,
  X,
  Wrench,
  Activity,
  Info,
} from "lucide-react";
import type { Alert, Equipment } from "@/types";

interface EquipmentDetailDrawerProps {
  equipment: Equipment | null;
  alerts: Alert[];
  open: boolean;
  onClose: () => void;
  onCreateAlert?: (payload: {
    equipment_id: string;
    equipment_name: string;
    level: string;
    message: string;
  }) => Promise<void>;
  onResolve?: (alertId: string) => Promise<void>;
}

const STATUS_CONFIG = {
  normal: {
    label: "穩定",
    badge: "status-pill status-pill-ok",
    icon: ShieldCheck,
    text: "text-emerald-300",
    bar: "from-emerald-400 to-accent-300",
    scoreColor: "text-emerald-300",
    borderAccent: "border-emerald-400/20",
    bgAccent: "bg-emerald-400/10",
  },
  warning: {
    label: "警戒",
    badge: "status-pill status-pill-warn",
    icon: AlertTriangle,
    text: "text-amber-200",
    bar: "from-amber-300 to-brand-300",
    scoreColor: "text-amber-300",
    borderAccent: "border-amber-400/20",
    bgAccent: "bg-amber-400/10",
  },
  critical: {
    label: "危急",
    badge: "status-pill status-pill-danger",
    icon: ShieldAlert,
    text: "text-rose-200",
    bar: "from-rose-400 to-brand-300",
    scoreColor: "text-rose-300",
    borderAccent: "border-rose-400/20",
    bgAccent: "bg-rose-400/10",
  },
  offline: {
    label: "離線",
    badge: "status-pill border-white/10 bg-white/[0.05] text-slate-300",
    icon: Clock3,
    text: "text-slate-300",
    bar: "from-slate-500 to-slate-300",
    scoreColor: "text-slate-400",
    borderAccent: "border-white/10",
    bgAccent: "bg-white/[0.04]",
  },
};

const ALERT_LEVEL_CONFIG = {
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

function VhsBar({ score, gradient }: { score: number; gradient: string }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
          Visual Health Score
        </span>
        <span className="text-xs text-slate-400">
          {score >= 70 ? "穩定區" : score >= 40 ? "警戒區" : "危急區"}
        </span>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="absolute inset-y-0 left-[40%] w-px bg-white/15" />
        <div className="absolute inset-y-0 left-[70%] w-px bg-white/15" />
        <div
          className={`h-full rounded-full bg-gradient-to-r ${gradient} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-slate-600">
        <span>0</span>
        <span className="ml-[calc(40%-8px)]">40</span>
        <span className="ml-[calc(30%-8px)]">70</span>
        <span>100</span>
      </div>
    </div>
  );
}

function getActionGuide(equipment: Equipment) {
  if (equipment.status === "critical") {
    return {
      title: "立即停機檢查",
      summary: "偵測到高風險異常，建議立刻中止設備運轉，避免造成二次損傷或事故擴大。",
      nextStep: "P1 緊急維修工單",
      color: "text-rose-300",
      borderColor: "border-rose-400/20",
      bgColor: "bg-rose-400/8",
    };
  }
  if (equipment.status === "warning") {
    return {
      title: "排入本日處置",
      summary: "設備已進入警戒區，請搭配 RAG 手冊與歷史工單安排預防性維護。",
      nextStep: "P2 預防維護任務",
      color: "text-amber-300",
      borderColor: "border-amber-400/20",
      bgColor: "bg-amber-400/8",
    };
  }
  if (equipment.status === "offline") {
    return {
      title: "確認通訊與電源",
      summary: "設備目前不在線，先確認鏡頭、網路與邊緣節點是否正常連線。",
      nextStep: "通訊檢測",
      color: "text-slate-300",
      borderColor: "border-white/10",
      bgColor: "bg-white/[0.04]",
    };
  }
  return {
    title: "維持巡檢節奏",
    summary: "目前健康分數穩定，建議繼續按排程巡檢並追蹤長期退化趨勢。",
    nextStep: "例行維護排程",
    color: "text-emerald-300",
    borderColor: "border-emerald-400/20",
    bgColor: "bg-emerald-400/8",
  };
}

export default function EquipmentDetailDrawer({
  equipment,
  alerts,
  open,
  onClose,
  onCreateAlert,
  onResolve,
}: EquipmentDetailDrawerProps) {
  const [creating, setCreating] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  // Close on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!equipment) return null;

  const actionGuide = getActionGuide(equipment);

  const handleCreateWorkOrder = async () => {
    if (!onCreateAlert || creating) return;
    setCreating(true);
    try {
      await onCreateAlert({
        equipment_id:   equipment.id,
        equipment_name: equipment.name,
        level: equipment.status === "critical" ? "critical"
             : equipment.status === "warning"  ? "elevated"
             : "moderate",
        message: `[維保工單] ${equipment.name}（${equipment.id}）— 由詳情面板手動建立，請安排 ${actionGuide.nextStep}。`,
      });
    } finally {
      setCreating(false);
    }
  };

  const handleResolveInDrawer = async (alertId: string) => {
    if (!onResolve || resolvingId) return;
    setResolvingId(alertId);
    try {
      await onResolve(alertId);
    } finally {
      setResolvingId(null);
    }
  };

  const config = STATUS_CONFIG[equipment.status] ?? STATUS_CONFIG.normal;
  const Icon = config.icon;

  // Filter alerts for this equipment
  const equipmentAlerts = alerts.filter(
    (a) => a.equipment_id === equipment.id && !a.resolved
  );

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Drawer */}
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-[520px] flex-col overflow-hidden border-l border-white/8 bg-[#0d1117] shadow-2xl transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-white/8 px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={config.badge}>{config.label}</span>
              {equipment.active_alerts > 0 && (
                <span className="table-chip text-amber-100">
                  {equipment.active_alerts} 項待處理
                </span>
              )}
            </div>
            <h2 className="mt-3 truncate text-2xl font-semibold text-white">
              {equipment.name}
            </h2>
            <p className="mt-1 text-xs uppercase tracking-[0.24em] text-slate-500">
              {equipment.id}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04] text-slate-400 transition-colors hover:border-white/15 hover:bg-white/[0.08] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* VHS Score block */}
          <div className={`rounded-[24px] border ${config.borderAccent} ${config.bgAccent} p-5`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border border-white/8 bg-slate-950/40 ${config.text}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                    Visual Health Score
                  </p>
                  <p className="mt-1 text-sm text-slate-400">即時健康評估</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`font-display text-5xl font-semibold ${config.scoreColor}`}>
                  {equipment.vhs_score?.toFixed(1) ?? "--"}
                </p>
                <p className="mt-1 text-xs text-slate-500">/ 100</p>
              </div>
            </div>
            <div className="mt-5">
              <VhsBar score={equipment.vhs_score ?? 0} gradient={config.bar} />
            </div>
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3">
            <InfoCell label="設備型別" value={equipment.type} />
            <InfoCell
              label="廠房位置"
              value={equipment.location}
              icon={<MapPin className="h-3.5 w-3.5 text-slate-500" />}
            />
            <InfoCell
              label="活躍警報"
              value={`${equipment.active_alerts} 項`}
              icon={<Activity className="h-3.5 w-3.5 text-slate-500" />}
            />
            <InfoCell
              label="最後巡檢"
              value={
                equipment.last_inspection
                  ? new Date(equipment.last_inspection).toLocaleString("zh-TW", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "尚未巡檢"
              }
              icon={<Clock3 className="h-3.5 w-3.5 text-slate-500" />}
            />
          </div>

          {/* Action guide */}
          <div className={`rounded-[24px] border ${actionGuide.borderColor} ${actionGuide.bgColor} p-5`}>
            <div className="flex items-center gap-2">
              <Wrench className={`h-4 w-4 ${actionGuide.color}`} />
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">維保優先建議</p>
            </div>
            <p className={`mt-3 text-lg font-semibold ${actionGuide.color}`}>
              {actionGuide.title}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-300">{actionGuide.summary}</p>
            <div className="mt-4 flex items-center justify-between rounded-2xl border border-white/8 bg-slate-950/35 px-4 py-3">
              <span className="text-sm font-medium text-white">{actionGuide.nextStep}</span>
              <ArrowRight className={`h-4 w-4 ${actionGuide.color}`} />
            </div>
          </div>

          {/* Alerts for this equipment */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold text-white">設備警報紀錄</p>
              {equipmentAlerts.length > 0 ? (
                <span className="signal-chip">{equipmentAlerts.length} Active</span>
              ) : (
                <span className="table-chip text-emerald-300">無未解決警報</span>
              )}
            </div>

            {equipmentAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-[24px] border border-emerald-400/15 bg-emerald-400/6 px-6 py-8 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                <p className="mt-3 text-sm font-semibold text-white">設備運作正常</p>
                <p className="mt-1.5 text-xs leading-5 text-slate-400">
                  目前無未解決的異常警報，繼續維持例行巡檢節奏。
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {equipmentAlerts.map((alert) => {
                  const alertConfig =
                    ALERT_LEVEL_CONFIG[alert.level as keyof typeof ALERT_LEVEL_CONFIG] ??
                    ALERT_LEVEL_CONFIG.moderate;
                  const AlertIcon = alertConfig.icon;

                  return (
                    <div
                      key={alert.id}
                      className={`rounded-[22px] border ${alertConfig.border} ${alertConfig.surface} p-4`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={alertConfig.chip}>{alertConfig.label}</span>
                        <span className="text-xs text-slate-400">
                          {new Date(alert.created_at).toLocaleString("zh-TW", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div className="mt-3 flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-slate-950/40">
                          <AlertIcon className="h-4 w-4 text-white" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm leading-6 text-slate-200">{alert.message}</p>
                          <div className="mt-2.5 rounded-xl border border-white/8 bg-slate-950/30 px-3 py-2">
                            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                              建議處置節奏
                            </p>
                            <p className="mt-1 text-xs font-medium text-white">
                              {alertConfig.action}
                            </p>
                          </div>
                          {onResolve && (
                            <button
                              onClick={() => handleResolveInDrawer(alert.id)}
                              disabled={resolvingId === alert.id}
                              className="mt-2 flex items-center gap-1.5 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-400/18 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {resolvingId === alert.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3" />
                              )}
                              標記已解決
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="border-t border-white/8 px-6 py-4 grid grid-cols-2 gap-3">
          <button
            onClick={onClose}
            className="secondary-button justify-center"
          >
            關閉面板
          </button>
          <button
            onClick={handleCreateWorkOrder}
            disabled={creating}
            className="primary-button justify-center disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wrench className="h-4 w-4" />
            )}
            {creating ? "建立中..." : "建立維保工單"}
          </button>
        </div>
      </div>
    </>
  );
}

function InfoCell({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-[20px] border border-white/8 bg-slate-950/30 px-4 py-4">
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{label}</p>
      </div>
      <p className="mt-2 text-sm font-medium text-white leading-5">{value}</p>
    </div>
  );
}
