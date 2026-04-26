"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  CheckSquare,
  Clock,
  Cog,
  Download,
  Eye,
  FileText,
  Filter,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Shield,
  Square,
  Trash2,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { eventsApi } from "@/lib/api";
import type { FactoryEvent, EventStats } from "@/types";

// ── 嚴重度設定 ────────────────────────────────────────────────────────
const SEVERITY_META: Record<string, {
  label: string; dot: string; pill: string; border: string; row: string;
}> = {
  critical: { label: "緊急", dot: "bg-rose-500",    pill: "bg-rose-500/10 text-rose-300 border-rose-500/30",    border: "border-l-rose-500",    row: "border-l-rose-500" },
  high:     { label: "高",   dot: "bg-amber-500",   pill: "bg-amber-500/10 text-amber-300 border-amber-500/30",   border: "border-l-amber-500",   row: "border-l-amber-500" },
  medium:   { label: "中",   dot: "bg-yellow-500",  pill: "bg-yellow-500/10 text-yellow-300 border-yellow-500/30", border: "border-l-yellow-500",  row: "border-l-yellow-400" },
  low:      { label: "低",   dot: "bg-emerald-500", pill: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", border: "border-l-emerald-500", row: "border-l-emerald-500" },
  info:     { label: "資訊", dot: "bg-sky-400",     pill: "bg-sky-500/10 text-sky-300 border-sky-500/30",     border: "border-l-sky-500",     row: "border-l-sky-400" },
};

// ── 事件類型設定 ──────────────────────────────────────────────────────
const TYPE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  detection:     { label: "偵測",    icon: Eye,           color: "text-cyan-400"   },
  hazard:        { label: "危害",    icon: AlertTriangle, color: "text-amber-400"  },
  ppe_violation: { label: "PPE違規", icon: Shield,        color: "text-rose-400"   },
  equipment:     { label: "設備",    icon: Cog,           color: "text-blue-400"   },
  system:        { label: "系統",    icon: Server,        color: "text-slate-400"  },
};

function getTypeMeta(t: string) { return TYPE_META[t] ?? { label: t, icon: Info, color: "text-slate-400" }; }
function getSev(s: string)      { return SEVERITY_META[s] ?? SEVERITY_META.info; }

function relativeTime(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60)    return `${d}s`;
  if (d < 3600)  return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

// ── 匯出 MD ───────────────────────────────────────────────────────────
function exportMd(events: FactoryEvent[], label = "全部") {
  const lines = [
    `# 工廠事件報告`, ``,
    `- 匯出時間：${new Date().toLocaleString("zh-TW", { hour12: false })}`,
    `- 範圍：${label}（${events.length} 筆）`, ``, `---`, ``,
  ];
  events.forEach((ev, i) => {
    const sm = getSev(ev.severity);
    const tm = getTypeMeta(ev.event_type);
    const status = ev.resolved ? "已解決" : ev.acknowledged ? "已確認" : "未處理";
    lines.push(`## ${i + 1}. ${ev.title}`, ``);
    lines.push(`| 欄位 | 內容 |`, `|---|---|`);
    lines.push(`| 嚴重度 | ${sm.label} |`, `| 類型 | ${tm.label} |`, `| 狀態 | ${status} |`, `| 時間 | ${formatTime(ev.created_at)} |`);
    if (ev.location) lines.push(`| 位置 | ${ev.location} |`);
    lines.push(``, `**訊息**：${ev.message}`, ``, `---`, ``);
  });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" })),
    download: `events-${new Date().toISOString().slice(0, 10)}.md`,
  });
  a.click(); URL.revokeObjectURL(a.href);
}

const SEVERITIES  = ["ALL", "critical", "high", "medium", "low", "info"];
const EVENT_TYPES = ["ALL", "detection", "hazard", "ppe_violation", "equipment", "system"];
const TIME_RANGES = [{ label: "1h", h: 1 }, { label: "24h", h: 24 }, { label: "7d", h: 168 }, { label: "全部", h: undefined as number | undefined }];

const SEV_ACTIVE: Record<string, string> = {
  critical: "border-rose-500/50 bg-rose-500/15 text-rose-200",
  high:     "border-amber-500/50 bg-amber-500/15 text-amber-200",
  medium:   "border-yellow-500/50 bg-yellow-500/15 text-yellow-200",
  low:      "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
  info:     "border-sky-500/50 bg-sky-500/15 text-sky-200",
};

// ── 緊湊事件列 ────────────────────────────────────────────────────────
function EventRow({
  event, onAck, onResolve, onDelete, selectionMode, isSelected, onToggle,
}: {
  event: FactoryEvent;
  onAck: (id: string) => void;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  selectionMode: boolean;
  isSelected: boolean;
  onToggle: (id: string) => void;
}) {
  const sm = getSev(event.severity);
  const tm = getTypeMeta(event.event_type);
  const TypeIcon = tm.icon;
  const [showThumb, setShowThumb] = useState(false);

  return (
    <>
      <div
        onClick={selectionMode ? () => onToggle(event.id) : undefined}
        className={`group flex items-center gap-2.5 border-b border-white/[0.04] border-l-2 px-3 py-2.5 transition-colors ${sm.row} ${
          selectionMode
            ? `cursor-pointer ${isSelected ? "bg-sky-500/[0.07]" : "hover:bg-white/[0.03]"}`
            : `${event.resolved ? "opacity-50" : "hover:bg-white/[0.03]"}`
        }`}
      >
        {/* 選取框 / 狀態燈 */}
        <div className="flex w-5 shrink-0 items-center justify-center">
          {selectionMode ? (
            <div className={`flex h-4 w-4 items-center justify-center rounded border ${isSelected ? "border-sky-500/50 bg-sky-500/20 text-sky-300" : "border-white/20 text-slate-600"}`}>
              {isSelected ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
            </div>
          ) : (
            <span className={`h-2 w-2 rounded-full ${sm.dot} ${event.resolved ? "opacity-30" : "animate-pulse"}`} />
          )}
        </div>

        {/* 嚴重度 badge */}
        <span className={`inline-flex shrink-0 items-center rounded-[5px] border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${sm.pill}`}>
          {sm.label}
        </span>

        {/* 類型 icon */}
        <div className="flex w-5 shrink-0 items-center justify-center">
          <TypeIcon className={`h-3.5 w-3.5 ${tm.color}`} />
        </div>

        {/* 標題 + 訊息 */}
        <div className="min-w-0 flex-1">
          <p className={`truncate text-xs font-semibold ${event.resolved ? "text-slate-500" : "text-white"}`}>
            {event.title}
          </p>
          <p className="truncate text-[10px] text-slate-500">{event.message}</p>
        </div>

        {/* 狀態 badges */}
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          {event.acknowledged && !event.resolved && (
            <span className="flex items-center gap-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-300">
              <CheckCircle2 className="h-2.5 w-2.5" />確認
            </span>
          )}
          {event.resolved && (
            <span className="flex items-center gap-0.5 rounded border border-slate-500/30 bg-slate-500/10 px-1.5 py-0.5 text-[9px] text-slate-400">
              <CheckCircle2 className="h-2.5 w-2.5" />已解決
            </span>
          )}
        </div>

        {/* 來源 */}
        <span className="hidden shrink-0 text-[10px] uppercase tracking-wide text-slate-600 lg:block">
          {event.source}
        </span>

        {/* 位置 */}
        {event.location && (
          <span className="hidden shrink-0 text-[10px] text-slate-600 xl:block">
            📍 {event.location}
          </span>
        )}

        {/* 截圖按鈕 */}
        {event.thumbnail && !selectionMode && (
          <button
            onClick={e => { e.stopPropagation(); setShowThumb(v => !v); }}
            className="shrink-0 text-[10px] text-sky-500 hover:text-sky-400"
          >
            {showThumb ? "隱藏" : "截圖"}
          </button>
        )}

        {/* 時間 */}
        <div className="shrink-0 text-right">
          <p className="text-[10px] text-slate-500">{formatTime(event.created_at)}</p>
          <p className="text-[9px] text-slate-700">{relativeTime(event.created_at)} 前</p>
        </div>

        {/* 操作按鈕 */}
        {!selectionMode && (
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {!event.resolved && !event.acknowledged && (
              <button
                onClick={e => { e.stopPropagation(); onAck(event.id); }}
                title="確認"
                className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-500 hover:border-amber-500/40 hover:text-amber-300"
              >
                <Bell className="h-3 w-3" />
              </button>
            )}
            {!event.resolved && (
              <button
                onClick={e => { e.stopPropagation(); onResolve(event.id); }}
                title="解決"
                className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-500 hover:border-emerald-500/40 hover:text-emerald-300"
              >
                <CheckCircle2 className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={e => { e.stopPropagation(); onDelete(event.id); }}
              title="刪除"
              className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-500 hover:border-rose-500/40 hover:text-rose-300"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {/* 縮圖展開列 */}
      {showThumb && event.thumbnail && (
        <div className="border-b border-white/[0.04] bg-white/[0.015] px-10 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={event.thumbnail} alt="截圖" className="max-h-32 rounded-lg border border-white/10 object-contain" />
        </div>
      )}
    </>
  );
}

// ── 主頁面 ────────────────────────────────────────────────────────────
export default function FactoryEventsPage() {
  const [events,        setEvents]        = useState<FactoryEvent[]>([]);
  const [stats,         setStats]         = useState<EventStats | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [autoRefresh,   setAutoRefresh]   = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set());
  const [showExport,    setShowExport]    = useState(false);

  const [severity,    setSeverity]    = useState("ALL");
  const [eventType,   setEventType]   = useState("ALL");
  const [resolved,    setResolved]    = useState<boolean | undefined>(false);
  const [sinceH,      setSinceH]      = useState<number | undefined>(24);
  const [searchInput, setSearchInput] = useState("");
  const [search,      setSearch]      = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setSearch(searchInput), 400);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [searchInput]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [evRes, stRes] = await Promise.all([
        eventsApi.list({ severity: severity !== "ALL" ? severity : undefined, event_type: eventType !== "ALL" ? eventType : undefined, resolved, since_h: sinceH, limit: 200 }),
        eventsApi.stats(),
      ]);
      let data: FactoryEvent[] = evRes.data;
      if (search) {
        const q = search.toLowerCase();
        data = data.filter(e => e.title.toLowerCase().includes(q) || e.message.toLowerCase().includes(q) || e.source.toLowerCase().includes(q));
      }
      setEvents(data);
      setStats(stRes.data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      toast.error("載入失敗：" + (e?.response?.data?.detail ?? e?.message ?? "未知"));
    } finally {
      setLoading(false);
    }
  }, [severity, eventType, resolved, sinceH, search]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    if (!autoRefresh || selectionMode) return;
    const id = setInterval(fetchAll, 15_000);
    return () => clearInterval(id);
  }, [autoRefresh, selectionMode, fetchAll]);

  const handleAck = async (id: string) => {
    try { await eventsApi.acknowledge(id); toast.success("已確認"); fetchAll(); }
    catch (err: unknown) { const e = err as { response?: { data?: { detail?: string } } }; toast.error("失敗：" + (e?.response?.data?.detail ?? "未知")); }
  };
  const handleResolve = async (id: string) => {
    try { await eventsApi.resolve(id); toast.success("已標記解決"); fetchAll(); }
    catch (err: unknown) { const e = err as { response?: { data?: { detail?: string } } }; toast.error("失敗：" + (e?.response?.data?.detail ?? "未知")); }
  };
  const handleDelete = async (id: string) => {
    if (!confirm("確定永久刪除這筆事件？")) return;
    try { await eventsApi.delete(id); toast.success("已刪除"); fetchAll(); }
    catch (err: unknown) { const e = err as { response?: { data?: { detail?: string } } }; toast.error("失敗：" + (e?.response?.data?.detail ?? "未知")); }
  };
  const handleBatchDelete = async () => {
    if (!selectedIds.size || !confirm(`確定永久刪除 ${selectedIds.size} 筆事件？`)) return;
    try { await eventsApi.batchDelete(Array.from(selectedIds)); toast.success(`已刪除 ${selectedIds.size} 筆`); setSelectedIds(new Set()); setSelectionMode(false); fetchAll(); }
    catch (err: unknown) { const e = err as { response?: { data?: { detail?: string } } }; toast.error("批次刪除失敗：" + (e?.response?.data?.detail ?? "未知")); }
  };

  const toggleSelect   = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll      = () => setSelectedIds(new Set(events.map(e => e.id)));
  const clearSelect    = () => setSelectedIds(new Set());
  const exitSelection  = () => { setSelectionMode(false); setSelectedIds(new Set()); };

  const pill = (active: boolean, label: string, onClick: () => void, color?: string) => (
    <button
      key={label}
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all ${
        active ? (color ?? "border-brand-500/50 bg-brand-500/15 text-brand-200")
               : "border-white/10 bg-white/[0.03] text-slate-500 hover:text-slate-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-2">

      {/* ── Header bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/8 bg-slate-900/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="section-kicker">Factory Events</span>
          <h2 className="text-sm font-semibold text-white">工廠事件</h2>
          {stats && stats.unresolved > 0 && (
            <span className="status-pill status-pill-danger !py-0.5 !text-[10px]">{stats.unresolved} 未解決</span>
          )}
          {stats && stats.critical_24h > 0 && (
            <span className="status-pill status-pill-danger !py-0.5 !text-[10px]">{stats.critical_24h} 緊急(24h)</span>
          )}
          {/* 類型統計 inline chips */}
          {stats && Object.entries(stats.by_type).sort(([,a],[,b])=>b-a).map(([type, count]) => {
            const tm = getTypeMeta(type);
            const TIcon = tm.icon;
            return (
              <button
                key={type}
                onClick={() => setEventType(eventType === type ? "ALL" : type)}
                className={`hidden items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] transition-colors sm:flex ${
                  eventType === type ? "border-brand-500/40 bg-brand-500/10 text-brand-200" : "border-white/8 bg-white/[0.025] text-slate-500 hover:text-slate-300"
                }`}
              >
                <TIcon className={`h-3 w-3 ${tm.color}`} />{count} {tm.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Stats inline */}
          {stats && (
            <div className="hidden items-center gap-2 text-[11px] text-slate-500 lg:flex">
              <span>共 <b className="text-white">{stats.total}</b> 筆</span>
              <span className="text-slate-700">·</span>
              <span>未解決 <b className={stats.unresolved > 0 ? "text-amber-400" : "text-white"}>{stats.unresolved}</b></span>
              <span className="text-slate-700">·</span>
              <span>緊急 <b className={stats.critical_24h > 0 ? "text-rose-400" : "text-white"}>{stats.critical_24h}</b></span>
            </div>
          )}

          <button
            onClick={() => selectionMode ? exitSelection() : setSelectionMode(true)}
            className={`secondary-button py-1 text-xs ${selectionMode ? "border-sky-500/50 bg-sky-500/15 text-sky-200" : ""}`}
          >
            {selectionMode ? <><CheckSquare className="h-3.5 w-3.5" />退出選取</> : <><Square className="h-3.5 w-3.5" />批次選取</>}
          </button>

          <div className="relative">
            <button onClick={() => setShowExport(v => !v)} className="secondary-button py-1 text-xs">
              <FileText className="h-3.5 w-3.5" />匯出
            </button>
            {showExport && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowExport(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-xl">
                  <button onClick={() => { if (!selectedIds.size) { toast.error("請先選取事件"); return; } exportMd(events.filter(e => selectedIds.has(e.id)), `已選 ${selectedIds.size} 筆`); setShowExport(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.06]">
                    <Download className="h-3.5 w-3.5 text-sky-400" />匯出已選取
                  </button>
                  <div className="border-t border-white/8" />
                  <button onClick={() => { exportMd(events, `全部 ${events.length} 筆`); setShowExport(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.06]">
                    <Download className="h-3.5 w-3.5 text-emerald-400" />匯出全部 ({events.length})
                  </button>
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`secondary-button py-1 text-xs ${autoRefresh ? "border-brand-500/50 bg-brand-500/15 text-brand-200" : ""}`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${autoRefresh ? "animate-spin" : ""}`} />
            {autoRefresh ? "自動" : "手動"}
          </button>
          <button onClick={fetchAll} disabled={loading} className="secondary-button py-1 text-xs">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
        </div>
      </div>

      {/* ── 篩選列 ── */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
        {/* 搜尋 */}
        <div className="relative w-44 shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-600" />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="搜尋…"
            className="w-full rounded-xl border border-white/10 bg-slate-950/50 py-1.5 pl-7 pr-7 text-xs text-white placeholder-slate-600 outline-none focus:border-brand-500/40"
          />
          {searchInput && (
            <button onClick={() => setSearchInput("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="h-4 w-px bg-white/10" />

        {/* 嚴重度 */}
        {SEVERITIES.map(s => pill(severity === s, s === "ALL" ? "全部" : getSev(s).label, () => setSeverity(s), s !== "ALL" ? SEV_ACTIVE[s] : undefined))}

        <div className="h-4 w-px bg-white/10" />

        {/* 類型 */}
        <div className="flex items-center gap-1">
          <Filter className="h-3 w-3 text-slate-600" />
          <select value={eventType} onChange={e => setEventType(e.target.value)}
            className="rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-400 outline-none focus:border-brand-500/40">
            {EVENT_TYPES.map(t => <option key={t} value={t}>{t === "ALL" ? "全部類型" : getTypeMeta(t).label}</option>)}
          </select>
        </div>

        <div className="h-4 w-px bg-white/10" />

        {/* 狀態 */}
        {pill(resolved === false, "未解決", () => setResolved(false))}
        {pill(resolved === true,  "已解決", () => setResolved(true))}
        {pill(resolved === undefined, "全部狀態", () => setResolved(undefined))}

        <div className="h-4 w-px bg-white/10" />

        {/* 時間範圍 */}
        {TIME_RANGES.map(r => pill(sinceH === r.h, r.label, () => setSinceH(r.h)))}
      </div>

      {/* ── 事件列表（固定高度可捲動）── */}
      <div className="panel-soft overflow-hidden rounded-2xl">
        {/* 列表頂部工具列 */}
        <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
          <p className="text-xs font-semibold text-white">
            事件列表
            <span className="ml-1.5 text-xs font-normal text-slate-500">
              {events.length} 筆{loading ? "，更新中…" : ""}
            </span>
          </p>

          {selectionMode && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-sky-300">已選 {selectedIds.size} / {events.length}</span>
              <button onClick={selectAll}   className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-400 hover:text-white">全選</button>
              <button onClick={clearSelect} className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-400 hover:text-white">取消</button>
              <button onClick={() => { if (!selectedIds.size) return; exportMd(events.filter(e => selectedIds.has(e.id)), `已選 ${selectedIds.size} 筆`); }}
                disabled={!selectedIds.size}
                className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300 disabled:opacity-40">
                <Download className="h-3 w-3" />匯出
              </button>
              <button onClick={handleBatchDelete} disabled={!selectedIds.size}
                className="flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-300 disabled:opacity-40">
                <Trash2 className="h-3 w-3" />刪除 ({selectedIds.size})
              </button>
            </div>
          )}
        </div>

        {/* 捲動區 */}
        <div className="overflow-y-auto" style={{ maxHeight: "calc(100svh - 260px)" }}>
          {loading && events.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-slate-600" />
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Info className="h-8 w-8 text-slate-700" />
              <p className="mt-2 text-sm font-semibold text-white">暫無事件記錄</p>
              <p className="mt-1 text-xs text-slate-500">目前沒有符合篩選條件的事件</p>
            </div>
          ) : (
            events.map(event => (
              <EventRow
                key={event.id}
                event={event}
                onAck={handleAck}
                onResolve={handleResolve}
                onDelete={handleDelete}
                selectionMode={selectionMode}
                isSelected={selectedIds.has(event.id)}
                onToggle={toggleSelect}
              />
            ))
          )}
        </div>
      </div>

    </div>
  );
}
