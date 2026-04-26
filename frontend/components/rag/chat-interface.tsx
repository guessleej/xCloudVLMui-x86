"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpenText,
  Loader2,
  Search,
  Send,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ragApi } from "@/lib/api";
import type { RagMessage } from "@/types";

const SUGGESTED = [
  "壓縮機軸承異音如何排查？",
  "散熱風扇效率下降的清潔 SOP？",
  "液壓密封圈滲油的維修步驟？",
  "VHS 跌破 40 第一線先做什麼？",
  "輸送帶邊緣龜裂工單如何描述？",
  "設備停機前有哪些先期徵兆？",
];

export default function ChatInterface() {
  const [messages, setMessages] = useState<RagMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => `rag-${Date.now()}`);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;

      const userMessage: RagMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: text.trim(),
        created_at: new Date().toISOString(),
      };

      setMessages((current) => [...current, userMessage]);
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      setLoading(true);

      try {
        const response = await ragApi.query({
          question: text.trim(),
          session_id: sessionId,
        });

        const assistantMessage: RagMessage = {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: response.data.answer,
          sources: response.data.sources,
          created_at: new Date().toISOString(),
        };

        setMessages((current) => [...current, assistantMessage]);
      } catch (error: any) {
        const assistantMessage: RagMessage = {
          id: `e-${Date.now()}`,
          role: "assistant",
          content:
            `RAG 服務暫時無法連線。\n\n` +
            `錯誤：${error?.response?.data?.detail ?? error.message}`,
          created_at: new Date().toISOString(),
        };
        setMessages((current) => [...current, assistantMessage]);
      } finally {
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    },
    [loading, sessionId]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex h-full flex-col">

      {/* ── 訊息捲動區 ──────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-5">
        {messages.length === 0 ? (
          /* 空狀態：置中提示 */
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Search className="h-8 w-8 text-slate-600" />
            <p className="text-sm text-slate-500">搜尋維修手冊、SOP 與工單知識庫</p>
            <p className="text-xs text-slate-600">由 Gemma 4 E4B 生成可追溯回答</p>
          </div>
        ) : (
          /* 對話訊息 */
          <div className="space-y-4">
            <div className="flex justify-end">
              <button onClick={() => setMessages([])} className="ghost-button !py-0.5 !text-xs">
                <Trash2 className="h-3.5 w-3.5" />清除
              </button>
            </div>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-2.5 ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}
              >
                <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border ${
                  message.role === "user"
                    ? "border-brand-400/20 bg-brand-500/10"
                    : "border-white/10 bg-slate-950/35"
                }`}>
                  {message.role === "user"
                    ? <User className="h-3.5 w-3.5 text-white" />
                    : <Search className="h-3.5 w-3.5 text-accent-200" />}
                </div>

                <div className={message.role === "user" ? "chat-bubble-user max-w-[86%]" : "chat-bubble-ai max-w-[90%]"}>
                  {message.role === "assistant" ? (
                    <div className="markdown-body text-sm">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm leading-6">{message.content}</p>
                  )}

                  {message.sources && message.sources.length > 0 && (
                    <div className="mt-3 border-t border-white/8 pt-3">
                      <p className="mb-1.5 text-[10px] uppercase tracking-[0.2em] text-slate-500">來源</p>
                      <div className="flex flex-wrap gap-1.5">
                        {message.sources.map((s, i) => (
                          <span key={`${s.filename}-${i}`} className="table-chip">
                            {s.filename}{s.page && ` p.${s.page}`}{s.score !== undefined && ` ${(s.score * 100).toFixed(0)}%`}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex gap-2.5">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-slate-950/35">
                  <Search className="h-3.5 w-3.5 text-accent-200" />
                </div>
                <div className="chat-bubble-ai flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-300" />
                  <span className="text-sm text-slate-300">正在檢索知識庫...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── 建議問題（僅無訊息時顯示）──────────────────── */}
      {messages.length === 0 && (
        <div className="px-4 pb-2 sm:px-5">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {SUGGESTED.map((q) => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                className="rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2 text-left text-[11px] leading-4 text-slate-400 transition-colors hover:border-accent-400/30 hover:bg-accent-400/8 hover:text-slate-200"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 輸入列 ──────────────────────────────────────── */}
      <div className="border-t border-white/8 px-4 py-2.5 sm:px-5">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="輸入設備問題或維修需求，Enter 送出，Shift+Enter 換行…"
            rows={1}
            className="min-h-[44px] max-h-[160px] flex-1 resize-none overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm leading-6 text-slate-100 placeholder:text-slate-500 focus:border-accent-400/30 focus:outline-none focus:ring-2 focus:ring-accent-400/10"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className="primary-button h-11 w-11 shrink-0 rounded-2xl px-0 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-slate-600">
          本地推論 · 資料留在裝置端 · 可在文件管理更新知識來源
        </p>
      </div>
    </div>
  );
}
