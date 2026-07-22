import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

// หน้าเว็บฟอร์มคืนเงิน — immersive เต็มจอ (ไม่มี Sidebar/Topbar ของแอป) แต่ยังต้อง login
export default async function RefundLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <div className="min-h-screen bg-background">{children}</div>;
}
