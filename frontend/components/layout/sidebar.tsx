"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Cpu,
  DatabaseZap,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  ShieldCheck,
} from "lucide-react";
import { NAV_ITEMS } from "@/lib/navigation";

const SYSTEM_STATUS = [
  { label: "Gemma 4 E4B", meta: "128K Context", tone: "status-pill-ok", icon: Cpu },
  { label: "SEGMA RAG", meta: "手冊 / 工單", tone: "status-pill-warn", icon: DatabaseZap },
  { label: "WebRTC 通道", meta: "現場巡檢", tone: "status-pill-ok", icon: Radar },
];

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export default function Sidebar({
  collapsed = false,
  onToggle,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={`relative z-10 border-b bg-surface/70 backdrop-blur-xl transition-[width,padding] duration-300 lg:min-h-screen lg:border-b-0 lg:border-r ${
        collapsed
          ? "border-white/8 lg:w-[108px] lg:border-white/8"
          : "border-white/8 lg:w-[290px] lg:border-white/8"
      }`}
    >
      <div className="flex h-full flex-col">
        <div className={`border-b border-white/8 px-4 py-4 sm:px-6 lg:py-6 ${collapsed ? "lg:px-3" : "lg:px-6"}`}>
          <div className={`panel-grid overflow-hidden rounded-[28px] ${collapsed ? "px-3 py-4" : "px-5 py-5"}`}>
            <div className={`flex ${collapsed ? "justify-center" : "items-start justify-between gap-3"}`}>
              {!collapsed && <div className="section-kicker">xCloudVLMui</div>}
              <button
                type="button"
                onClick={onToggle}
                className="ghost-button hidden h-10 w-10 rounded-2xl px-0 lg:inline-flex"
                title={collapsed ? "展開側欄" : "收合側欄"}
                aria-label={collapsed ? "展開側欄" : "收合側欄"}
              >
                {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </button>
            </div>

            <div className={`mt-4 flex ${collapsed ? "flex-col items-center gap-3" : "items-start gap-4"}`}>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-400/30 bg-brand-500/15 shadow-[0_0_0_1px_rgba(255,118,22,0.15),0_0_24px_rgba(255,118,22,0.18)]">
                <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
                  <path d="M19.5 4.5L4.5 19.5" stroke="rgba(255,255,255,0.35)" strokeWidth="4.8" strokeLinecap="round" />
                  <path d="M4.5 4.5L12 12" stroke="white" strokeWidth="4.8" strokeLinecap="round" />
                  <path d="M12 12L19.5 19.5" stroke="white" strokeWidth="4.8" strokeLinecap="round" />
                </svg>
              </div>

              {collapsed ? (
                <div className="text-center">
                  <p className="display-title text-sm">xCloud</p>
                  <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-slate-500">
                    VLMui
                  </p>
                </div>
              ) : (
                <div className="min-w-0">
                  <h1 className="display-title text-xl">xCloudVLMui Platform</h1>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={`overflow-x-auto px-3 py-3 sm:px-4 lg:flex-1 lg:overflow-visible lg:py-5 ${collapsed ? "lg:px-3" : "lg:px-4"}`}>
          {!collapsed && (
            <div className="mb-3 hidden items-center justify-between px-3 lg:flex">
              <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                Mission Routes
              </span>
              <span className="text-[11px] text-slate-500">04 Modules</span>
            </div>
          )}

          <nav className={`flex gap-2 ${collapsed ? "lg:flex-col lg:items-center" : "lg:flex-col"}`}>
            {NAV_ITEMS.map(({ href, icon: Icon, label, sublabel, badge }) => {
              const isActive = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  title={collapsed ? label : undefined}
                  aria-label={label}
                  className={`nav-link min-w-[220px] lg:min-w-0 ${
                    collapsed ? "justify-center px-0 py-3 lg:h-[74px] lg:w-[74px]" : ""
                  } ${isActive ? "active" : ""}`}
                >
                  <div className="mt-0.5 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-slate-200">
                    <Icon className="h-5 w-5" />
                  </div>

                  {!collapsed && (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold">{label}</p>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                            {badge}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-500 transition-colors group-hover:text-slate-300">
                          {sublabel}
                        </p>
                      </div>
                      <ChevronRight
                        className={`mt-1 h-4 w-4 flex-shrink-0 transition-all ${
                          isActive
                            ? "text-accent-300"
                            : "text-slate-600 group-hover:translate-x-0.5 group-hover:text-slate-300"
                        }`}
                      />
                    </>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className={`border-t border-white/8 px-4 py-4 sm:px-6 lg:pb-6 ${collapsed ? "lg:px-3" : "lg:px-4"}`}>
          <div className={`panel-soft rounded-[24px] ${collapsed ? "p-3" : "p-4"}`}>
            <div className={`mb-4 flex ${collapsed ? "justify-center" : "items-center justify-between"}`}>
              {collapsed ? (
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10">
                  <ShieldCheck className="h-5 w-5 text-emerald-300" />
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-sm font-semibold text-white">Runtime Mesh</p>
                    <p className="mt-1 text-xs text-slate-400">離線優先 · 邊緣推論</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10">
                    <ShieldCheck className="h-5 w-5 text-emerald-300" />
                  </div>
                </>
              )}
            </div>

            <div className={`space-y-3 ${collapsed ? "flex flex-col items-center space-y-2" : ""}`}>
              {SYSTEM_STATUS.map(({ label, meta, tone, icon: Icon }) => (
                <div
                  key={label}
                  title={collapsed ? `${label} · ${meta}` : undefined}
                  className={`rounded-2xl border border-white/8 bg-white/[0.035] ${
                    collapsed
                      ? "flex w-full items-center justify-center px-0 py-3"
                      : "flex items-center justify-between px-3 py-2.5"
                  }`}
                >
                  {collapsed ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/8 bg-slate-950/40">
                        <Icon className="h-4 w-4 text-slate-200" />
                      </div>
                      <span className={`status-pill ${tone}`}>Ready</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/8 bg-slate-950/40">
                          <Icon className="h-4 w-4 text-slate-200" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">{label}</p>
                          <p className="text-xs text-slate-500">{meta}</p>
                        </div>
                      </div>
                      <span className={`status-pill ${tone}`}>Ready</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={onToggle}
            className="secondary-button mt-3 hidden w-full lg:inline-flex"
          >
            {collapsed ? (
              <>
                <ChevronRight className="h-4 w-4" />
                展開
              </>
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                收合側欄
              </>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}
