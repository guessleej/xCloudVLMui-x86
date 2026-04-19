/**
 * types/next-auth.d.ts
 * NextAuth v5 型別擴充 — 加入 provider / providerId / accessToken 欄位
 */

import type { DefaultSession, DefaultJWT } from "next-auth";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    user: {
      provider?:   string;
      providerId?: string;
    } & DefaultSession["user"];
  }

  interface User {
    provider?:   string;
    providerId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    provider?:    string;
    providerId?:  string;
    accessToken?: string;
  }
}
