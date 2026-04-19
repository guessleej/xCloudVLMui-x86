/**
 * app/api/auth/[...nextauth]/route.ts
 * NextAuth v5 Route Handler
 */
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
