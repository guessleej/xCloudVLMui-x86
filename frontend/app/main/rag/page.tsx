/**
 * /main/rag — 已合併至 /main/knowledge（知識作業台）
 * 此頁面僅做永久重導向，保持舊連結相容性
 */
import { redirect } from "next/navigation";

export default function RagRedirectPage() {
  redirect("/main/knowledge");
}
