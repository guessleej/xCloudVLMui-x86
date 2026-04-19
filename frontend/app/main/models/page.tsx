"use client";

/**
 * app/main/models/page.tsx — 視覺模型管理頁面
 *
 * 功能：
 *   1. 列出所有 YOLO ONNX 模型（detect / pose / segment / classify / obb）
 *   2. 新增自訂模型登錄
 *   3. 修改模型資訊與備註
 *   4. 啟用/停用模型（每個 task_type 同時只有一個 active）
 *   5. 刪除自訂模型（內建模型不可刪除）
 *   6. 顯示 YOLO 模型輸出格式說明與效能指標
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Edit2,
  Eye,
  EyeOff,
  Info,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import { modelsApi } from "@/lib/api";
import type { TrainedModel, YoloTaskType } from "@/types";

/* ═══════════════════════════════════════════════════════════════════
   常數與工具函式
═══════════════════════════════════════════════════════════════════ */

const TASK_META: Record<string, {
  label: string; labelEn: string; color: string; bg: string; border: string;
  desc:  string; outputDesc: string;
}> = {
  detect:   {
    label: "物件偵測",   labelEn: "Detect",   color: "text-brand-300",
    bg: "bg-brand-500/10",   border: "border-brand-400/25",
    desc:   "偵測影像中的物件並標示邊界框與類別信心度",
    outputDesc: "E2E [1, 300, 6] → [x1,y1,x2,y2, conf, class_id]",
  },
  pose:     {
    label: "姿態估計",   labelEn: "Pose",     color: "text-emerald-300",
    bg: "bg-emerald-500/10", border: "border-emerald-400/25",
    desc:   "偵測人員骨架關鍵點（COCO 17 點），用於 PPE 安全合規判斷",
    outputDesc: "E2E [1, 300, 57] → [bbox×4, conf, cls, kp×17×3]",
  },
  segment:  {
    label: "實例分割",   labelEn: "Segment",  color: "text-purple-300",
    bg: "bg-purple-500/10",  border: "border-purple-400/25",
    desc:   "像素級輪廓識別，區分前景/背景，適用於精確物料計量",
    outputDesc: "E2E [1,300,38] + proto [1,32,160,160]",
  },
  classify: {
    label: "影像分類",   labelEn: "Classify", color: "text-amber-300",
    bg: "bg-amber-500/10",   border: "border-amber-400/25",
    desc:   "對整幀影像進行場景類別判斷，速度最快（5 ms）",
    outputDesc: "[1, num_classes] → Softmax 分數",
  },
  obb:      {
    label: "旋轉框偵測", labelEn: "OBB",      color: "text-rose-300",
    bg: "bg-rose-500/10",    border: "border-rose-400/25",
    desc:   "航拍/俯視場景的旋轉方向感知邊界框，適用於廠區監控",
    outputDesc: "E2E [1, 300, 7] → [bbox×4, conf, cls, angle]",
  },
};

const TASK_ORDER: YoloTaskType[] = ["detect", "pose", "segment", "classify", "obb"];

function formatSize(mb?: number): string {
  if (!mb) return "–";
  return `${mb.toFixed(1)} MB`;
}

function MetricBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-2">
      <span className="text-[10px] uppercase tracking-[0.18em] text-slate-600">{label}</span>
      <span className="mt-1 text-sm font-semibold text-white">{value}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   模型卡片
═══════════════════════════════════════════════════════════════════ */

function ModelCard({
  model,
  onActivate,
  onEdit,
  onDelete,
}: {
  model:      TrainedModel;
  onActivate: (id: string) => void;
  onEdit:     (model: TrainedModel) => void;
  onDelete:   (id: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = TASK_META[model.task_type] ?? TASK_META.detect;

  return (
    <div
      className={`rounded-[26px] border p-5 transition-all ${
        model.is_active
          ? `${meta.border} ${meta.bg}`
          : "border-white/8 bg-white/[0.025]"
      }`}
    >
      {/* ── 頂部列 ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {/* 任務類型圖示 */}
          <div
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border ${meta.border} ${meta.bg}`}
          >
            <Cpu className={`h-5 w-5 ${meta.color}`} />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-white">{model.name}</p>
              {model.is_active && (
                <span className="status-pill status-pill-ok">
                  <CheckCircle2 className="h-3 w-3" />
                  Active
                </span>
              )}
              {model.is_builtin && (
                <span className="table-chip">
                  <Shield className="h-3 w-3" />
                  內建
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${meta.border} ${meta.bg} ${meta.color}`}>
                {meta.label} · {meta.labelEn}
              </span>
              <span className="text-xs text-slate-500">{model.model_filename}</span>
              <span className="text-xs text-slate-600">{formatSize(model.model_size_mb)}</span>
            </div>
          </div>
        </div>

        {/* 操作按鈕 */}
        <div className="flex flex-shrink-0 items-center gap-1">
          {!model.is_active && (
            <button
              onClick={() => onActivate(model.id)}
              className={`ghost-button h-8 rounded-[12px] px-3 text-xs font-semibold ${meta.color} hover:${meta.bg}`}
              title="設為啟用"
            >
              <Eye className="h-3.5 w-3.5" />
              啟用
            </button>
          )}
          <button
            onClick={() => onEdit(model)}
            className="ghost-button h-8 w-8 rounded-[12px] px-0 text-slate-500 hover:text-brand-300"
            title="編輯"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          {!model.is_builtin && (
            <button
              onClick={() => onDelete(model.id, model.name)}
              className="ghost-button h-8 w-8 rounded-[12px] px-0 text-slate-500 hover:text-red-400"
              title="刪除"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="ghost-button h-8 w-8 rounded-[12px] px-0 text-slate-500"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* ── 輸出格式條 ── */}
      <div className="mt-3 rounded-[14px] border border-white/6 bg-slate-950/40 px-4 py-2">
        <p className="font-mono text-[11px] text-slate-400">{meta.outputDesc}</p>
      </div>

      {/* ── 效能指標 ── */}
      {model.metrics && Object.keys(model.metrics).length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {model.metrics.mAP50_95 !== undefined && (
            <MetricBadge label="mAP50-95" value={`${model.metrics.mAP50_95}`} />
          )}
          {model.metrics.mAP50 !== undefined && (
            <MetricBadge label="mAP50" value={`${model.metrics.mAP50}`} />
          )}
          {model.metrics.precision !== undefined && (
            <MetricBadge label="Precision" value={`${model.metrics.precision}%`} />
          )}
          {model.metrics.recall !== undefined && (
            <MetricBadge label="Recall" value={`${model.metrics.recall}%`} />
          )}
          {model.metrics.latency_ms !== undefined && (
            <MetricBadge label="Latency" value={`${model.metrics.latency_ms} ms`} />
          )}
          {model.metrics.params_M !== undefined && (
            <MetricBadge label="Params" value={`${model.metrics.params_M}M`} />
          )}
          {model.metrics.top1_acc !== undefined && (
            <MetricBadge label="Top-1" value={`${model.metrics.top1_acc}%`} />
          )}
          {model.metrics.top5_acc !== undefined && (
            <MetricBadge label="Top-5" value={`${model.metrics.top5_acc}%`} />
          )}
        </div>
      )}

      {/* ── 展開詳情 ── */}
      {expanded && (
        <div className="mt-4 space-y-3 border-t border-white/6 pt-4">
          {model.description && (
            <p className="text-xs leading-5 text-slate-400 whitespace-pre-line">{model.description}</p>
          )}
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div>
              <p className="text-slate-600">輸入尺寸</p>
              <p className="mt-1 font-semibold text-slate-300">{model.input_size}×{model.input_size}</p>
            </div>
            <div>
              <p className="text-slate-600">類別數</p>
              <p className="mt-1 font-semibold text-slate-300">{model.num_classes}</p>
            </div>
            <div>
              <p className="text-slate-600">資料集</p>
              <p className="mt-1 font-semibold text-slate-300">{model.dataset_name ?? "–"}</p>
            </div>
            <div>
              <p className="text-slate-600">來源</p>
              <p className="mt-1 font-semibold text-slate-300">{model.source}</p>
            </div>
          </div>
          {model.output_shape && (
            <div>
              <p className="text-xs text-slate-600">輸出張量</p>
              <p className="mt-1 font-mono text-xs text-slate-300">{model.output_shape}</p>
            </div>
          )}
          {model.class_names && model.class_names.length > 0 && (
            <div>
              <p className="text-xs text-slate-600">
                類別清單（前 30）
              </p>
              <p className="mt-1 text-[11px] text-slate-500 leading-5">
                {model.class_names.slice(0, 30).join(" · ")}
                {model.class_names.length > 30 && ` … +${model.class_names.length - 30} 更多`}
              </p>
            </div>
          )}
          {model.notes && (
            <div className="rounded-[14px] border border-brand-400/15 bg-brand-400/5 px-3 py-2">
              <p className="text-xs text-slate-400">{model.notes}</p>
            </div>
          )}
          <p className="text-[11px] text-slate-600">
            建立：{new Date(model.created_at).toLocaleString("zh-TW")} ·
            更新：{new Date(model.updated_at).toLocaleString("zh-TW")}
          </p>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   新增/編輯 Modal
═══════════════════════════════════════════════════════════════════ */

const EMPTY_FORM = {
  name: "", description: "", task_type: "detect" as YoloTaskType,
  model_filename: "", model_size_mb: "", model_format: "e2e",
  output_shape: "", input_size: "640", num_classes: "80",
  class_names: "", dataset_name: "", is_active: false,
  source: "custom", base_model: "", notes: "",
};

function ModelModal({
  model,
  onClose,
  onSave,
}: {
  model:   TrainedModel | null;
  onClose: () => void;
  onSave:  (payload: Record<string, unknown>, id?: string) => Promise<void>;
}) {
  const isEdit = !!model;
  const [form, setForm] = useState(() =>
    model
      ? {
          name:           model.name,
          description:    model.description ?? "",
          task_type:      model.task_type,
          model_filename: model.model_filename,
          model_size_mb:  String(model.model_size_mb ?? ""),
          model_format:   model.model_format,
          output_shape:   model.output_shape ?? "",
          input_size:     String(model.input_size),
          num_classes:    String(model.num_classes),
          class_names:    (model.class_names ?? []).join(", "),
          dataset_name:   model.dataset_name ?? "",
          is_active:      model.is_active,
          source:         model.source,
          base_model:     model.base_model ?? "",
          notes:          model.notes ?? "",
        }
      : { ...EMPTY_FORM }
  );
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form, v: string | boolean) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.model_filename.trim()) {
      toast.error("名稱與模型檔案名稱為必填");
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      name:           form.name.trim(),
      description:    form.description.trim() || undefined,
      task_type:      form.task_type,
      model_filename: form.model_filename.trim(),
      model_size_mb:  form.model_size_mb ? parseFloat(form.model_size_mb) : undefined,
      model_format:   form.model_format,
      output_shape:   form.output_shape.trim() || undefined,
      input_size:     parseInt(form.input_size) || 640,
      num_classes:    parseInt(form.num_classes) || 80,
      class_names:    form.class_names
        ? form.class_names.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined,
      dataset_name:   form.dataset_name.trim() || undefined,
      is_active:      form.is_active,
      source:         form.source,
      base_model:     form.base_model.trim() || undefined,
      notes:          form.notes.trim() || undefined,
    };
    try {
      await onSave(payload, model?.id);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full rounded-[14px] border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-brand-500/40 focus:outline-none";
  const labelCls = "text-[11px] uppercase tracking-[0.18em] text-slate-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-[32px] border border-white/10 bg-[#0a1020] shadow-2xl overflow-y-auto max-h-[90vh]">
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-white/8 px-6 py-5">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Model Registry</p>
              <h2 className="mt-1 text-lg font-semibold text-white">
                {isEdit ? "編輯模型" : "新增模型登錄"}
              </h2>
            </div>
            <button type="button" onClick={onClose} className="ghost-button h-9 w-9 rounded-[14px] px-0 text-slate-500">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="space-y-5 px-6 py-5">
            {/* 名稱 */}
            <div>
              <label className={labelCls}>模型名稱 *</label>
              <input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="例：YOLO26n Detection v2.0 (工廠微調)"
                className={`${inputCls} mt-1.5`}
                required
              />
            </div>

            {/* 任務類型 + 格式 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>任務類型 *</label>
                <select
                  value={form.task_type}
                  onChange={(e) => set("task_type", e.target.value)}
                  className={`${inputCls} mt-1.5`}
                  disabled={isEdit}
                >
                  {TASK_ORDER.map((t) => (
                    <option key={t} value={t}>{TASK_META[t].label} ({t})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>模型格式</label>
                <select
                  value={form.model_format}
                  onChange={(e) => set("model_format", e.target.value)}
                  className={`${inputCls} mt-1.5`}
                >
                  <option value="e2e">E2E (One-to-One Head, YOLO26)</option>
                  <option value="traditional">Traditional (YOLO11/v8)</option>
                </select>
              </div>
            </div>

            {/* 模型檔案 + 大小 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>模型檔案名稱 * <span className="text-slate-600">(/public/models/)</span></label>
                <input
                  value={form.model_filename}
                  onChange={(e) => set("model_filename", e.target.value)}
                  placeholder="yolo26n-custom.onnx"
                  className={`${inputCls} mt-1.5`}
                  required
                />
              </div>
              <div>
                <label className={labelCls}>模型大小 (MB)</label>
                <input
                  type="number" step="0.1" min="0"
                  value={form.model_size_mb}
                  onChange={(e) => set("model_size_mb", e.target.value)}
                  placeholder="9.4"
                  className={`${inputCls} mt-1.5`}
                />
              </div>
            </div>

            {/* 輸入尺寸 + 類別數 + 輸出張量 */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>輸入尺寸 (px)</label>
                <input
                  type="number" min="32" step="32"
                  value={form.input_size}
                  onChange={(e) => set("input_size", e.target.value)}
                  className={`${inputCls} mt-1.5`}
                />
              </div>
              <div>
                <label className={labelCls}>類別數</label>
                <input
                  type="number" min="1"
                  value={form.num_classes}
                  onChange={(e) => set("num_classes", e.target.value)}
                  className={`${inputCls} mt-1.5`}
                />
              </div>
              <div>
                <label className={labelCls}>輸出張量形狀</label>
                <input
                  value={form.output_shape}
                  onChange={(e) => set("output_shape", e.target.value)}
                  placeholder="[1,300,6]"
                  className={`${inputCls} mt-1.5`}
                />
              </div>
            </div>

            {/* 資料集 + 來源 + 基礎模型 */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>資料集</label>
                <input
                  value={form.dataset_name}
                  onChange={(e) => set("dataset_name", e.target.value)}
                  placeholder="COCO / 自訂"
                  className={`${inputCls} mt-1.5`}
                />
              </div>
              <div>
                <label className={labelCls}>來源</label>
                <select
                  value={form.source}
                  onChange={(e) => set("source", e.target.value)}
                  className={`${inputCls} mt-1.5`}
                >
                  <option value="ultralytics">Ultralytics 官方</option>
                  <option value="fine-tuned">微調（Fine-tuned）</option>
                  <option value="custom">自訂訓練</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>基礎模型</label>
                <input
                  value={form.base_model}
                  onChange={(e) => set("base_model", e.target.value)}
                  placeholder="yolo26n / yolo11n"
                  className={`${inputCls} mt-1.5`}
                />
              </div>
            </div>

            {/* 類別清單 */}
            <div>
              <label className={labelCls}>類別清單（逗號分隔，留空使用 COCO-80）</label>
              <textarea
                value={form.class_names}
                onChange={(e) => set("class_names", e.target.value)}
                rows={2}
                placeholder="person, car, motorcycle, truck, …"
                className={`${inputCls} mt-1.5 resize-none`}
              />
            </div>

            {/* 說明 */}
            <div>
              <label className={labelCls}>模型說明</label>
              <textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                rows={2}
                placeholder="模型用途、訓練資料特殊說明…"
                className={`${inputCls} mt-1.5 resize-none`}
              />
            </div>

            {/* 備註 */}
            <div>
              <label className={labelCls}>備註</label>
              <input
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="選填備註…"
                className={`${inputCls} mt-1.5`}
              />
            </div>

            {/* 立即啟用 */}
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => set("is_active", !form.is_active)}
                className={`relative h-5 w-9 rounded-full transition-colors ${
                  form.is_active ? "bg-brand-600" : "bg-white/15"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    form.is_active ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </div>
              <span className="text-sm text-slate-300">
                立即設為啟用模型
                <span className="ml-1 text-xs text-slate-500">（同任務類型的其他模型將自動停用）</span>
              </span>
            </label>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-white/8 px-6 py-4">
            <button type="button" onClick={onClose} className="secondary-button">取消</button>
            <button type="submit" disabled={saving} className="primary-button">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {saving ? "儲存中…" : isEdit ? "儲存變更" : "新增模型"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   主頁面
═══════════════════════════════════════════════════════════════════ */

export default function ModelsPage() {
  const [models,    setModels]    = useState<TrainedModel[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [filterTask, setFilterTask] = useState<"all" | YoloTaskType>("all");
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<TrainedModel | null>(null);

  /* ── 載入模型列表 ── */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await modelsApi.list();
      setModels(res.data.items);
    } catch {
      toast.error("載入模型列表失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── 啟用模型 ── */
  const handleActivate = async (id: string) => {
    try {
      await modelsApi.activate(id);
      setModels((prev) => {
        const target = prev.find((m) => m.id === id);
        return prev.map((m) =>
          m.task_type === target?.task_type
            ? { ...m, is_active: m.id === id }
            : m
        );
      });
      toast.success("已啟用模型");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "啟用失敗");
    }
  };

  /* ── 儲存（新增/編輯）── */
  const handleSave = async (payload: Record<string, unknown>, id?: string) => {
    try {
      if (id) {
        const res = await modelsApi.update(id, payload);
        setModels((prev) => prev.map((m) => m.id === id ? res.data : m));
        toast.success("模型資訊已更新");
      } else {
        const res = await modelsApi.create(payload);
        setModels((prev) => {
          if (res.data.is_active) {
            return [...prev.map((m) => m.task_type === res.data.task_type ? { ...m, is_active: false } : m), res.data];
          }
          return [...prev, res.data];
        });
        toast.success("模型已登錄");
      }
      setShowModal(false);
      setEditTarget(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "操作失敗");
      throw err;
    }
  };

  /* ── 刪除模型 ── */
  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`確定要刪除「${name}」嗎？此操作無法復原。`)) return;
    try {
      await modelsApi.delete(id);
      setModels((prev) => prev.filter((m) => m.id !== id));
      toast.success("模型已刪除");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "刪除失敗");
    }
  };

  /* ── 過濾 ── */
  const displayed = filterTask === "all"
    ? models
    : models.filter((m) => m.task_type === filterTask);

  /* ── 統計 ── */
  const stats = {
    total:   models.length,
    active:  models.filter((m) => m.is_active).length,
    custom:  models.filter((m) => !m.is_builtin).length,
    tasks:   [...new Set(models.map((m) => m.task_type))].length,
  };

  /* ── 按 task_type 分組（過濾後）── */
  const grouped = TASK_ORDER.reduce((acc, task) => {
    const list = displayed.filter((m) => m.task_type === task);
    if (list.length > 0) acc[task] = list;
    return acc;
  }, {} as Record<string, TrainedModel[]>);

  return (
    <>
      {/* ── Modal ── */}
      {showModal && (
        <ModelModal
          model={editTarget}
          onClose={() => { setShowModal(false); setEditTarget(null); }}
          onSave={handleSave}
        />
      )}

      <div className="space-y-6">
        {/* ── Header ── */}
        <section className="panel-grid overflow-hidden rounded-[32px] p-6 sm:p-7 lg:p-8">
          <div className="relative z-10 grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
            <div>
              <div className="section-kicker">Model Registry</div>
              <h1 className="display-title mt-4 text-3xl leading-tight sm:text-[40px]">
                視覺模型管理
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                登錄並管理所有 YOLO ONNX 推論模型。支援
                <span className="mx-1 text-brand-300">物件偵測</span>·
                <span className="mx-1 text-emerald-300">姿態估計</span>·
                <span className="mx-1 text-purple-300">實例分割</span>·
                <span className="mx-1 text-amber-300">影像分類</span>·
                <span className="mx-1 text-rose-300">旋轉框偵測</span>
                五種任務，每種任務可啟用一個模型供視覺巡檢指揮台動態載入。
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="signal-chip">
                  <Zap className="h-3.5 w-3.5 text-brand-300" />
                  E2E One-to-One Head（YOLO26 內建 NMS）
                </span>
                <span className="signal-chip">
                  <Layers className="h-3.5 w-3.5 text-emerald-300" />
                  ONNX Runtime Web (WASM)
                </span>
                <span className="signal-chip">
                  <Info className="h-3.5 w-3.5 text-slate-400" />
                  Ultralytics YOLO26n / YOLO11n 相容
                </span>
              </div>
            </div>

            {/* 統計 */}
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "已登錄",   value: stats.total,  unit: "個" },
                { label: "已啟用",   value: stats.active, unit: "個" },
                { label: "任務類型", value: stats.tasks,  unit: "種" },
                { label: "自訂模型", value: stats.custom, unit: "個" },
              ].map(({ label, value, unit }) => (
                <div key={label} className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{label}</p>
                  <p className="mt-3 font-display text-3xl font-semibold text-white">
                    {value}
                    <span className="ml-1 text-base font-normal text-slate-400">{unit}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── YOLO 格式說明橫幅 ── */}
        <div className="rounded-[24px] border border-brand-400/20 bg-brand-500/5 p-5">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-300" />
            <div className="space-y-2">
              <p className="text-sm font-semibold text-brand-200">YOLO26 E2E 輸出格式說明（One-to-One Head）</p>
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(TASK_META).map(([task, m]) => (
                  <div key={task} className="flex items-baseline gap-2">
                    <span className={`text-[11px] font-semibold ${m.color}`}>{m.labelEn}</span>
                    <span className="font-mono text-[10px] text-slate-500">{m.outputDesc.split(" → ")[0]}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                E2E 模型內建 NMS，輸出最多 300 個最終偵測結果，信心度為 0 表示未使用 slot。
                YOLO26n 於 COCO val2017 的 mAP50-95 = <strong className="text-white">40.9</strong>。
              </p>
            </div>
          </div>
        </div>

        {/* ── 工具列 ── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* 任務過濾 */}
          <div className="flex flex-wrap items-center gap-1 rounded-[20px] border border-white/8 bg-white/[0.03] p-1">
            {(["all", ...TASK_ORDER] as const).map((t) => {
              const m = t === "all" ? null : TASK_META[t];
              return (
                <button
                  key={t}
                  onClick={() => setFilterTask(t)}
                  className={`rounded-[16px] px-4 py-2 text-xs font-semibold transition-all ${
                    filterTask === t
                      ? "bg-brand-600 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {t === "all" ? "全部" : m?.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className="ghost-button h-9 w-9 rounded-[14px] px-0">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={() => { setEditTarget(null); setShowModal(true); }}
              className="primary-button"
            >
              <Plus className="h-4 w-4" />
              新增模型
            </button>
          </div>
        </div>

        {/* ── 模型列表（按任務分組）── */}
        {loading && models.length === 0 ? (
          <div className="flex items-center justify-center py-24">
            <RefreshCw className="h-7 w-7 animate-spin text-slate-500" />
          </div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[32px] border border-white/8 py-24 text-center">
            <Cpu className="h-12 w-12 text-slate-600" />
            <p className="mt-4 text-sm text-slate-500">尚無符合條件的模型。</p>
          </div>
        ) : (
          <div className="space-y-8">
            {TASK_ORDER.filter((t) => grouped[t]).map((task) => {
              const meta = TASK_META[task];
              return (
                <section key={task}>
                  {/* 任務分組標題 */}
                  <div className="mb-4 flex items-center gap-3">
                    <div className={`h-px flex-1 ${meta.bg} border-t ${meta.border}`} />
                    <div className={`flex items-center gap-2 rounded-full border px-4 py-1.5 ${meta.border} ${meta.bg}`}>
                      <Cpu className={`h-3.5 w-3.5 ${meta.color}`} />
                      <span className={`text-xs font-semibold ${meta.color}`}>
                        {meta.label} · {meta.labelEn}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {grouped[task].length} 個模型
                      </span>
                    </div>
                    <div className={`h-px flex-1 ${meta.bg} border-t ${meta.border}`} />
                  </div>

                  {/* 模型卡片 */}
                  <div className="space-y-3">
                    {grouped[task].map((m) => (
                      <ModelCard
                        key={m.id}
                        model={m}
                        onActivate={handleActivate}
                        onEdit={(target) => { setEditTarget(target); setShowModal(true); }}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
