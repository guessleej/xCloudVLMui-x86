"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Settings,
  Trash2,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import { syslogApi } from "@/lib/api";
import type { SysLog, SysLogStats } from "@/types";

// ── 等級設定 ──────────────────────────────────────────────────────────
const LEVEL_META: Record<string, {
  label: string;
  icon: React.ElementType;
  pill: string;
  dot: string;
  border: string;
}> = {
  INFO:     { label: "INFO",     icon: Info,         pill: "bg-sky-500/15 text-sky-300 border-sky-500/20",      dot: "bg-sky-400",    border: "border-l-sky-500/50" },
  WARNING:  { label: "WARNING",  icon: AlertTriangle, pill: "bg-amber-500/15 text-amber-300 border-amber-500/20", dot: "bg-amber-400",  border: "border-l-amber-500" },
  ERROR:    { label: "ERROR",    icon: AlertCircle,   pill: "bg-red-500/15 text-red-300 border-red-500/20",       dot: "bg-red-500",    border: "border-l-red-500" },
  CRITICAL: { label: "CRITICAL", icon: Zap,           pill: "bg-rose-600/20 text-rose-300 border-rose-500/30",    dot: "bg-rose-500",   border: "border-l-rose-600" },
  DEBUG:    { label: "DEBUG",    icon: Settings,      pill: "bg-slate-500/15 text-slate-400 border-slate-500/20", dot: "bg-slate-500",  border: "border-l-slate-500/50" },
};

// ── 模組設定 ──────────────────────────────────────────────────────────
const MODULE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  mqtt:      { label: "MQTT",     icon: Wifi,         color: "text-emerald-400" },
  rag:       { label: "RAG",      icon: Database,     color: "text-purple-400" },
  report:    { label: "報告",     icon: CheckCircle2, color: "text-blue-400" },
  settings:  { label: "設定",     icon: Settings,     color: "text-slate-400" },
  auth:      { label: "認證",     icon: Server,       color: "text-orange-400" },
  vlm:       { label: "VLM",      icon: Activity,     color: "text-cyan-400" },
  dashboard: { label: "儀表板",   icon: Activity,     color: "text-brand-400" },
  system:    { label: "系統",     icon: Server,       color: "text-slate-500" },
};

function getModuleMeta(module: string) {
  return MODULE_META[module.toLowerCase()] ?? { label: module, icon: Server, color: "text-slate-400" };
}

function getLevelMeta(level: string) {
  return LEVEL_META[level.toUpperCase()] ?? LEVEL_META["INFO"];
}

// ── 相對時間 ──────────────────────────────────────────────────────────
function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)    return `${diff}s 前`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m 前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h 前`;
  return `${Math.floor(diff / 86400)}d 前`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("zh-TW", {
    month:  "2-digit", day:    "2-digit",
    hour:   "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
}

// ── 統計小格 ──────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: {
  label: string; value: string | number; sub?: string; accent?: string;
}) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className={`mt-2 font-display text-2xl font-semibold ${accent ?? "text-white"}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

// ── 展開詳情 Row ──────────────────────────────────────────────────────
function LogRow({ log }: { log: SysLog }) {
  const [expanded, setExpanded] = useState(false);
  const lm = getLevelMeta(log.level);
  const mm = getModuleMeta(log.module);
  const LIcon  = lm.icon;
  const MIcon  = mm.icon;

  return (
    <div className={`border-l-2 ${lm.border} rounded-r-[14px] bg-white/[0.025] border border-l-[2px] border-white/[0.04] mb-1.5 overflow-hidden transition-colors hover:bg-white/[0.04]`}>
      {/* Main row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        {/* Level icon */}
        <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border ${lm.pill}`}>
          <LIcon className="h-3.5 w-3.5" />
        </div>

        {/* Module badge */}
        <div className="hidden sm:flex items-center gap-1.5 w-[90px] flex-shrink-0">
          <MIcon className={`h-3 w-3 flex-shrink-0 ${mm.color}`} />
          <span className="text-[11px] font-semibold text-slate-400 truncate">{mm.label}</span>
        </div>

        {/* Action */}
        <code className="hidden md:block text-[11px] text-slate-500 w-[160px] flex-shrink-0 truncate font-mono">
          {log.action}
        </code>

        {/* Message */}
        <p className="flex-1 text-sm text-slate-300 truncate min-w-0">{log.message}</p>

        {/* Status code */}
        {log.status_code && (
          <span className={`hidden lg:block flex-shrink-0 text-[11px] font-semibold ${
            log.status_code >= 500 ? "text-red-400" :
            log.status_code >= 400 ? "text-amber-400" : "text-slate-500"
          }`}>
            {log.status_code}
          </span>
        )}

        {/* Duration */}
        {log.duration_ms != null && (
          <span className="hidden xl:block flex-shrink-0 text-[11px] text-slate-600 w-[56px] text-right">
            {log.duration_ms.toFixed(0)}ms
          </span>
        )}

        {/* Timestamp */}
        <span className="flex-shrink-0 text-[11px] text-slate-600 w-[72px] text-right">
          {relativeTime(log.timestamp)}
        </span>

        {/* Expand */}
        <ChevronRight className={`h-3.5 w-3.5 text-slate-600 flex-shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
      </div>

      {/* Detail panel */}
      {expanded && (
        <div className="border-t border-white/8 bg-slate-950/40 px-4 py-3 text-xs text-slate-400 space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div><span className="text-slate-600">時間：</span><span className="text-slate-300">{formatTime(log.timestamp)}</span></div>
            <div><span className="text-slate-600">模組：</span><span className="text-slate-300">{log.module}</span></div>
            <div><span className="text-slate-600">動作：</span><code className="text-slate-300 font-mono">{log.action}</code></div>
            {log.ip_address && <div><span className="text-slate-600">IP：</span><span className="text-slate-300">{log.ip_address}</span></div>}
            {log.status_code && <div><span className="text-slate-600">狀態碼：</span><span className="text-slate-300">{log.status_code}</span></div>}
            {log.duration_ms != null && <div><span className="text-slate-600">回應時間：</span><span className="text-slate-300">{log.duration_ms.toFixed(2)} ms</span></div>}
            {log.user_id && <div><span className="text-slate-600">使用者：</span><span className="text-slate-300">{log.user_id}</span></div>}
          </div>
          {log.detail && (
            <div>
              <p className="mb-1 text-slate-600">Detail：</p>
              <pre className="rounded-[8px] bg-slate-950/60 px-3 py-2 text-[11px] text-slate-300 overflow-x-auto font-mono leading-relaxed">
                {(() => {
                  try { return JSON.stringify(JSON.parse(log.detail!), null, 2); }
                  catch { return log.detail; }
                })()}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 篩選按鈕 ──────────────────────────────────────────────────────────
function FilterPill({
  active, onClick, children, color,
}: {
  active: boolean; onClick: () => void; children: React.ReactNode; color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-[10px] border px-3 py-1.5 text-xs font-semibold transition-all ${
        active
          ? (color ?? "border-brand-500/50 bg-brand-500/15 text-brand-200")
          : "border-white/10 bg-white/[0.04] text-slate-400 hover:border-white/20 hover:text-slate-300"
      }`}
    >
      {children}
    </button>
  );
}

// ── 主頁面 ────────────────────────────────────────────────────────────
const LEVELS  = ["ALL", "INFO", "WARNING", "ERROR", "CRITICAL"];
const MODULES = ["ALL", "mqtt", "rag", "report", "settings", "auth", "vlm", "system"];
const TIME_RANGES = [
  { label: "最近 1 小時", h: 1 },
  { label: "最近 24 小時", h: 24 },
  { label: "最近 7 天", h: 168 },
  { label: "全部", h: undefined },
];

export default function EventsPage() {
  const [logs,        setLogs]        = useState<SysLog[]>([]);
  const [stats,       setStats]       = useState<SysLogStats | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Filters
  const [level,   setLevel]   = useState("ALL");
  const [module,  setModule]  = useState("ALL");
  const [search,  setSearch]  = useState("");
  const [sinceH,  setSinceH]  = useState<number | undefined>(24);
  const [limit,   setLimit]   = useState(200);

  // Clear dialog
  const [showClear, setShowClear] = useState(false);
  const [clearDays, setClearDays] = useState(30);
  const [clearing,  setClearing]  = useState(false);

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchInput, setSearchInput] = useState("");

  // Debounce search input
  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => setSearch(searchInput), 400);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
  }, [searchInput]);

  // Fetch
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [logsRes, statsRes] = await Promise.all([
        syslogApi.list({
          level:   level   !== "ALL" ? level   : undefined,
          module:  module  !== "ALL" ? module  : undefined,
          search:  search  || undefined,
          since_h: sinceH,
          limit,
        }),
        syslogApi.stats(),
      ]);
      setLogs(logsRes.data);
      setStats(statsRes.data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      toast.error("載入失敗：" + (e?.response?.data?.detail ?? e?.message ?? "未知錯誤"));
    } finally {
      setLoading(false);
    }
  }, [level, module, search, sinceH, limit]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-refresh every 10s
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchAll, 10_000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchAll]);

  const handleClear = async () => {
    setClearing(true);
    try {
      await syslogApi.clear(clearDays);
      toast.success(`已清除 ${clearDays} 天前的日誌`);
      setShowClear(false);
      fetchAll();
    } catch {
      toast.error("清除失敗");
    } finally {
      setClearing(false);
    }
  };

  // Level color pills for stats
  const levelPillClass: Record<string, string> = {
    INFO:     "text-sky-300",
    WARNING:  "text-amber-300",
    ERROR:    "text-red-400",
    CRITICAL: "text-rose-400",
  };

  return (
    <div className="space-y-5">

      {/* ── Header ─────────────────────────────────────────────── */}
      <section className="panel-grid overflow-hidden rounded-[28px] px-5 py-4 sm:px-6">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-brand-500/30 bg-brand-500/15">
              <Bell className="h-5 w-5 text-brand-300" />
            </div>
            <div>
              <div className="section-kicker">System Events</div>
              <h1 className="display-title mt-0.5 text-xl sm:text-2xl">事件中心</h1>
            </div>
            {stats && (
              <div className="hidden items-center gap-2 xl:flex">
                <span className="signal-chip">
                  <Database className="h-3.5 w-3.5 text-slate-400" />
                  共 {stats.total.toLocaleString()} 筆
                </span>
                {stats.recent_errors_24h > 0 && (
                  <span className="status-pill status-pill-danger">
                    {stats.recent_errors_24h} 錯誤（24h）
                  </span>
                )}
                {stats.recent_warnings_24h > 0 && (
                  <span className="status-pill status-pill-warn">
                    {stats.recent_warnings_24h} 警告（24h）
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setAutoRefresh(v => !v)}
              className={`secondary-button ${autoRefresh ? "border-brand-500/50 bg-brand-500/15 text-brand-200" : ""}`}
            >
              <RefreshCw className={`h-4 w-4 ${autoRefresh ? "animate-spin" : ""}`} />
              {autoRefresh ? "自動刷新中" : "手動模式"}
            </button>
            <button onClick={fetchAll} disabled={loading} className="secondary-button">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              刷新
            </button>
            <button onClick={() => setShowClear(true)} className="secondary-button text-slate-500 hover:text-red-400">
              <Trash2 className="h-4 w-4" />
              清除日誌
            </button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="relative z-10 mt-4 grid grid-cols-2 gap-3 border-t border-white/8 pt-4 sm:grid-cols-4">
            <StatCard label="總日誌筆數"  value={stats.total.toLocaleString()} sub="資料庫累計" />
            <StatCard label="錯誤（24h）" value={stats.recent_errors_24h}   sub="ERROR + CRITICAL" accent={stats.recent_errors_24h > 0 ? "text-red-400" : "text-white"} />
            <StatCard label="警告（24h）" value={stats.recent_warnings_24h} sub="WARNING"          accent={stats.recent_warnings_24h > 0 ? "text-amber-400" : "text-white"} />
            <StatCard label="目前顯示"   value={logs.length}               sub={`限制 ${limit} 筆`} />
          </div>
        )}
      </section>

      {/* ── Filter Bar ──────────────────────────────────────────── */}
      <section className="panel-soft rounded-[24px] px-4 py-4">
        <div className="flex flex-wrap items-center gap-3">

          {/* Search */}
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="關鍵字搜尋訊息…"
              className="w-full rounded-[12px] border border-white/10 bg-slate-950/50 py-2 pl-9 pr-3.5 text-sm text-white placeholder-slate-600 outline-none focus:border-brand-500/50"
            />
            {searchInput && (
              <button onClick={() => setSearchInput("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Level */}
          <div className="flex flex-wrap gap-1.5">
            {LEVELS.map(l => (
              <FilterPill
                key={l}
                active={level === l}
                onClick={() => setLevel(l)}
                color={l !== "ALL" ? (
                  l === "INFO"     ? "border-sky-500/50 bg-sky-500/15 text-sky-200" :
                  l === "WARNING"  ? "border-amber-500/50 bg-amber-500/15 text-amber-200" :
                  l === "ERROR"    ? "border-red-500/50 bg-red-500/15 text-red-200" :
                  "border-rose-500/50 bg-rose-600/15 text-rose-200"
                ) : undefined}
              >
                {l === "ALL" ? "全部等級" : l}
              </FilterPill>
            ))}
          </div>

          {/* Module */}
          <div className="flex items-center gap-1.5">
            <select
              value={module}
              onChange={e => setModule(e.target.value)}
              className="rounded-[12px] border border-white/10 bg-slate-950/60 px-3 py-2 text-xs font-semibold text-slate-300 outline-none focus:border-brand-500/50"
            >
              {MODULES.map(m => (
                <option key={m} value={m}>
                  {m === "ALL" ? "全部模組" : (MODULE_META[m]?.label ?? m)}
                </option>
              ))}
            </select>
          </div>

          {/* Time range */}
          <div className="flex items-center gap-1.5">
            {TIME_RANGES.map(r => (
              <FilterPill
                key={r.label}
                active={sinceH === r.h}
                onClick={() => setSinceH(r.h)}
              >
                {r.label}
              </FilterPill>
            ))}
          </div>

        </div>
      </section>

      {/* ── Module Stats ──────────────────────────────────────── */}
      {stats && Object.keys(stats.by_module).length > 0 && (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {Object.entries(stats.by_module)
            .sort(([, a], [, b]) => b - a)
            .map(([mod, count]) => {
              const m = getModuleMeta(mod);
              const MIcon = m.icon;
              return (
                <button
                  key={mod}
                  onClick={() => setModule(module === mod ? "ALL" : mod)}
                  className={`rounded-[16px] border px-3 py-2.5 text-left transition-all ${
                    module === mod
                      ? "border-brand-500/40 bg-brand-500/10"
                      : "border-white/8 bg-white/[0.025] hover:bg-white/[0.05]"
                  }`}
                >
                  <MIcon className={`h-3.5 w-3.5 ${m.color} mb-1`} />
                  <p className="text-base font-semibold text-white">{count}</p>
                  <p className="text-[10px] text-slate-500">{m.label}</p>
                </button>
              );
            })}
        </section>
      )}

      {/* ── Log List ─────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold text-white">
            日誌列表
            <span className="ml-2 text-xs font-normal text-slate-500">
              ({logs.length} 筆{loading ? "，更新中…" : ""})
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600">顯示筆數：</span>
            {[100, 200, 500].map(n => (
              <FilterPill key={n} active={limit === n} onClick={() => setLimit(n)}>
                {n}
              </FilterPill>
            ))}
          </div>
        </div>

        {loading && logs.length === 0 ? (
          <div className="panel-soft flex items-center justify-center rounded-[28px] py-20">
            <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
          </div>
        ) : logs.length === 0 ? (
          <div className="panel-soft flex flex-col items-center rounded-[28px] py-16 text-center">
            <Bell className="h-10 w-10 text-slate-600" />
            <p className="mt-4 text-base font-semibold text-white">尚無符合條件的日誌</p>
            <p className="mt-2 text-sm text-slate-500">調整篩選條件，或等待系統產生新事件</p>
          </div>
        ) : (
          <div>
            {/* Column header */}
            <div className="mb-2 flex items-center gap-3 px-4 text-[10px] uppercase tracking-[0.18em] text-slate-600">
              <span className="w-7 flex-shrink-0">等級</span>
              <span className="hidden sm:block w-[90px] flex-shrink-0">模組</span>
              <span className="hidden md:block w-[160px] flex-shrink-0">動作</span>
              <span className="flex-1">訊息</span>
              <span className="hidden lg:block flex-shrink-0 w-[36px] text-right">狀態</span>
              <span className="hidden xl:block flex-shrink-0 w-[56px] text-right">時間</span>
              <span className="flex-shrink-0 w-[72px] text-right">相對</span>
              <span className="w-3.5 flex-shrink-0" />
            </div>
            {logs.map(log => (
              <LogRow key={log.id} log={log} />
            ))}
          </div>
        )}
      </section>

      {/* ── Clear Dialog ─────────────────────────────────────── */}
      {showClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="panel-soft w-full max-w-sm rounded-[28px] p-6">
            <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Purge Logs</p>
                <h2 className="mt-1 text-lg font-semibold text-white">清除過期日誌</h2>
              </div>
              <button onClick={() => setShowClear(false)}
                className="ghost-button h-8 w-8 rounded-xl px-0 text-slate-500">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-5">
              <label className="mb-2 block text-sm text-slate-400">
                清除幾天前的日誌？
              </label>
              <div className="flex gap-2">
                {[7, 14, 30, 60, 90].map(d => (
                  <button
                    key={d}
                    onClick={() => setClearDays(d)}
                    className={`flex-1 rounded-[10px] border py-2 text-xs font-semibold transition-all ${
                      clearDays === d
                        ? "border-red-500/50 bg-red-500/15 text-red-300"
                        : "border-white/10 bg-white/[0.04] text-slate-400 hover:border-white/20"
                    }`}
                  >
                    {d}天
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                將永久刪除 <span className="font-semibold text-red-400">{clearDays} 天前</span>的所有日誌，此操作無法復原。
              </p>
            </div>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setShowClear(false)} className="secondary-button flex-1">取消</button>
              <button
                onClick={handleClear}
                disabled={clearing}
                className="flex-1 rounded-[14px] bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
              >
                {clearing ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "確認清除"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
