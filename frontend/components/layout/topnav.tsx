"use client";

import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import {
  Clock3,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
} from "lucide-react";
import { PAGE_META } from "@/lib/navigation";

interface TopNavProps {
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export default function TopNav({
  user,
  sidebarCollapsed = false,
  onToggleSidebar,
}: TopNavProps) {
  const pathname = usePathname();
  const meta = PAGE_META[pathname] ?? {
    title: "xCloudVLMui",
    description: "製造業設備維護戰情中心",
    eyebrow: "Overview",
  };

  const now = new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((segment) => segment[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "XC";

  return (
    <header className="relative z-10 border-b border-white/8 bg-surface/50 px-4 py-2.5 backdrop-blur-xl sm:px-6">
      <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3">
        {/* 左側：側欄切換 + 頁面標題 */}
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/[0.04] text-slate-400 hover:text-white lg:flex"
            title={sidebarCollapsed ? "展開側欄" : "收合側欄"}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>

          <span className="section-kicker shrink-0">{meta.eyebrow}</span>
          <h2 className="truncate text-sm font-semibold text-white">{meta.title}</h2>
          <p className="hidden truncate text-xs text-slate-500 sm:block">{meta.description}</p>
        </div>

        {/* 右側：狀態 + 使用者 */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="signal-chip hidden !py-0.5 !text-[10px] sm:flex">
            <Sparkles className="h-3 w-3 text-brand-300" />
            Offline First
          </span>
          <span className="signal-chip !py-0.5 !text-[10px]">
            <Clock3 className="h-3 w-3 text-accent-300" />
            {now}
          </span>

          <div className="flex items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.03] px-2.5 py-1.5">
            {user?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt={user.name ?? "user"}
                className="h-7 w-7 rounded-xl border border-white/10 object-cover"
              />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-xl border border-brand-400/20 bg-brand-500/10 text-xs font-semibold text-white">
                {initials}
              </div>
            )}
            <span className="hidden max-w-[120px] truncate text-xs font-medium text-white sm:block">
              {user?.name ?? "現場操作員"}
            </span>
            <button
              onClick={() => signOut({ callbackUrl: "/auth/login" })}
              className="ghost-button !px-2 !py-1 !text-[10px]"
              title="登出"
            >
              <LogOut className="h-3 w-3" />
              登出
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
