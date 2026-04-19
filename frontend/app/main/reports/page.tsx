"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CalendarClock,
  Download,
  FileText,
  Filter,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";
import { reportsApi } from "@/lib/api";
import type { Report, RiskLevel } from "@/types";

const MOCK_REPORTS: Report[] = [];

const RISK_OPTIONS: Array<{ value: "all" | RiskLevel; label: string; badge: string }> = [
  { value: "all", label: "全部", badge: "table-chip" },
  { value: "critical", label: "危急", badge: "badge-critical" },
  { value: "elevated", label: "升高", badge: "badge-elevated" },
  { value: "moderate", label: "中等", badge: "badge-moderate" },
  { value: "low", label: "低", badge: "badge-low" },
];

const LEVEL_MAP = {
  critical: { label: "危急", badge: "badge-critical" },
  elevated: { label: "升高", badge: "badge-elevated" },
  moderate: { label: "中等", badge: "badge-moderate" },
  low: { label: "低", badge: "badge-low" },
};

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>(MOCK_REPORTS);
  const [selected, setSelected] = useState<Report | null>(MOCK_REPORTS[0]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [riskFilter, setRiskFilter] = useState<"all" | RiskLevel>("all");

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const response = await reportsApi.list();
      const reportData = response.data as Report[];
      setReports(reportData);
      setSelected(
        (current) =>
          reportData.find((item: Report) => item.id === current?.id) ??
          reportData[0] ??
          null
      );
    } catch {
      setReports(MOCK_REPORTS);
      setSelected((current) => current ?? MOCK_REPORTS[0]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const filteredReports = useMemo(() => {
    return reports.filter((report) => {
      const matchesSearch =
        report.title.toLowerCase().includes(search.toLowerCase()) ||
        report.equipment_name?.toLowerCase().includes(search.toLowerCase());
      const matchesRisk = riskFilter === "all" || report.risk_level === riskFilter;
      return matchesSearch && matchesRisk;
    });
  }, [reports, riskFilter, search]);

  useEffect(() => {
    if (!filteredReports.length) {
      setSelected(null);
      return;
    }

    setSelected((current) => filteredReports.find((item) => item.id === current?.id) ?? filteredReports[0]);
  }, [filteredReports]);

  const handleDownload = async (report: Report) => {
    try {
      const blob = new Blob([report.markdown_content ?? ""], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${report.title.replace(/\s+/g, "_")}.md`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("報告已下載為 Markdown。");
    } catch {
      toast.error("下載失敗，請稍後再試。");
    }
  };

  const handleDelete = async (reportId: string) => {
    if (!confirm("確定刪除此報告嗎？")) return;

    try {
      await reportsApi.delete(reportId);
      setReports((current) => current.filter((item) => item.id !== reportId));
      toast.success("報告已刪除。");
    } catch {
      toast.error("刪除失敗，請稍後再試。");
    }
  };

  const criticalCount = reports.filter((report) => report.risk_level === "critical").length;

  return (
    <div className="space-y-6">
      <section className="panel-grid overflow-hidden rounded-[32px] p-6 sm:p-7 lg:p-8">
        <div className="relative z-10 grid gap-6 xl:grid-cols-[1.15fr_0.95fr]">
          <div>
            <div className="section-kicker">Report Workspace</div>
            <h1 className="display-title mt-4 text-3xl leading-tight sm:text-[40px]">
              維護報告工作區
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              將巡檢結果、風險層級與建議行動整理成可下載、可交付的維護文件，便於回報、
              留檔與後續工單串接。
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <TopStat label="報告總數" value={`${reports.length}`} detail="歷史與最新報告" />
            <TopStat label="危急件數" value={`${criticalCount}`} detail="需立即處置" />
            <TopStat
              label="目前篩選"
              value={riskFilter === "all" ? "全部" : LEVEL_MAP[riskFilter].label}
              detail="可依風險檢視"
            />
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.8fr_1.35fr_0.65fr]">
        <div className="panel-soft flex min-h-[860px] flex-col rounded-[30px] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3 border-b border-white/8 pb-5">
            <div>
              <div className="section-kicker">Report Library</div>
              <h2 className="mt-3 text-2xl font-semibold text-white">報告列表</h2>
            </div>
            <button onClick={fetchReports} disabled={loading} className="secondary-button px-3 py-2 text-xs">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              更新
            </button>
          </div>

          <div className="mt-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜尋報告名稱或設備..."
                className="w-full rounded-[22px] border border-white/10 bg-white/[0.04] py-3 pl-11 pr-4 text-sm text-slate-100 placeholder:text-slate-500 focus:border-accent-400/30 focus:outline-none focus:ring-2 focus:ring-accent-400/10"
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {RISK_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setRiskFilter(option.value)}
                  className={`rounded-full border px-3 py-2 text-xs font-medium transition-all ${
                    riskFilter === option.value
                      ? "border-accent-400/25 bg-accent-400/10 text-white"
                      : "border-white/8 bg-white/[0.04] text-slate-400 hover:text-white"
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <Filter className="h-3.5 w-3.5" />
                    {option.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 flex-1 space-y-3 overflow-y-auto pr-1">
            {loading && filteredReports.length === 0 ? (
              <EmptyLibrary title="讀取報告中..." />
            ) : filteredReports.length === 0 ? (
              <EmptyLibrary title="沒有符合條件的報告" />
            ) : (
              filteredReports.map((report) => {
                const level = LEVEL_MAP[report.risk_level] ?? LEVEL_MAP.moderate;
                const isActive = selected?.id === report.id;
                return (
                  <button
                    key={report.id}
                    onClick={() => setSelected(report)}
                    className={`w-full rounded-[24px] border p-4 text-left transition-all ${
                      isActive
                        ? "border-accent-400/25 bg-accent-400/10 shadow-glow"
                        : "border-white/8 bg-white/[0.04] hover:border-white/15 hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={level.badge}>{level.label}</span>
                      <span className="table-chip">{report.source}</span>
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-white">{report.title}</h3>
                    <p className="mt-2 text-sm text-slate-400">
                      {report.equipment_name ?? "未指定設備"}
                    </p>
                    <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {new Date(report.created_at).toLocaleString("zh-TW")}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="panel-soft flex min-h-[860px] flex-col rounded-[30px] p-5 sm:p-6">
          {selected ? (
            <>
              <div className="flex flex-col gap-4 border-b border-white/8 pb-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="section-kicker">Report Preview</div>
                  <h2 className="mt-3 text-2xl font-semibold text-white">{selected.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {selected.equipment_name ?? "未指定設備"} · 建立於{" "}
                    {new Date(selected.created_at).toLocaleString("zh-TW")}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button onClick={() => handleDownload(selected)} className="secondary-button">
                    <Download className="h-4 w-4" />
                    下載 Markdown
                  </button>
                  <button onClick={() => handleDelete(selected.id)} className="ghost-button">
                    <Trash2 className="h-4 w-4" />
                    刪除
                  </button>
                </div>
              </div>

              <div className="mt-5 flex-1 overflow-y-auto rounded-[28px] border border-white/8 bg-slate-950/35 p-5 sm:p-6">
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selected.markdown_content ?? "_此報告無內容_"}
                  </ReactMarkdown>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                <FileText className="h-6 w-6 text-slate-400" />
              </div>
              <h2 className="mt-4 text-xl font-semibold text-white">請選擇一份報告</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">
                你可以從左側報告庫切換不同巡檢結果，檢視內容並下載交付。
              </p>
            </div>
          )}
        </div>

        <div className="panel-soft min-h-[860px] rounded-[30px] p-5 sm:p-6">
          <div className="section-kicker">Inspector</div>
          <h2 className="mt-3 text-2xl font-semibold text-white">報告資訊</h2>

          {selected ? (
            <div className="mt-5 space-y-4">
              <MetaCard label="風險等級" value={LEVEL_MAP[selected.risk_level]?.label ?? selected.risk_level} badge={LEVEL_MAP[selected.risk_level]?.badge} />
              <MetaCard label="資料來源" value={selected.source} />
              <MetaCard label="設備名稱" value={selected.equipment_name ?? "未指定"} />
              <MetaCard label="設備 ID" value={selected.equipment_id ?? "未指定"} />
              <MetaCard
                label="建立時間"
                value={new Date(selected.created_at).toLocaleString("zh-TW")}
              />

              <div className="rounded-[24px] border border-white/8 bg-slate-950/30 p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">交付提示</p>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  若這份報告屬於危急或升高等級，建議同步輸出給 EAM 工單系統與 LINE
                  推播；若屬預防性巡檢，則可納入下次保養排程。
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-[24px] border border-dashed border-white/12 bg-slate-950/20 px-4 py-6">
              <p className="text-sm leading-6 text-slate-400">
                選取報告後，這裡會顯示風險層級、設備資訊與交付建議。
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function TopStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5">
      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className="mt-3 font-display text-3xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p>
    </div>
  );
}

function MetaCard({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-4">
      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{label}</p>
      {badge ? (
        <div className="mt-3">
          <span className={badge}>{value}</span>
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-white">{value}</p>
      )}
    </div>
  );
}

function EmptyLibrary({ title }: { title: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-white/12 bg-slate-950/20 px-4 py-8 text-center text-sm text-slate-400">
      {title}
    </div>
  );
}
