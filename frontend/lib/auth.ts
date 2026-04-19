/**
 * lib/auth.ts
 * NextAuth v5 設定 — Microsoft / Google / GitHub OAuth + 本地管理員帳號
 *
 * 環境變數（.env.local）：
 *   AUTH_SECRET                  ← openssl rand -base64 32
 *   AUTH_MICROSOFT_ENTRA_ID_ID   ← Azure App Registration Client ID
 *   AUTH_MICROSOFT_ENTRA_ID_SECRET
 *   AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
 *   AUTH_GOOGLE_ID               ← Google OAuth Client ID
 *   AUTH_GOOGLE_SECRET
 *   AUTH_GITHUB_ID               ← GitHub OAuth App Client ID
 *   AUTH_GITHUB_SECRET
 *   ADMIN_USERNAME               ← 本地管理員帳號（預設：admin）
 *   ADMIN_PASSWORD               ← 本地管理員密碼（預設：admin123）
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import type { NextAuthConfig } from "next-auth";

export const authConfig: NextAuthConfig = {
  providers: [
    // ── 本地管理員帳號（Credentials）────────────────────────
    Credentials({
      id:   "credentials",
      name: "管理員帳號",
      credentials: {
        username: { label: "帳號", type: "text" },
        password: { label: "密碼", type: "password" },
      },
      async authorize(credentials) {
        const adminUsername = process.env.ADMIN_USERNAME ?? "admin";
        const adminPassword = process.env.ADMIN_PASSWORD ?? "admin123";

        if (
          typeof credentials?.username === "string" &&
          typeof credentials?.password === "string" &&
          credentials.username === adminUsername &&
          credentials.password === adminPassword
        ) {
          return {
            id:    "admin",
            name:  "系統管理員",
            email: "admin@xcloud.local",
            image: null,
          };
        }
        return null;
      },
    }),

    // ── Microsoft (Azure AD / Entra ID) ────────────────────
    MicrosoftEntraID({
      clientId:     process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
      // tenantId 透過 issuer URL 設定（NextAuth v5 MicrosoftEntraID 型別要求）
      issuer: `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID || "common"}/v2.0`,
      authorization: {
        params: {
          scope: "openid profile email User.Read",
        },
      },
    }),

    // ── Google ─────────────────────────────────────────────
    Google({
      clientId:     process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),

    // ── GitHub ─────────────────────────────────────────────
    GitHub({
      clientId:     process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
    }),
  ],

  pages: {
    signIn:  "/auth/login",
    signOut: "/auth/login",
    error:   "/auth/login",
  },

  callbacks: {
    // 將 provider 資訊與 access_token 寫入 JWT
    async jwt({ token, account, user }) {
      if (account) {
        // OAuth providers（Microsoft / Google / GitHub）
        token.provider    = account.provider;
        token.accessToken = account.access_token;
        token.providerId  = account.providerAccountId;
      } else if (user && !token.provider) {
        // Credentials provider — account 為 null，從 user 取資訊
        token.provider    = "credentials";
        token.providerId  = user.id ?? "admin";
        token.accessToken = undefined;
      }
      return token;
    },

    // 將 JWT 中的資訊暴露給前端 session
    async session({ session, token }) {
      if (token) {
        session.user.provider    = token.provider as string;
        session.user.providerId  = token.providerId as string;
        session.accessToken      = token.accessToken as string;
      }
      return session;
    },
  },

  // JWT 工作階段（無需資料庫）
  session: { strategy: "jwt" },

  // 安全設定
  trustHost: true,
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
