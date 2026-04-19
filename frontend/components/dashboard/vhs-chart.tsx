"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Dot,
} from "recharts";
import { CheckCircle2, Database, Loader2, Plus, X } from "lucide-react";
import { dashboardApi } from "@/lib/api";
import type { VhsDataPoint, VhsTrendMeta } from "@/types";

// ── 每點顏色依來源區分 ─────────────────────────────────────────────────
const SOURCE_DOT: Record<string, { fill: string; r: number }> = {
  vlm:       { fill: "#ff7616", r: 6 },   // 橘 — VLM 推論
  manual:    { fill: "#7c6ff7", r: 5 },   // 紫 — 人工輸入
  seed:      { fill: "#31cfe7", r: 4 },   // 青 — 種子資料
  estimated: { fill: "#4a5568", r: 3 },   // 灰 — 估算
};

const SOURCE_LABEL: Record<string, string> = {
  vlm:       "VLM 推論",
  manual:    "人工輸入",
  seed:      "歷史種子",
  estimated: "估算補充",
};

// ── Tooltip ────────────────────────────────────────────────────────────
function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: VhsDataPoint }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const value  = payload[0].value;
  const point  = payload[0].payload;
  const zone   = value >= 70 ? "穩定區" : value >= 40 ? "警戒區" : "危急區";
  const srcCfg = SOURCE_DOT[point.source] ?? SOURCE_DOT.estimated;
  const srcLbl = SOURCE_LABEL[point.source] ?? "未知";

  return (
    <div className="rounded-[20px] border border-white/10 bg-slate-950/95 px-4 py-3 shadow-panel">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold text-white">{value.toFixed(1)}</p>
      <div className="mt-2 flex items-center gap-2">
        <p className="text-xs text-slate-400">{zone}</p>
        <span className="text-slate-600">·</span>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: srcCfg.fill }}
          />
          <p className="text-xs" style={{ color: srcCfg.fill }}>{srcLbl}</p>
        </div>
      </div>
      {point.reading_count > 0 && (
        <p className="mt-1 text-xs text-slate-600">當日 {point.reading_count} 筆記錄（日均值）</p>
      )}
    </div>
  );
}

// ── 自訂 Dot（依來源顯示不同顏色）─────────────────────────────────────
function CustomDot(props: {
  cx?: number;
  cy?: number;
  payload?: VhsDataPoint;
}) {
  const { cx = 0, cy = 0, payload } = props;
  const cfg = SOURCE_DOT[payload?.source ?? "estimated"] ?? SOURCE_DOT.estimated;
  if (payload?.source === "estimated") return null; // 估算點不顯示 dot
  return <circle cx={cx} cy={cy} r={cfg.r} fill={cfg.fill} stroke="#ffffff" strokeWidth={1.5} />;
}

// ── 記錄 VHS 表單 ─────────────────────────────────────────────────────
function RecordForm({
  equipmentId,
  equipmentName,
  onSuccess,
  onCancel,
}: {
  equipmentId:   string;
  equipmentName: string;
  onSuccess:     () => void;
  onCancel:      () => void;
}) {
  const [score,   setScore]   = useState<number>(75);
  const [notes,   setNotes]   = useState("");
  const [saving,  setSaving]  = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await dashboardApi.recordVhsReading({
        equipment_id: equipmentId,
        score:        score,
        source:       "manual",
        notes:        notes.trim() || undefined,
      });
      setSuccess(true);
      setTimeout(() => {
        onSuccess();
      }, 800);
    } catch {
      /* 讓用戶再試 */
    } finally {
      setSaving(false);
    }
  };

  const scoreColor =
    score >= 70 ? "text-emerald-300" :
    score >= 40 ? "text-amber-300"   : "text-rose-300";

  return (
    <div className="mt-4 rounded-[24px] border border-brand-400/25 bg-brand-400/8 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white">記錄 VHS 分數</p>
        <button onClick={onCancel} className="text-slate-500 hover:text-slate-300">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">{equipmentName} · 人工巡檢輸入</p>

      {/* Score slider */}
      <div className="mt-5">
        <div className="flex items-center justify-between">
          <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Visual Health Score
          </label>
          <span className={`font-display text-3xl font-semibold ${scoreColor}`}>
            {score}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={score}
          onChange={(e) => setScore(parseFloat(e.target.value))}
          className="mt-3 w-full accent-brand-400"
        />
        <div className="mt-1 flex justify-between text-[10px] text-slate-600">
          <span>0 危急</span>
          <span>40 警戒</span>
          <span>70 穩定</span>
          <span>100</span>
        </div>
      </div>

      {/* Notes */}
      <div className="mt-4">
        <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
          備註（選填）
        </label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="例：更換軸承後首次量測"
          className="mt-2 w-full rounded-[16px] border border-white/8 bg-slate-950/40 px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-brand-400/50 focus:ring-0"
        />
      </div>

      {/* Submit */}
      <div className="mt-4 flex gap-3">
        <button
          onClick={handleSubmit}
          disabled={saving || success}
          className="primary-button flex-1 justify-center disabled:cursor-not-allowed disabled:opacity-60"
        >
          {success ? (
            <><CheckCircle2 className="h-4 w-4 text-emerald-300" /> 已記錄</>
          ) : saving ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> 儲存中</>
          ) : (
            "確認記錄"
          )}
        </button>
        <button onClick={onCancel} className="secondary-button">
          取消
        </button>
      </div>
    </div>
  );
}

// ── 主元件 ────────────────────────────────────────────────────────────
interface VhsChartProps {
  meta:          VhsTrendMeta | null;
  equipmentId:   string;
  equipmentName: string;
  onRecorded?:   () => void;
}

export default function VhsChart({
  meta,
  equipmentId,
  equipmentName,
  onRecorded,
}: VhsChartProps) {
  const [showForm, setShowForm] = useState(false);

  const data       = meta?.data ?? [];
  const realDays   = meta?.real_days   ?? 0;
  const estDays    = meta?.estimated_days ?? (meta?.days ?? 14);

  function LegendItem({
    color, label, value,
  }: {
    color: string; label: string; value: string;
  }) {
    return (
      <div className="rounded-2xl border border-white/8 bg-slate-950/35 px-3 py-3">
        <div className="flex items-center justify-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
          <span className="font-medium text-white">{label}</span>
        </div>
        <p className="mt-1 text-slate-500">{value}</p>
      </div>
    );
  }

  return (
    <div className="panel-soft overflow-hidden rounded-[30px] p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="section-kicker">Health Trend</div>
          <h3 className="mt-3 text-xl font-semibold text-white">
            {equipmentName || "尚未選擇設備"}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            過去 14 天的視覺健康分數變化，用於觀察退化速度與維修節奏是否有效。
          </p>

          {/* 資料來源 badge */}
          {meta && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-xl border border-white/8 bg-white/[0.04] px-3 py-1.5">
                <Database className="h-3.5 w-3.5 text-accent-300" />
                <span className="text-xs text-slate-300">
                  {realDays > 0
                    ? `${realDays} 天真實記錄 / ${estDays} 天估算`
                    : "全部為估算資料"}
                </span>
              </div>
              {/* 資料來源圖例 */}
              {[
                { src: "vlm",    label: "VLM 推論" },
                { src: "manual", label: "人工輸入" },
                { src: "seed",   label: "歷史種子" },
              ].map(({ src, label }) => {
                const hasSrc = data.some((d) => d.source === src);
                if (!hasSrc) return null;
                return (
                  <div key={src} className="flex items-center gap-1.5 rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-1.5">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: SOURCE_DOT[src].fill }}
                    />
                    <span className="text-xs text-slate-400">{label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-3">
          <div className="grid grid-cols-3 gap-2 text-center text-xs sm:min-w-[360px]">
            <LegendItem color="bg-emerald-400" label="穩定區" value="70 - 100" />
            <LegendItem color="bg-amber-300"   label="警戒區" value="40 - 69" />
            <LegendItem color="bg-rose-400"    label="危急區" value="0 - 39" />
          </div>

          {/* 記錄 VHS 按鈕 */}
          {equipmentId && !showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="secondary-button"
            >
              <Plus className="h-4 w-4" />
              記錄 VHS 分數
            </button>
          )}
        </div>
      </div>

      {/* 記錄表單 */}
      {showForm && (
        <RecordForm
          equipmentId={equipmentId}
          equipmentName={equipmentName}
          onSuccess={() => {
            setShowForm(false);
            onRecorded?.();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* 圖表 */}
      <div className="mt-6 h-[300px]">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-slate-500">
            <p className="text-sm">請先選擇設備</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="vhsSurface" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#31cfe7" stopOpacity={0.45} />
                  <stop offset="65%"  stopColor="#31cfe7" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="#31cfe7" stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
              <XAxis
                dataKey="timestamp"
                tick={{ fill: "#7d94ac", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: "#7d94ac", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={70} stroke="rgba(63,209,139,0.55)"  strokeDasharray="5 5" />
              <ReferenceLine y={40} stroke="rgba(243,182,78,0.55)"  strokeDasharray="5 5" />
              <Area
                type="monotone"
                dataKey="score"
                stroke="#31cfe7"
                strokeWidth={3}
                fill="url(#vhsSurface)"
                dot={<CustomDot />}
                activeDot={{ r: 5, fill: "#ff7616", stroke: "#ffffff", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
