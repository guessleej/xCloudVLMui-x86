"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/topnav";

const SIDEBAR_STORAGE_KEY = "xcloud:sidebar-collapsed";

interface AppShellProps {
  children: ReactNode;
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

export default function AppShell({ children, user }: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const storedValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (storedValue === "true") {
      setSidebarCollapsed(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      sidebarCollapsed ? "true" : "false"
    );
  }, [sidebarCollapsed]);

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden lg:flex-row">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_top,rgba(49,207,231,0.14),transparent_60%)]" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-brand-500/10 blur-3xl" />
      </div>

      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((current) => !current)}
      />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <TopNav
          user={user}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        />
        <main className="flex-1 overflow-y-auto px-4 pb-6 pt-4 sm:px-6 lg:px-8 lg:pb-8">
          <div className="mx-auto w-full max-w-[1600px] animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
