"use client";

/**
 * app/main/settings/page.tsx — 系統設定頁面
 *
 * 設定生效機制：
 *   儲存 → POST /api/settings → 寫入 SQLite + 即時套用到 in-memory config
 *   不需要重啟後端服務，修改立即對 embedding / RAG 查詢生效。
 */

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Database,
  Info,
  RefreshCw,
  RotateCcw,
  Save,
  ScanLine,
  Server,
  Settings2,
  Sliders,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import { settingsApi } from "@/lib/api";
import type { SystemSettings } from "@/types";

/* ── 預設值（對齊 docker-compose.mac.yml 的實際 env var）────────────── */
const DEFAULT: SystemSettings = {
  ocr_engine:       "vlm",
  embed_model_url:  "",
  embed_model_name: "nomic-embed-text",
  llm_model_url:    "",
  llm_model_name:   "gemma4:e4b",
  chunk_size:       800,
  chunk_overlap:    100,
  rag_top_k:        5,
};

/* ═══════════════════════════════════════════════════════════════════════════
   子元件
════════════════════════════════════════════════════════════════════════════ */

function SectionCard({
  icon: Icon, title, subtitle, eyebrow, badge, children,
}: {
  icon: React.ElementType; title: string; subtitle: string;
  eyebrow: string; badge?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="panel-soft rounded-[30px] p-5 sm:p-6">
      <div className="flex items-start gap-4 border-b border-white/8 pb-5">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-brand-400/20 bg-brand-400/10">
          <Icon className="h-6 w-6 text-brand-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{eyebrow}</p>
            {badge}
          </div>
          <h2 className="mt-1 text-xl font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
        </div>
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-white">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs leading-5 text-slate-500">{hint}</p>}
    </div>
  );
}

function LiveBadge({ value, label }: { value: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
      <span className="h-1 w-1 rounded-full bg-emerald-400" />
      {label ?? "生效中"}: {value}
    </span>
  );
}

const inputCls =
  "w-full rounded-[16px] border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-brand-500/50 focus:ring-2 focus:ring-brand-500/20";

const numInputCls =
  inputCls + " [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

/* ═══════════════════════════════════════════════════════════════════════════
   測試連線結果型別
════════════════════════════════════════════════════════════════════════════ */

type TestResult = { ok: boolean; latency?: number; error?: string } | null;

/* ═══════════════════════════════════════════════════════════════════════════
   主頁面
════════════════════════════════════════════════════════════════════════════ */

export default function SettingsPage() {
  const [settings,  setSettings]  = useState<SystemSettings>(DEFAULT);
  const [saving,    setSaving]    = useState(false);
  const [loading,   setLoading]   = useState(true);
  const [resetting, setReset]     = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [dirty,     setDirty]     = useState(false);

  // 測試連線狀態
  const [embedTest, setEmbedTest] = useState<TestResult>(null);
  const [llmTest,   setLlmTest]   = useState<TestResult>(null);
  const [testingEmbed, setTestingEmbed] = useState(false);
  const [testingLlm,   setTestingLlm]   = useState(false);

  /* ── 載入設定 ──────────────────────────────────────────────────── */
  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await settingsApi.get();
      setSettings(res.data);
      setDirty(false);
    } catch {
      toast.error("載入設定失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  /* ── 儲存設定 ──────────────────────────────────────────────────── */
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await settingsApi.update(settings as unknown as Record<string, unknown>);
      setSettings(res.data);
      setSaved(true);
      setDirty(false);
      toast.success("✅ 設定已儲存並即時套用！");
      setTimeout(() => setSaved(false), 3000);
    } catch {
      toast.error("儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  /* ── 重置設定 ──────────────────────────────────────────────────── */
  const handleReset = async () => {
    setReset(true);
    try {
      const res = await settingsApi.reset();
      setSettings(res.data);
      setDirty(false);
      toast.success("已重置為預設值");
    } catch {
      toast.error("重置失敗");
    } finally {
      setReset(false);
    }
  };

  /* ── 測試 Embedding 連線 ────────────────────────────────────────── */
  const testEmbedding = async () => {
    setTestingEmbed(true);
    setEmbedTest(null);
    const t0 = Date.now();
    try {
      const res = await fetch("/backend-api/api/rag/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "test embedding connection", top_k: 1 }),
        signal: AbortSignal.timeout(10000),
      });
      const latency = Date.now() - t0;
      if (res.ok) {
        setEmbedTest({ ok: true, latency });
      } else {
        const d = await res.json().catch(() => ({}));
        setEmbedTest({ ok: false, error: d.detail ?? `HTTP ${res.status}` });
      }
    } catch (e: any) {
      setEmbedTest({ ok: false, error: e.message ?? "連線逾時" });
    } finally {
      setTestingEmbed(false);
    }
  };

  /* ── 測試 LLM 連線 ──────────────────────────────────────────────── */
  const testLlm = async () => {
    setTestingLlm(true);
    setLlmTest(null);
    const t0 = Date.now();
    try {
      const res = await fetch("/api/vlm/status", { signal: AbortSignal.timeout(8000) });
      const latency = Date.now() - t0;
      if (res.ok) {
        const d = await res.json().catch(() => ({}));
        setLlmTest({ ok: d.llm_ok === true, latency, error: d.llm_ok ? undefined : "LLM 未就緒" });
      } else {
        setLlmTest({ ok: false, error: `HTTP ${res.status}` });
      }
    } catch (e: any) {
      setLlmTest({ ok: false, error: e.message ?? "連線逾時" });
    } finally {
      setTestingLlm(false);
    }
  };

  /* ── 欄位更新（標記 dirty）──────────────────────────────────────── */
  const set = <K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  /* ── Loading ──────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center gap-3">
        <RefreshCw className="h-6 w-6 animate-spin text-brand-400" />
        <span className="text-sm text-slate-400">載入設定中…</span>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════
     Render
  ══════════════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-6">

      {/* ── 頁首 ─────────────────────────────────────────────────── */}
      <section className="panel-grid overflow-hidden rounded-[32px] p-6 sm:p-7 lg:p-8">
        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="section-kicker">System Config</div>
            <h1 className="display-title mt-4 text-3xl leading-tight sm:text-[40px]">系統設定</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              設定 OCR 引擎、向量嵌入模型、語言模型端點與 RAG 推論參數。
              修改後點擊「儲存設定」即時生效，<strong className="text-white">不需重啟服務</strong>。
            </p>
            {dirty && (
              <div className="mt-3 flex items-center gap-2 text-amber-400">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">有未儲存的變更</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={handleReset} disabled={resetting} className="secondary-button">
              {resetting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              重置預設
            </button>
            <button onClick={handleSave} disabled={saving} className="primary-button">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {saving ? "儲存中…" : saved ? "已儲存 ✓" : "儲存設定"}
            </button>
          </div>
        </div>
      </section>

      {/* ── 設定生效說明 ──────────────────────────────────────────── */}
      <div className="flex items-start gap-3 rounded-[20px] border border-sky-500/20 bg-sky-500/8 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-400" />
        <p className="text-xs leading-5 text-sky-300">
          設定儲存後會<strong> 即時套用</strong>到 embedding 和 RAG 服務（修改 in-memory config）。
          重啟 backend 容器後，DB 中的設定值會自動重新載入並覆蓋 env var 預設值。
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">

        {/* ── OCR 引擎設定 ────────────────────────────────────────── */}
        <SectionCard
          icon={ScanLine}
          title="OCR 引擎設定"
          subtitle="設定圖片文字辨識的推論方式"
          eyebrow="OCR Engine"
          badge={<LiveBadge value={settings.ocr_engine} />}
        >
          <Field label="OCR 引擎" hint="vlm：使用本地 Gemma VLM 視覺模型進行 OCR（推薦）；disabled：停用圖片 OCR 功能">
            <div className="flex gap-3">
              {(["vlm", "disabled"] as const).map((engine) => (
                <button
                  key={engine}
                  onClick={() => set("ocr_engine", engine)}
                  className={`flex-1 rounded-[16px] border py-3 text-sm font-semibold transition-colors ${
                    settings.ocr_engine === engine
                      ? "border-brand-500/50 bg-brand-500/20 text-white"
                      : "border-white/10 bg-white/[0.04] text-slate-400 hover:border-white/20 hover:text-white"
                  }`}
                >
                  {engine === "vlm" ? "VLM（Gemma）" : "停用"}
                </button>
              ))}
            </div>
          </Field>
          {settings.ocr_engine === "vlm" && (
            <div className="rounded-[20px] border border-emerald-400/15 bg-emerald-400/8 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-300" />
                <p className="text-xs leading-5 text-slate-400">
                  透過 Ollama 本地推論進行圖片文字辨識，完全離線。
                  上傳圖片時自動呼叫視覺模型提取文字後嵌入知識庫。
                </p>
              </div>
            </div>
          )}
        </SectionCard>

        {/* ── 向量嵌入模型 ────────────────────────────────────────── */}
        <SectionCard
          icon={Zap}
          title="向量嵌入模型"
          subtitle="設定文字向量化的模型（用於知識庫比對）"
          eyebrow="Embedding Model"
          badge={
            embedTest
              ? <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${embedTest.ok ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400" : "border-red-500/25 bg-red-500/10 text-red-400"}`}>
                  {embedTest.ok ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                  {embedTest.ok ? `連線正常 ${embedTest.latency}ms` : embedTest.error}
                </span>
              : undefined
          }
        >
          <Field label="嵌入模型端點 URL" hint="留空使用 docker-compose 設定值（host.docker.internal:11434）">
            <input
              type="text"
              className={inputCls}
              placeholder="留空使用預設（Ollama :11434）"
              value={settings.embed_model_url}
              onChange={(e) => set("embed_model_url", e.target.value)}
            />
          </Field>
          <Field label="嵌入模型名稱" hint="Ollama 中已下載的 embedding 模型名稱，例如 nomic-embed-text、mxbai-embed-large">
            <input
              type="text"
              className={inputCls}
              placeholder="nomic-embed-text"
              value={settings.embed_model_name}
              onChange={(e) => set("embed_model_name", e.target.value)}
            />
          </Field>
          <button
            onClick={testEmbedding}
            disabled={testingEmbed}
            className="secondary-button text-xs"
          >
            {testingEmbed
              ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              : <Activity className="h-3.5 w-3.5" />}
            {testingEmbed ? "測試中…" : "測試 Embedding 連線"}
          </button>
        </SectionCard>

        {/* ── 語言模型設定 ────────────────────────────────────────── */}
        <SectionCard
          icon={Server}
          title="語言模型設定"
          subtitle="設定推論生成的模型（用於 RAG 問答與 VLM 分析）"
          eyebrow="LLM Endpoint"
          badge={
            llmTest
              ? <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${llmTest.ok ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400" : "border-red-500/25 bg-red-500/10 text-red-400"}`}>
                  {llmTest.ok ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                  {llmTest.ok ? `就緒 ${llmTest.latency}ms` : llmTest.error}
                </span>
              : undefined
          }
        >
          <Field label="語言模型端點 URL" hint="留空使用 docker-compose 設定值（host.docker.internal:11434）">
            <input
              type="text"
              className={inputCls}
              placeholder="留空使用預設（Ollama :11434）"
              value={settings.llm_model_url}
              onChange={(e) => set("llm_model_url", e.target.value)}
            />
          </Field>
          <Field label="語言模型名稱" hint="Ollama 中已下載的語言模型名稱，例如 gemma4:e4b、qwen3.5:9b">
            <input
              type="text"
              className={inputCls}
              placeholder="gemma4:e4b"
              value={settings.llm_model_name}
              onChange={(e) => set("llm_model_name", e.target.value)}
            />
          </Field>
          <button
            onClick={testLlm}
            disabled={testingLlm}
            className="secondary-button text-xs"
          >
            {testingLlm
              ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              : <Activity className="h-3.5 w-3.5" />}
            {testingLlm ? "測試中…" : "測試 LLM 連線"}
          </button>
        </SectionCard>

        {/* ── RAG 推論參數 ─────────────────────────────────────────── */}
        <SectionCard
          icon={Sliders}
          title="RAG 推論參數"
          subtitle="調整文件切片與語意搜尋設定"
          eyebrow="RAG Parameters"
        >
          <Field label="切片大小（字元數）" hint="每個文件段落的最大字元數，建議 400–1200">
            <input
              type="number"
              className={numInputCls}
              min={100} max={4000} step={100}
              value={settings.chunk_size}
              onChange={(e) => set("chunk_size", parseInt(e.target.value) || 800)}
            />
          </Field>
          <Field label="切片重疊（字元數）" hint="相鄰段落重疊的字元數，避免語意斷裂，建議 50–200">
            <input
              type="number"
              className={numInputCls}
              min={0} max={500} step={50}
              value={settings.chunk_overlap}
              onChange={(e) => set("chunk_overlap", parseInt(e.target.value) || 100)}
            />
          </Field>
          <Field label="語意搜尋回傳數（Top K）" hint="每次查詢最多回傳的相關段落數，建議 3–10">
            <input
              type="number"
              className={numInputCls}
              min={1} max={20} step={1}
              value={settings.rag_top_k}
              onChange={(e) => set("rag_top_k", parseInt(e.target.value) || 5)}
            />
          </Field>

          {/* 參數預覽 */}
          <div className="rounded-[20px] border border-white/8 bg-slate-950/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">目前參數預覽</p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {[
                { label: "切片大小", value: settings.chunk_size,   unit: "chars" },
                { label: "重疊長度", value: settings.chunk_overlap, unit: "chars" },
                { label: "Top K",   value: settings.rag_top_k,     unit: "段" },
              ].map(({ label, value, unit }) => (
                <div key={label} className="text-center">
                  <p className="font-display text-2xl font-semibold text-white">{value}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">{unit}</p>
                  <p className="text-xs text-slate-400">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ── 目前生效設定摘要 ─────────────────────────────────────────── */}
      <div className="panel-soft rounded-[28px] p-5">
        <div className="flex items-center gap-2 border-b border-white/8 pb-4">
          <Database className="h-4 w-4 text-slate-400" />
          <p className="text-sm font-semibold text-white">目前生效設定</p>
          <span className="ml-auto text-[10px] text-slate-500">儲存後即時更新</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Embed 模型",  value: settings.embed_model_name || "nomic-embed-text" },
            { label: "LLM 模型",    value: settings.llm_model_name   || "gemma4:e4b" },
            { label: "OCR 引擎",    value: settings.ocr_engine },
            { label: "Top K",       value: String(settings.rag_top_k) },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-[16px] border border-white/8 bg-white/[0.02] px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
              <p className="mt-1 truncate text-sm font-semibold text-emerald-300">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── 底部儲存列 ───────────────────────────────────────────────── */}
      <div className="sticky bottom-4 z-20">
        <div className="mx-auto max-w-lg rounded-[24px] border border-white/10 bg-slate-900/90 px-6 py-4 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <p className={`text-sm ${dirty ? "text-amber-400" : "text-slate-400"}`}>
              {dirty ? "⚠ 有未儲存的變更" : "修改後點擊儲存，設定即時套用至後端。"}
            </p>
            <button onClick={handleSave} disabled={saving} className="primary-button whitespace-nowrap">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {saving ? "儲存中…" : saved ? "已儲存 ✓" : "儲存設定"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
