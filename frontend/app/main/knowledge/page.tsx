"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpenText,
  CheckCircle2,
  Clock,
  Database,
  Edit2,
  FileImage,
  FileText,
  History,
  Layers,
  Loader2,
  MessageSquare,
  RefreshCw,
  ScanLine,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import ChatInterface from "@/components/rag/chat-interface";
import { ragApi, chatHistoryApi } from "@/lib/api";
import type { RagDocument, ChatHistoryItem } from "@/types";

type UploadStatus = "idle" | "uploading" | "ocr" | "embedding" | "done" | "error";
type ActiveTab    = "chat" | "history" | "manage";

interface UploadItem {
  id:       string;
  file:     File;
  status:   UploadStatus;
  progress: number;
  error?:   string;
  result?:  RagDocument;
}

const FILE_ICONS: Record<string, React.ElementType> = {
  pdf:   FileText,
  txt:   FileText,
  md:    FileText,
  csv:   FileText,
  image: FileImage,
};

function formatBytes(bytes?: number): string {
  if (!bytes) return "–";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1)  return "剛剛";
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.floor(min / 60);
  if (hr < 24)  return `${hr} 小時前`;
  const days = Math.floor(hr / 24);
  return `${days} 天前`;
}

function DocCard({ doc, onDelete }: { doc: RagDocument; onDelete: (id: string) => void }) {
  const Icon    = FILE_ICONS[doc.file_type] ?? FileText;
  const isImage = doc.file_type === "image";

  return (
    <div className="rounded-[24px] border border-white/8 bg-white/[0.035] p-4 transition-colors hover:border-white/15 hover:bg-white/[0.05]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border ${
              isImage
                ? "border-purple-400/20 bg-purple-400/10"
                : "border-brand-400/20 bg-brand-400/10"
            }`}
          >
            <Icon className={`h-5 w-5 ${isImage ? "text-purple-300" : "text-brand-300"}`} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{doc.filename}</p>
            <p className="mt-1 text-xs text-slate-500">
              {formatBytes(doc.file_size)} · {new Date(doc.created_at).toLocaleDateString("zh-TW")}
            </p>
          </div>
        </div>
        <button
          onClick={() => onDelete(doc.id)}
          className="ghost-button h-8 w-8 flex-shrink-0 rounded-xl px-0 text-slate-500 hover:text-red-400"
          title="刪除"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="table-chip uppercase">{doc.file_type}</span>
        {doc.embedded ? (
          <span className="status-pill status-pill-ok">
            <CheckCircle2 className="h-3 w-3" />
            已嵌入 {doc.chunk_count} 段
          </span>
        ) : (
          <span className="status-pill status-pill-warn">
            <AlertTriangle className="h-3 w-3" />
            未嵌入
          </span>
        )}
        {isImage && (
          <span className="status-pill bg-purple-400/10 text-purple-300 border-purple-400/20">
            <ScanLine className="h-3 w-3" />
            OCR
          </span>
        )}
      </div>

      {doc.description && (
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-500">{doc.description}</p>
      )}
    </div>
  );
}

/* ── 歷史記錄卡片 ── */
function HistoryCard({
  item,
  onDelete,
  onEditNotes,
}: {
  item:         ChatHistoryItem;
  onDelete:     (id: string) => void;
  onEditNotes:  (id: string, notes: string) => void;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue,   setNotesValue]   = useState(item.notes ?? "");
  const [saving,       setSaving]       = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const handleSaveNotes = async () => {
    setSaving(true);
    try {
      await chatHistoryApi.updateNotes(item.id, notesValue);
      onEditNotes(item.id, notesValue);
      toast.success("備註已儲存");
      setEditingNotes(false);
    } catch {
      toast.error("儲存備註失敗");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-5 transition-colors hover:border-white/12">
      {/* 問題 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-brand-500/20">
            <MessageSquare className="h-3.5 w-3.5 text-brand-300" />
          </div>
          <p className="text-sm font-semibold text-white leading-5">{item.question}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            onClick={() => { setEditingNotes(true); setTimeout(() => textRef.current?.focus(), 50); }}
            className="ghost-button h-7 w-7 rounded-xl px-0 text-slate-500 hover:text-brand-300"
            title="編輯備註"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="ghost-button h-7 w-7 rounded-xl px-0 text-slate-500 hover:text-red-400"
            title="刪除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 回答摘要 */}
      <div className="mt-3 rounded-[16px] border border-white/6 bg-slate-950/40 px-4 py-3">
        <p className="text-xs leading-5 text-slate-400 line-clamp-3">
          {item.answer.replace(/#+\s*/g, "").replace(/\*\*/g, "").trim().slice(0, 280)}
          {item.answer.length > 280 && "…"}
        </p>
      </div>

      {/* 來源 + 時間 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.sources && item.sources.length > 0 && (
          <span className="status-pill bg-emerald-400/10 text-emerald-300 border-emerald-400/20">
            <Database className="h-3 w-3" />
            {item.sources.length} 個來源
          </span>
        )}
        {item.latency_ms && (
          <span className="table-chip">{item.latency_ms} ms</span>
        )}
        <span className="ml-auto flex items-center gap-1 text-[11px] text-slate-600">
          <Clock className="h-3 w-3" />
          {formatRelativeTime(item.created_at)}
        </span>
      </div>

      {/* 備註區 */}
      {editingNotes ? (
        <div className="mt-3 space-y-2">
          <textarea
            ref={textRef}
            value={notesValue}
            onChange={(e) => setNotesValue(e.target.value)}
            placeholder="輸入備註（選填）…"
            rows={2}
            className="w-full rounded-[16px] border border-white/12 bg-slate-950/50 px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-brand-500/40 focus:outline-none resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveNotes}
              disabled={saving}
              className="primary-button text-xs py-1.5"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              儲存
            </button>
            <button
              onClick={() => { setEditingNotes(false); setNotesValue(item.notes ?? ""); }}
              className="ghost-button text-xs py-1.5 px-3 rounded-xl"
            >
              取消
            </button>
          </div>
        </div>
      ) : item.notes ? (
        <div className="mt-3 flex items-start gap-2 rounded-[14px] border border-brand-400/15 bg-brand-400/5 px-3 py-2">
          <Edit2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-brand-400" />
          <p className="text-xs text-slate-400">{item.notes}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   主頁面
═══════════════════════════════════════════════════════ */
export default function KnowledgePage() {
  const [activeTab, setActiveTab]   = useState<ActiveTab>("chat");
  const [docs, setDocs]             = useState<RagDocument[]>([]);
  const [loading, setLoading]       = useState(false);
  const [queue, setQueue]           = useState<UploadItem[]>([]);
  const [dragOver, setDragOver]     = useState(false);
  const [filterType, setFilterType] = useState<"all" | "document" | "image">("all");
  const fileInputRef                = useRef<HTMLInputElement>(null);
  const imgInputRef                 = useRef<HTMLInputElement>(null);

  // 歷史記錄
  const [historyItems,  setHistoryItems]  = useState<ChatHistoryItem[]>([]);
  const [historyTotal,  setHistoryTotal]  = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historySearch, setHistorySearch] = useState("");
  const HISTORY_LIMIT = 20;

  const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"];

  /* ── 文件載入 ── */
  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ragApi.listDocuments();
      setDocs(res.data);
    } catch {
      toast.error("載入知識庫失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  /* ── 歷史記錄載入 ── */
  const loadHistory = useCallback(async (offset = 0, q = "") => {
    setHistoryLoading(true);
    try {
      const res = await chatHistoryApi.list({ limit: HISTORY_LIMIT, offset, q: q || undefined });
      if (offset === 0) {
        setHistoryItems(res.data.items);
      } else {
        setHistoryItems((prev) => [...prev, ...res.data.items]);
      }
      setHistoryTotal(res.data.total);
      setHistoryOffset(offset);
    } catch {
      toast.error("載入歷史記錄失敗");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "history") loadHistory(0, historySearch);
  }, [activeTab, loadHistory]);

  /* ── 搜尋歷史 ── */
  const handleSearchHistory = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    loadHistory(0, historySearch);
  }, [loadHistory, historySearch]);

  /* ── 刪除歷史 ── */
  const handleDeleteHistory = async (id: string) => {
    try {
      await chatHistoryApi.delete(id);
      setHistoryItems((prev) => prev.filter((h) => h.id !== id));
      setHistoryTotal((v) => v - 1);
      toast.success("已刪除該筆記錄");
    } catch {
      toast.error("刪除失敗");
    }
  };

  /* ── 清空全部歷史 ── */
  const handleClearAllHistory = async () => {
    if (!window.confirm("確定要清空所有問答歷史嗎？此操作無法復原。")) return;
    try {
      await chatHistoryApi.clearAll();
      setHistoryItems([]);
      setHistoryTotal(0);
      toast.success("歷史記錄已清空");
    } catch {
      toast.error("清空失敗");
    }
  };

  /* ── 修改備註（樂觀更新）── */
  const handleEditNotes = (id: string, notes: string) => {
    setHistoryItems((prev) =>
      prev.map((h) => h.id === id ? { ...h, notes: notes || undefined } : h)
    );
  };

  /* ── 文件刪除 ── */
  const handleDelete = async (id: string) => {
    try {
      await ragApi.deleteDocument(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
      toast.success("已從知識庫移除");
    } catch {
      toast.error("刪除失敗");
    }
  };

  /* ── 文件上傳 ── */
  const uploadFile = async (file: File) => {
    const ext     = "." + file.name.split(".").pop()?.toLowerCase();
    const isImage = IMAGE_EXTS.includes(ext);

    const item: UploadItem = {
      id:       Math.random().toString(36).slice(2),
      file,
      status:   "uploading",
      progress: 0,
    };
    setQueue((prev) => [item, ...prev]);

    try {
      const form = new FormData();
      form.append("file", file);
      form.append("description", "");

      if (isImage) {
        setQueue((prev) =>
          prev.map((q) => q.id === item.id ? { ...q, status: "ocr", progress: 30 } : q)
        );
        const res = await ragApi.uploadImage(form);
        setQueue((prev) =>
          prev.map((q) => q.id === item.id ? { ...q, status: "done", progress: 100, result: res.data } : q)
        );
        setDocs((prev) => [res.data, ...prev]);
        toast.success(`${file.name} — OCR 完成，已建立索引`);
      } else {
        setQueue((prev) =>
          prev.map((q) => q.id === item.id ? { ...q, status: "embedding", progress: 50 } : q)
        );
        const res = await ragApi.uploadDocument(form);
        setQueue((prev) =>
          prev.map((q) => q.id === item.id ? { ...q, status: "done", progress: 100, result: res.data } : q)
        );
        setDocs((prev) => [res.data, ...prev]);
        toast.success(`${file.name} — 已嵌入 ${res.data.chunk_count} 個段落`);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? "上傳失敗";
      setQueue((prev) =>
        prev.map((q) => q.id === item.id ? { ...q, status: "error", error: msg } : q)
      );
      toast.error(msg);
    }

    setTimeout(() => {
      setQueue((prev) => prev.filter((q) => q.id !== item.id));
    }, 5000);
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(uploadFile);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const filteredDocs = docs.filter((d) => {
    if (filterType === "document") return d.file_type !== "image";
    if (filterType === "image")    return d.file_type === "image";
    return true;
  });

  const stats = {
    total:    docs.length,
    embedded: docs.filter((d) => d.embedded).length,
    chunks:   docs.reduce((acc, d) => acc + d.chunk_count, 0),
    images:   docs.filter((d) => d.file_type === "image").length,
  };

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <section className="panel-grid overflow-hidden rounded-[32px] p-6 sm:p-7 lg:p-8">
        <div className="relative z-10 grid gap-6 xl:grid-cols-[1.25fr_0.9fr]">
          <div>
            <div className="section-kicker">Knowledge Ops</div>
            <h1 className="display-title mt-4 text-3xl leading-tight sm:text-[40px]">
              知識作業台
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              上傳維修手冊、SOP 與現場圖片，透過 OCR 與向量嵌入建立可語意搜尋的知識庫，
              再以 AI 問答方式直接提取診斷依據。問答歷史自動儲存，可隨時查閱、編輯備註或刪除。
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="signal-chip">
                <FileText className="h-3.5 w-3.5 text-brand-300" />
                PDF / TXT / MD / CSV
              </span>
              <span className="signal-chip">
                <FileImage className="h-3.5 w-3.5 text-purple-300" />
                JPG / PNG / WEBP (OCR)
              </span>
              <span className="signal-chip">
                <Layers className="h-3.5 w-3.5 text-emerald-300" />
                ChromaDB 向量索引
              </span>
              <span className="signal-chip">
                <BookOpenText className="h-3.5 w-3.5 text-accent-300" />
                RAG 語意問答
              </span>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "知識文件",   value: stats.total,    unit: "份" },
              { label: "已建立索引", value: stats.embedded, unit: "份" },
              { label: "向量段落",   value: stats.chunks,   unit: "段" },
              { label: "問答歷史",   value: historyTotal,   unit: "筆" },
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

      {/* ── Tab Bar ── */}
      <div className="flex items-center gap-1 rounded-[20px] border border-white/8 bg-white/[0.03] p-1 w-fit">
        <button
          onClick={() => setActiveTab("chat")}
          className={`flex items-center gap-2 rounded-[16px] px-5 py-2.5 text-sm font-semibold transition-all ${
            activeTab === "chat"
              ? "bg-brand-600 text-white shadow-sm"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          知識問答
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-2 rounded-[16px] px-5 py-2.5 text-sm font-semibold transition-all ${
            activeTab === "history"
              ? "bg-brand-600 text-white shadow-sm"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <History className="h-4 w-4" />
          歷史記錄
          {historyTotal > 0 && (
            <span className="ml-1 rounded-full bg-white/15 px-2 py-0.5 text-xs">
              {historyTotal}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("manage")}
          className={`flex items-center gap-2 rounded-[16px] px-5 py-2.5 text-sm font-semibold transition-all ${
            activeTab === "manage"
              ? "bg-brand-600 text-white shadow-sm"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <Settings2 className="h-4 w-4" />
          文件管理
          {docs.length > 0 && (
            <span className="ml-1 rounded-full bg-white/15 px-2 py-0.5 text-xs">
              {docs.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Tab: 知識問答 ── */}
      {activeTab === "chat" && (
        <div className="panel-soft min-h-[820px] overflow-hidden rounded-[32px]">
          <ChatInterface />
        </div>
      )}

      {/* ── Tab: 歷史記錄 ── */}
      {activeTab === "history" && (
        <div className="panel-soft rounded-[32px] p-5 sm:p-6">
          {/* 工具列 */}
          <div className="flex flex-col gap-4 border-b border-white/8 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Chat History</p>
              <h2 className="mt-2 text-xl font-semibold text-white">
                問答歷史
                <span className="ml-2 text-sm font-normal text-slate-500">
                  （共 {historyTotal} 筆）
                </span>
              </h2>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* 搜尋 */}
              <form onSubmit={handleSearchHistory} className="flex items-center gap-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 pointer-events-none" />
                  <input
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="搜尋問題…"
                    className="h-9 w-48 rounded-[14px] border border-white/10 bg-white/[0.04] pl-8 pr-3 text-xs text-white placeholder-slate-600 focus:border-brand-500/40 focus:outline-none"
                  />
                </div>
                <button type="submit" className="secondary-button h-9 text-xs px-3">
                  搜尋
                </button>
              </form>
              {/* 重新整理 */}
              <button
                onClick={() => loadHistory(0, historySearch)}
                disabled={historyLoading}
                className="ghost-button h-9 w-9 rounded-[14px] px-0"
                title="重新整理"
              >
                <RefreshCw className={`h-4 w-4 ${historyLoading ? "animate-spin" : ""}`} />
              </button>
              {/* 清空 */}
              {historyItems.length > 0 && (
                <button
                  onClick={handleClearAllHistory}
                  className="ghost-button h-9 rounded-[14px] px-3 text-xs text-slate-500 hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  清空全部
                </button>
              )}
            </div>
          </div>

          {/* 歷史列表 */}
          <div className="mt-4 space-y-3 overflow-y-auto" style={{ maxHeight: "65vh" }}>
            {historyLoading && historyItems.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw className="h-6 w-6 animate-spin text-slate-500" />
              </div>
            ) : historyItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <History className="h-10 w-10 text-slate-600" />
                <p className="mt-4 text-sm text-slate-500">
                  {historySearch
                    ? "找不到符合的問答記錄。"
                    : "尚無問答歷史，切換至「知識問答」開始提問。"}
                </p>
              </div>
            ) : (
              <>
                {historyItems.map((item) => (
                  <HistoryCard
                    key={item.id}
                    item={item}
                    onDelete={handleDeleteHistory}
                    onEditNotes={handleEditNotes}
                  />
                ))}
                {/* 載入更多 */}
                {historyItems.length < historyTotal && (
                  <button
                    onClick={() => loadHistory(historyOffset + HISTORY_LIMIT, historySearch)}
                    disabled={historyLoading}
                    className="secondary-button w-full justify-center"
                  >
                    {historyLoading
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> 載入中…</>
                      : `載入更多（剩餘 ${historyTotal - historyItems.length} 筆）`
                    }
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: 文件管理 ── */}
      {activeTab === "manage" && (
        <div className="grid gap-6 xl:grid-cols-[1fr_1.5fr]">
          {/* 上傳區 */}
          <div className="space-y-4">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`rounded-[30px] border-2 border-dashed p-8 text-center transition-colors ${
                dragOver
                  ? "border-brand-400/60 bg-brand-400/10"
                  : "border-white/15 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]"
              }`}
            >
              <div className="flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
                  <Upload className="h-7 w-7 text-slate-300" />
                </div>
              </div>
              <p className="mt-4 text-sm font-semibold text-white">拖曳檔案至此上傳</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                支援文件（PDF、TXT、MD、CSV）<br />
                與圖片（JPG、PNG、WEBP）— 圖片自動進行 OCR
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="secondary-button"
                >
                  <FileText className="h-4 w-4" />
                  上傳文件
                </button>
                <button
                  onClick={() => imgInputRef.current?.click()}
                  className="secondary-button"
                >
                  <FileImage className="h-4 w-4" />
                  上傳圖片
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                accept=".pdf,.txt,.md,.csv"
                onChange={(e) => handleFiles(e.target.files)}
              />
              <input
                ref={imgInputRef}
                type="file"
                className="hidden"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.gif,.bmp"
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>

            {/* 上傳進度佇列 */}
            {queue.length > 0 && (
              <div className="panel-soft rounded-[28px] p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                  上傳進度
                </p>
                {queue.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-[20px] border border-white/8 bg-slate-950/30 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-white">{item.file.name}</p>
                      {item.status === "done" ? (
                        <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-300" />
                      ) : item.status === "error" ? (
                        <X className="h-4 w-4 flex-shrink-0 text-red-400" />
                      ) : (
                        <RefreshCw className="h-4 w-4 flex-shrink-0 animate-spin text-brand-300" />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.status === "uploading"  && "上傳中…"}
                      {item.status === "ocr"        && "OCR 文字辨識中（使用 Gemma VLM）…"}
                      {item.status === "embedding"  && "向量嵌入中…"}
                      {item.status === "done"       && `完成 — ${item.result?.chunk_count ?? 0} 個段落`}
                      {item.status === "error"      && (item.error ?? "失敗")}
                    </p>
                    {item.status !== "done" && item.status !== "error" && (
                      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-brand-500 transition-all"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 使用建議 */}
            <div className="panel-soft rounded-[28px] p-5 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                建議作法
              </p>
              {[
                "文件品質影響搜尋精準度，建議使用正式版本手冊或已驗證工單。",
                "圖片 OCR 使用本地 Gemma VLM 推論，圖片越清晰文字辨識率越高。",
                "上傳後切換至「知識問答」頁籤驗證搜尋結果是否符合預期。",
              ].map((tip) => (
                <div
                  key={tip}
                  className="flex items-start gap-3 rounded-[18px] border border-white/8 bg-slate-950/30 px-4 py-3"
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-300" />
                  <p className="text-xs leading-5 text-slate-400">{tip}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 文件列表 */}
          <div className="panel-soft rounded-[32px] p-5 sm:p-6">
            <div className="flex flex-col gap-4 border-b border-white/8 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                  Knowledge Index
                </p>
                <h2 className="mt-2 text-xl font-semibold text-white">
                  知識庫文件
                  <span className="ml-2 text-sm font-normal text-slate-500">({filteredDocs.length})</span>
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex rounded-[16px] border border-white/10 bg-white/[0.04] p-1">
                  {(["all", "document", "image"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setFilterType(t)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                        filterType === t
                          ? "bg-brand-600 text-white"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {t === "all" ? "全部" : t === "document" ? "文件" : "圖片"}
                    </button>
                  ))}
                </div>
                <button
                  onClick={loadDocs}
                  disabled={loading}
                  className="ghost-button h-9 w-9 rounded-[14px] px-0"
                  title="重新整理"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-3 overflow-y-auto" style={{ maxHeight: "60vh" }}>
              {loading && docs.length === 0 ? (
                <div className="flex items-center justify-center py-16">
                  <RefreshCw className="h-6 w-6 animate-spin text-slate-500" />
                </div>
              ) : filteredDocs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Database className="h-10 w-10 text-slate-600" />
                  <p className="mt-4 text-sm text-slate-500">
                    {filterType === "all"
                      ? "知識庫尚無文件，請從左側上傳。"
                      : `尚無${filterType === "image" ? "圖片" : "文件"}類型的知識庫項目。`}
                  </p>
                </div>
              ) : (
                filteredDocs.map((doc) => (
                  <DocCard key={doc.id} doc={doc} onDelete={handleDelete} />
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
