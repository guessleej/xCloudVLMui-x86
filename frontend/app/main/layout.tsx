import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import AppShell from "@/components/layout/app-shell";

export default async function MainLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/auth/login");

  return (
    <AppShell user={session.user}>{children}</AppShell>
  );
}
