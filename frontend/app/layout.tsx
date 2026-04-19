import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import AuthProvider from "@/components/auth/auth-provider";

export const metadata: Metadata = {
  title: "xCloudVLMui",
  description: "由 云碩科技 xCloudinfo Corp.Limited 開發，專為 Advantech AIR-030 (Jetson AGX Orin 64GB) 邊緣主機設計的工廠設備健康管理平台",
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png",      sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png",      sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    shortcut: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="zh-TW" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+TC:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Noto+Sans+TC:wght@300;400;500;700&family=Oxanium:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-surface text-slate-100 antialiased">
        <AuthProvider>
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background:
                  "linear-gradient(180deg, rgba(17, 38, 58, 0.98), rgba(7, 17, 28, 0.98))",
                color: "#f8fbff",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "18px",
                boxShadow: "0 24px 80px rgba(2, 8, 20, 0.45)",
              },
            }}
          />
        </AuthProvider>
      </body>
    </html>
  );
}
