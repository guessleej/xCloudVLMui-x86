/**
 * app/page.tsx — 根路徑：已登入導向 dashboard，否則導向 login
 */
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function RootPage() {
  const session = await auth();
  if (session) {
    redirect("/main/dashboard");
  } else {
    redirect("/auth/login");
  }
}
