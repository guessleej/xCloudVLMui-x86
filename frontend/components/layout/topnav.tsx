"use client";

import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import {
  Bell,
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
    <header className="relative z-10 border-b border-white/8 bg-surface/50 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onToggleSidebar}
              className="secondary-button hidden h-11 w-11 rounded-2xl px-0 lg:inline-flex"
              title={sidebarCollapsed ? "展開側欄" : "收合側欄"}
              aria-label={sidebarCollapsed ? "展開側欄" : "收合側欄"}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>

            <div className="section-kicker">{meta.eyebrow}</div>
          </div>

          <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-end lg:gap-4">
            <div className="min-w-0">
              <h2 className="display-title text-2xl sm:text-[30px]">{meta.title}</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
                {meta.description}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="signal-chip">
                <Sparkles className="h-3.5 w-3.5 text-brand-300" />
                Offline First
              </span>
              <span className="signal-chip">
                <Clock3 className="h-3.5 w-3.5 text-accent-300" />
                {now}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
          <div className="panel-soft flex items-center gap-3 rounded-[22px] px-3 py-2.5">
            {user?.image ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={user.image}
                alt={user.name ?? "user"}
                className="h-11 w-11 rounded-2xl border border-white/10 object-cover"
              />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-brand-400/20 bg-brand-500/10 text-sm font-semibold text-white">
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                {user?.name ?? "現場操作員"}
              </p>
              <p className="truncate text-xs text-slate-500">
                {user?.email ?? "本地安全登入"}
              </p>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/auth/login" })}
              className="ghost-button px-3 py-2 text-xs"
              title="登出"
            >
              <LogOut className="h-4 w-4" />
              登出
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
