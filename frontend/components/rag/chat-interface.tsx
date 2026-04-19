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
  "壓縮機軸承異音該如何排查？",
  "散熱風扇效率下降的常見原因與清潔 SOP？",
  "液壓密封圈滲油的標準維修步驟是什麼？",
  "VHS 分數跌破 40 時，第一線要先做哪些事？",
  "輸送帶邊緣龜裂時，預防維護工單應如何描述？",
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
            `錯誤資訊：${error?.response?.data?.detail ?? error.message}\n\n` +
            `請確認後端、向量索引與 llama.cpp 已完成啟動。`,
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/8 px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="section-kicker">RAG Conversation Deck</div>
            <h2 className="mt-3 text-2xl font-semibold text-white">維修問答工作區</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              將維修手冊、SOP 與歷史工單整合為可追溯的回答，協助現場快速決策。
            </p>
          </div>

          {messages.length > 0 && (
            <button onClick={() => setMessages([])} className="ghost-button">
              <Trash2 className="h-4 w-4" />
              清除對話
            </button>
          )}
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col justify-center px-5 py-8 sm:px-6">
          <div className="panel-grid overflow-hidden rounded-[30px] p-6">
            <div className="relative z-10">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent-400/20 bg-accent-400/10">
                <Search className="h-6 w-6 text-accent-200" />
              </div>
              <h3 className="mt-5 text-2xl font-semibold text-white">
                從知識庫萃取可執行的維護答案
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                問題可以直接描述設備異常、老化徵兆、維修步驟或工單內容。我們會先搜尋
                SEGMA RAG，再交由 Gemma 4 E4B 生成可讀、可追溯的回答。
              </p>

              <div className="mt-6 flex flex-wrap gap-2">
                <span className="signal-chip">
                  <BookOpenText className="h-3.5 w-3.5 text-accent-300" />
                  維修手冊
                </span>
                <span className="signal-chip">
                  <Sparkles className="h-3.5 w-3.5 text-brand-300" />
                  SOP / 歷史工單
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-3 lg:grid-cols-2">
            {SUGGESTED.map((question) => (
              <button
                key={question}
                onClick={() => sendMessage(question)}
                className="rounded-[24px] border border-white/8 bg-white/[0.04] px-4 py-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent-400/25 hover:bg-accent-400/10"
              >
                <p className="text-sm leading-6 text-slate-200">{question}</p>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${
                message.role === "user" ? "flex-row-reverse" : "flex-row"
              }`}
            >
              <div
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border ${
                  message.role === "user"
                    ? "border-brand-400/20 bg-brand-500/10"
                    : "border-white/10 bg-slate-950/35"
                }`}
              >
                {message.role === "user" ? (
                  <User className="h-4 w-4 text-white" />
                ) : (
                  <Search className="h-4 w-4 text-accent-200" />
                )}
              </div>

              <div className={message.role === "user" ? "chat-bubble-user max-w-[86%]" : "chat-bubble-ai max-w-[90%]"}>
                {message.role === "assistant" ? (
                  <div className="markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm leading-7">{message.content}</p>
                )}

                {message.sources && message.sources.length > 0 && (
                  <div className="mt-4 border-t border-white/8 pt-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                      參考來源
                    </p>
                    <div className="mt-3 grid gap-2">
                      {message.sources.map((source, index) => (
                        <div
                          key={`${source.filename}-${index}`}
                          className="rounded-[20px] border border-white/8 bg-slate-950/40 px-3 py-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="table-chip">{source.filename}</span>
                            {source.page && <span className="table-chip">p.{source.page}</span>}
                            {source.score !== undefined && (
                              <span className="table-chip">
                                相似度 {(source.score * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/35">
                <Search className="h-4 w-4 text-accent-200" />
              </div>
              <div className="chat-bubble-ai flex items-center gap-3">
                <Loader2 className="h-4 w-4 animate-spin text-brand-300" />
                <span className="text-sm text-slate-300">
                  正在檢索手冊、歷史工單與相關 SOP...
                </span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="border-t border-white/8 px-5 py-5 sm:px-6">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="輸入設備問題、維修需求或工單內容，Enter 送出，Shift + Enter 換行..."
              rows={1}
              className="min-h-[84px] w-full resize-none rounded-[26px] border border-white/10 bg-white/[0.04] px-5 py-4 text-sm leading-7 text-slate-100 placeholder:text-slate-500 focus:border-accent-400/30 focus:outline-none focus:ring-2 focus:ring-accent-400/10"
            />
          </div>
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className="primary-button h-[84px] min-w-[84px] rounded-[26px] px-0"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-3 text-center text-xs text-slate-500">
          本地推論、資料留在裝置端，可搭配文件管理區更新知識來源。
        </p>
      </div>
    </div>
  );
}
