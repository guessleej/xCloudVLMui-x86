"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  Clock3,
  Cpu,
  Gauge,
  MapPin,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Waves,
} from "lucide-react";
import EquipmentDetailDrawer from "@/components/dashboard/equipment-detail-drawer";
import VhsChart from "@/components/dashboard/vhs-chart";
import AnomalyFeed from "@/components/dashboard/anomaly-feed";
import PipelineFlow from "@/components/dashboard/pipeline-flow";
import { dashboardApi } from "@/lib/api";
import type { Alert, Equipment, EquipmentSummary, VhsTrendMeta } from "@/types";

/* ─────────── Fallbacks ─────────── */
const FALLBACK_EQUIP: Equipment[] = [];
const FALLBACK_SUMMARY: EquipmentSummary = { total: 0, normal: 0, warning: 0, critical: 0, offline: 0 };

/* ─────────── Status config ─────── */
const S = {
  normal:   { dot: "bg-emerald-400", pill: "status-pill status-pill-ok",    label: "穩定", bar: "from-emerald-400 to-accent-300",  icon: ShieldCheck  },
  warning:  { dot: "bg-amber-400",   pill: "status-pill status-pill-warn",   label: "警戒", bar: "from-amber-300 to-brand-300",     icon: AlertTriangle },
  critical: { dot: "bg-rose-400",    pill: "status-pill status-pill-danger", label: "危急", bar: "from-rose-400 to-brand-300",      icon: ShieldAlert  },
  offline:  { dot: "bg-slate-500",   pill: "status-pill border-white/10 bg-white/[0.05] text-slate-400", label: "離線", bar: "from-slate-600 to-slate-400", icon: Clock3 },
} as const;
type StatusKey = keyof typeof S;

/* ─────────── Compact equipment row ─────── */
function EquipRow({
  item,
  active,
  onClick,
  onDetail,
}: {
  item: Equipment;
  active: boolean;
  onClick: () => void;
  onDetail: () => void;
}) {
  const cfg = S[(item.status as StatusKey) ?? "normal"] ?? S.normal;
  const pct = Math.max(0, Math.min(100, item.vhs_score ?? 0));

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      className={`group flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2.5 transition-all duration-200 ${
        active
          ? "border-accent-400/30 bg-accent-400/10 shadow-[0_0_0_1px_rgba(49,207,231,0.15)]"
          : "border-white/6 bg-white/[0.025] hover:border-white/12 hover:bg-white/[0.04]"
      }`}
    >
      {/* Status dot */}
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${cfg.dot} ${item.status === "critical" ? "animate-pulse" : ""}`}
      />

      {/* Name + meta */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-white group-hover:text-accent-100">
          {item.name}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{item.location}</span>
          <span className="text-white/20">·</span>
          <span className="truncate">{item.type}</span>
        </div>
      </div>

      {/* VHS score + bar */}
      <div className="shrink-0 text-right">
        <p className="text-[13px] font-semibold text-white">{(item.vhs_score ?? 0).toFixed(1)}</p>
        <div className="mt-1 h-1 w-14 overflow-hidden rounded-full bg-white/8">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${cfg.bar} transition-all duration-500`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Status badge */}
      <span className={`${cfg.pill} shrink-0 !px-2 !py-0.5 !text-[10px]`}>{cfg.label}</span>

      {/* Detail button */}
      <button
        onClick={(e) => { e.stopPropagation(); onDetail(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onDetail(); } }}
        className="shrink-0 rounded-lg border border-white/8 bg-slate-950/30 px-2 py-1 text-[10px] font-medium text-slate-400 transition-colors hover:border-brand-400/30 hover:text-brand-300"
      >
        詳情
      </button>
    </div>
  );
}

/* ─────────── Action guide ───────── */
function getGuide(e: Equipment | null) {
  if (!e)                       return { title: "尚未選擇設備",   body: "點選設備列查看詳情與維護建議。",           next: "待命中" };
  if (e.status === "critical")  return { title: "立即停機檢查",   body: "偵測到高風險異常，建議立刻中止運轉。",      next: "P1 緊急維修工單" };
  if (e.status === "warning")   return { title: "排入本日處置",   body: "設備已進入警戒區，請安排預防性維護。",      next: "P2 預防維護任務" };
  if (e.status === "offline")   return { title: "確認通訊與電源", body: "設備不在線，請確認網路與邊緣節點狀態。",    next: "通訊檢測" };
  return                               { title: "維持巡檢節奏",   body: "健康分數穩定，按排程巡檢並追蹤長期趨勢。", next: "例行維護排程" };
}

function averageVhs(list: Equipment[]) {
  if (!list.length) return 0;
  return list.reduce((s, i) => s + (i.vhs_score ?? 0), 0) / list.length;
}

/* ─────────── KPI Chip ───────────── */
function KpiChip({
  label, value, sub, color,
}: {
  label: string; value: number | string; sub: string; color: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
      <span className={`text-[10px] uppercase tracking-[0.2em] ${color}`}>{label}</span>
      <span className="font-display text-2xl font-semibold leading-none text-white">{value}</span>
      <span className="truncate text-[11px] text-slate-500">{sub}</span>
    </div>
  );
}

/* ─────────── Page ───────────────── */
export default function DashboardPage() {
  const [summary,        setSummary]        = useState<EquipmentSummary>(FALLBACK_SUMMARY);
  const [equipment,      setEquipment]      = useState<Equipment[]>(FALLBACK_EQUIP);
  const [alerts,         setAlerts]         = useState<Alert[]>([]);
  const [vhsMeta,        setVhsMeta]        = useState<VhsTrendMeta | null>(null);
  const [selected,       setSelected]       = useState<Equipment | null>(null);
  const [drawerOpen,     setDrawerOpen]     = useState(false);
  const [drawerEquip,    setDrawerEquip]    = useState<Equipment | null>(null);
  const [loading,        setLoading]        = useState(false);
  const [lastUpdate,     setLastUpdate]     = useState(new Date());
  const selectedIdRef = useRef<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, eqRes, alertRes] = await Promise.all([
        dashboardApi.getSummary(),
        dashboardApi.getEquipment(),
        dashboardApi.getAlerts(),
      ]);
      setSummary(sumRes.data as EquipmentSummary);
      setAlerts(alertRes.data as Alert[]);
      const eq = eqRes.data as Equipment[];
      setEquipment(eq);
      setLastUpdate(new Date());
      const next = eq.find(i => i.id === selectedIdRef.current) ?? eq[0] ?? null;
      setSelected(next);
      selectedIdRef.current = next?.id ?? null;
      if (next) {
        const vhs = await dashboardApi.getVhsTrend(next.id);
        setVhsMeta(vhs.data as VhsTrendMeta);
      }
    } catch { /* keep fallback */ } finally {
      setLoading(false);
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try { setAlerts((await dashboardApi.getAlerts()).data as Alert[]); } catch { /* keep */ }
  }, []);

  const fetchVhs = async (id: string) => {
    try { setVhsMeta((await dashboardApi.getVhsTrend(id)).data as VhsTrendMeta); } catch { /* keep */ }
  };

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSelect = async (item: Equipment) => {
    setSelected(item);
    selectedIdRef.current = item.id;
    await fetchVhs(item.id);
  };
  const handleDetail = (item: Equipment) => { setDrawerEquip(item); setDrawerOpen(true); };
  const handleResolve = async (id: string) => { await dashboardApi.resolveAlert(id); await fetchAlerts(); };
  const handleDelete  = async (id: string) => { await dashboardApi.deleteAlert(id);  await fetchAlerts(); };
  const handleCreate  = async (p: { equipment_id: string; equipment_name: string; level: string; message: string }) => {
    await dashboardApi.createAlert(p);
    await fetchAlerts();
  };

  const unresolved = alerts.filter(a => !a.resolved).length;
  const guide      = getGuide(selected);
  const selCfg     = S[(selected?.status as StatusKey) ?? "normal"] ?? S.normal;

  return (
    <>
      <EquipmentDetailDrawer
        equipment={drawerEquip}
        alerts={alerts}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreateAlert={handleCreate}
        onResolve={handleResolve}
      />

      {/*
       * ┌─ 1. HEADER BAR ─────────────────────────────────────────────────┐
       */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/8 bg-slate-900/60 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-semibold text-white">製造設備維護戰情中心</h1>
          <span className="signal-chip"><Cpu  className="h-3 w-3 text-accent-300" />NVIDIA Jetson</span>
          <span className="signal-chip"><Camera className="h-3 w-3 text-brand-300" />WebRTC</span>
          <span className="signal-chip"><Waves  className="h-3 w-3 text-emerald-300" />3–5s 推論</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-500">
            {lastUpdate.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })} 同步
          </span>
          <button onClick={fetchData} disabled={loading} className="secondary-button py-1.5 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            重新整理
          </button>
        </div>
      </div>

      {/*
       * ┌─ 2. KPI ROW ────────────────────────────────────────────────────┐
       */}
      <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <KpiChip label="設備總數"   value={summary.total}    sub="納管節點"       color="text-slate-400" />
        <KpiChip label="穩定運作"   value={summary.normal}   sub="VHS ≥ 70"      color="text-emerald-400" />
        <KpiChip label="警戒中"     value={summary.warning}  sub="待排維護"       color="text-amber-400" />
        <KpiChip label="危急"       value={summary.critical} sub="立即停機"       color="text-rose-400" />
        <KpiChip label="未解決事件" value={unresolved}       sub="依風險排序"     color="text-brand-300" />
        <KpiChip label="平均 VHS"   value={averageVhs(equipment).toFixed(1)} sub="全場均值" color="text-accent-300" />
      </div>

      {/*
       * ┌─ 3. MAIN GRID ──────────────────────────────────────────────────┐
       *   Left: equipment list  |  Right: asset detail + alerts
       */}
      <div className="mb-3 grid gap-3 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px]">

        {/* LEFT — Equipment board */}
        <div className="panel-soft flex flex-col rounded-2xl p-3">
          {/* Board header */}
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-white/8 pb-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Equipment Board</p>
              <h2 className="mt-0.5 text-sm font-semibold text-white">受監控設備</h2>
            </div>
            <div className="flex items-center gap-2">
              {/* Status legend */}
              <span className="hidden items-center gap-1.5 text-[10px] text-slate-500 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />穩定
                <span className="ml-1 h-1.5 w-1.5 rounded-full bg-amber-400" />警戒
                <span className="ml-1 h-1.5 w-1.5 rounded-full bg-rose-400" />危急
                <span className="ml-1 h-1.5 w-1.5 rounded-full bg-slate-500" />離線
              </span>
              <span className="text-[11px] text-slate-500">{equipment.length} 台</span>
            </div>
          </div>

          {/* Equipment rows — scrollable */}
          <div className="flex flex-col gap-1.5 overflow-y-auto lg:max-h-[420px] xl:max-h-[460px]">
            {equipment.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Gauge className="h-8 w-8 text-slate-600" />
                <p className="mt-3 text-sm text-slate-500">後端連接中，請稍候…</p>
              </div>
            ) : (
              equipment.map((item) => (
                <EquipRow
                  key={item.id}
                  item={item}
                  active={selected?.id === item.id}
                  onClick={() => handleSelect(item)}
                  onDetail={() => handleDetail(item)}
                />
              ))
            )}
          </div>
        </div>

        {/* RIGHT — Selected asset + Anomaly feed */}
        <div className="flex flex-col gap-3">

          {/* Asset detail card */}
          <div className="panel-soft rounded-2xl p-3">
            {/* Header row */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Selected Asset</p>
                <h2 className="mt-0.5 truncate text-sm font-semibold text-white">
                  {selected?.name ?? "尚未選擇設備"}
                </h2>
                <p className="truncate text-[11px] text-slate-500">
                  {selected?.location ?? "點選左側設備列查看詳情"}
                </p>
              </div>
              {/* VHS badge */}
              <div className="shrink-0 rounded-xl border border-white/8 bg-slate-950/35 px-3 py-2 text-center">
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">VHS</p>
                <p className="font-display text-xl font-semibold text-white">
                  {selected?.vhs_score?.toFixed(1) ?? "—"}
                </p>
                {selected && (
                  <span className={`${selCfg.pill} mt-1 !px-1.5 !py-0 !text-[9px]`}>{selCfg.label}</span>
                )}
              </div>
            </div>

            {/* VHS progress bar */}
            {selected && (
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/8">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${selCfg.bar} transition-all duration-500`}
                  style={{ width: `${Math.max(0, Math.min(100, selected.vhs_score ?? 0))}%` }}
                />
              </div>
            )}

            {/* Action guide */}
            <div className="mt-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">優先建議</p>
              <p className="mt-1 text-sm font-semibold text-white">{guide.title}</p>
              <p className="mt-1 text-[12px] leading-5 text-slate-400">{guide.body}</p>
              <div className="mt-2 flex items-center justify-between rounded-lg border border-white/8 bg-slate-950/30 px-2.5 py-1.5">
                <span className="text-[12px] font-medium text-white">{guide.next}</span>
                <ArrowRight className="h-3.5 w-3.5 text-brand-300" />
              </div>
            </div>

            {/* 3 prop cells */}
            <div className="mt-2.5 grid grid-cols-3 gap-1.5">
              {[
                { label: "設備型別", value: selected?.type ?? "—" },
                { label: "活躍警報", value: selected ? `${selected.active_alerts}` : "—" },
                {
                  label: "最後巡檢",
                  value: selected?.last_inspection
                    ? new Date(selected.last_inspection).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })
                    : "—",
                },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl border border-white/8 bg-slate-950/25 px-2 py-2">
                  <p className="text-[10px] uppercase tracking-[0.15em] text-slate-500">{label}</p>
                  <p className="mt-0.5 truncate text-xs font-medium text-white">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Anomaly feed — scrollable */}
          <div className="min-h-0 flex-1 overflow-y-auto lg:max-h-[280px] xl:max-h-[300px]">
            <AnomalyFeed
              alerts={alerts}
              onResolve={handleResolve}
              onDelete={handleDelete}
            />
          </div>
        </div>
      </div>

      {/*
       * ┌─ 4. BOTTOM — VHS Chart (full width) + Pipeline (full width 4-col) ─┐
       */}
      <VhsChart
        meta={vhsMeta}
        equipmentId={selected?.id ?? ""}
        equipmentName={selected?.name ?? ""}
        onRecorded={() => selected && fetchVhs(selected.id)}
      />
      <PipelineFlow />
    </>
  );
}
