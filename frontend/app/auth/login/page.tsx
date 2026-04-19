"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Camera,
  Cpu,
  DatabaseZap,
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
  Workflow,
} from "lucide-react";

interface OAuthButtonProps {
  provider: string;
  label: string;
  icon: ReactNode;
  loading: boolean;
  onClick: () => void;
}

function OAuthButton({ label, icon, loading, onClick }: OAuthButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="group flex w-full items-center gap-3 rounded-[24px] border border-white/10 bg-white/[0.05] px-4 py-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent-400/25 hover:bg-accent-400/10 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/30">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">
          {loading ? "連線中..." : label}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          以企業身分直接進入設備維護平台
        </p>
      </div>
      <ArrowRight className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
    </button>
  );
}

const STACK_ITEMS = [
  { icon: Camera, title: "視覺輸入", detail: "RealSense D455 / 手機 / 筆電鏡頭" },
  { icon: Cpu, title: "邊緣推論", detail: "Gemma 4 E4B + llama.cpp on AIR-030" },
  { icon: DatabaseZap, title: "知識整合", detail: "SEGMA RAG / SOP / 歷史工單" },
  { icon: Workflow, title: "維護輸出", detail: "報告 / LINE / EAM 工單系統" },
];

export default function LoginPage() {
  const router = useRouter();
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleOAuthSignIn = async (provider: string) => {
    setLoadingProvider(provider);
    await signIn(provider, { callbackUrl: "/main/dashboard" });
  };

  const handleAdminSignIn = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!username.trim() || !password.trim()) {
      setAdminError("請輸入帳號與密碼。");
      return;
    }

    setAdminLoading(true);
    setAdminError("");

    try {
      const result = await signIn("credentials", {
        username: username.trim(),
        password,
        redirect: false,
      });

      if (result?.error) {
        setAdminError("帳號或密碼錯誤，請重新確認。");
      } else {
        router.push("/main/dashboard");
      }
    } catch {
      setAdminError("登入失敗，請稍後再試。");
    } finally {
      setAdminLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-10%] top-[-10%] h-[26rem] w-[26rem] rounded-full bg-accent-400/12 blur-3xl" />
        <div className="absolute bottom-[-15%] right-[-8%] h-[30rem] w-[30rem] rounded-full bg-brand-500/12 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto grid min-h-screen max-w-[1680px] gap-8 px-4 py-6 lg:grid-cols-[1.2fr_0.85fr] lg:px-8 lg:py-8">
        <section className="panel-grid flex flex-col justify-between overflow-hidden rounded-[36px] p-6 sm:p-8 lg:p-10">
          <div className="relative z-10">
            <div className="section-kicker">Advantech AIR-030</div>
            <div className="mt-5 flex items-start gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-[24px] border border-brand-400/25 bg-brand-500/12 shadow-[0_0_0_1px_rgba(255,118,22,0.15),0_0_30px_rgba(255,118,22,0.18)]">
                <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8">
                  <path d="M19.5 4.5L4.5 19.5" stroke="rgba(255,255,255,0.35)" strokeWidth="4.8" strokeLinecap="round" />
                  <path d="M4.5 4.5L12 12" stroke="white" strokeWidth="4.8" strokeLinecap="round" />
                  <path d="M12 12L19.5 19.5" stroke="white" strokeWidth="4.8" strokeLinecap="round" />
                </svg>
              </div>
              <div>
                <h1 className="display-title text-4xl leading-tight sm:text-[52px]">
                  xCloudVLMui
                  <br />
                  Platform
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                  由 云碩科技 xCloudinfo Corp.Limited 開發，專為 Advantech AIR-030
                  (Jetson AGX Orin 64GB) 邊緣主機設計的工廠設備健康管理平台，
                  整合視覺 AI、MQTT 感測器與 RAG 知識庫，協助技術人員快速排障與預防維護。
                </p>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-2">
              <span className="signal-chip">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
                完全離線運作
              </span>
              <span className="signal-chip">
                <Cpu className="h-3.5 w-3.5 text-accent-300" />
                128K Context
              </span>
              <span className="signal-chip">
                <Workflow className="h-3.5 w-3.5 text-brand-300" />
                報告 / 工單 / 推播整合
              </span>
            </div>
          </div>

          <div className="relative z-10 mt-8 grid gap-4 md:grid-cols-2">
            {STACK_ITEMS.map(({ icon: Icon, title, detail }) => (
              <div
                key={title}
                className="rounded-[28px] border border-white/10 bg-white/[0.05] p-5"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/30">
                  <Icon className="h-5 w-5 text-accent-200" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-white">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="panel flex flex-col justify-center rounded-[36px] p-6 sm:p-8 lg:p-10">
          <div className="mx-auto w-full max-w-[520px]">
            <div className="section-kicker">Secure Access</div>
            <h2 className="mt-4 text-3xl font-semibold text-white">登入作業控制台</h2>
            <p className="mt-3 text-sm leading-7 text-slate-400">
              使用企業帳號或本地管理員身分登入，開始設備巡檢、知識檢索與維護報告作業。
            </p>

            <div className="mt-8 space-y-3">
              <OAuthButton
                provider="microsoft-entra-id"
                label="使用 Microsoft 帳號登入"
                loading={loadingProvider === "microsoft-entra-id"}
                onClick={() => handleOAuthSignIn("microsoft-entra-id")}
                icon={
                  <svg viewBox="0 0 23 23" className="h-5 w-5">
                    <path fill="#f3f3f3" d="M0 0h23v23H0z" />
                    <path fill="#f35325" d="M1 1h10v10H1z" />
                    <path fill="#81bc06" d="M12 1h10v10H12z" />
                    <path fill="#05a6f0" d="M1 12h10v10H1z" />
                    <path fill="#ffba08" d="M12 12h10v10H12z" />
                  </svg>
                }
              />

              <OAuthButton
                provider="google"
                label="使用 Google 帳號登入"
                loading={loadingProvider === "google"}
                onClick={() => handleOAuthSignIn("google")}
                icon={
                  <svg viewBox="0 0 24 24" className="h-5 w-5">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                }
              />

              <OAuthButton
                provider="github"
                label="使用 GitHub 帳號登入"
                loading={loadingProvider === "github"}
                onClick={() => handleOAuthSignIn("github")}
                icon={
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-white">
                    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                  </svg>
                }
              />
            </div>

            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-xs uppercase tracking-[0.28em] text-slate-500">Local Access</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            {!showAdminForm ? (
              <button
                onClick={() => setShowAdminForm(true)}
                className="group flex w-full items-center gap-3 rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4 transition-all duration-200 hover:border-brand-400/20 hover:bg-brand-500/8"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/30">
                  <LockKeyhole className="h-5 w-5 text-brand-200" />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-sm font-semibold text-white">管理員帳號登入</p>
                  <p className="mt-1 text-xs text-slate-500">
                    適用首次部署、離線環境或受限網段
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
              </button>
            ) : (
              <form onSubmit={handleAdminSignIn} className="space-y-4 rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">管理員帳號登入</p>
                    <p className="mt-1 text-xs text-slate-500">
                      請使用本地管理員帳密存取平台
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAdminForm(false);
                      setAdminError("");
                    }}
                    className="ghost-button px-3 py-2 text-xs"
                  >
                    關閉
                  </button>
                </div>

                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-slate-500">
                    帳號
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="admin"
                    autoComplete="username"
                    disabled={adminLoading}
                    className="w-full rounded-[20px] border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-accent-400/30 focus:outline-none focus:ring-2 focus:ring-accent-400/10"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.22em] text-slate-500">
                    密碼
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      disabled={adminLoading}
                      className="w-full rounded-[20px] border border-white/10 bg-slate-950/40 px-4 py-3 pr-12 text-sm text-white placeholder:text-slate-500 focus:border-accent-400/30 focus:outline-none focus:ring-2 focus:ring-accent-400/10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-white"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {adminError && (
                  <div className="rounded-[20px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                    {adminError}
                  </div>
                )}

                <button type="submit" disabled={adminLoading} className="primary-button w-full">
                  <ShieldCheck className="h-4 w-4" />
                  {adminLoading ? "登入中..." : "進入作業控制台"}
                </button>
              </form>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
