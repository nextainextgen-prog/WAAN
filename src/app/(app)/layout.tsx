import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { MobileNav } from "@/components/layout/MobileNav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar name={user.name} role={user.role === "admin" ? "ผู้ดูแลระบบ" : user.role} />
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">{children}</main>
        <MobileNav />
      </div>
    </div>
  );
}
