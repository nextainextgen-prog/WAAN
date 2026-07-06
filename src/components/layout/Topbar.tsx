"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, ChevronDown, User as UserIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export function Topbar({ name, role }: { name: string; role: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const initials = name.trim().slice(0, 2);

  return (
    <header className="h-16 shrink-0 border-b border-border bg-surface/80 backdrop-blur-sm flex items-center justify-between px-5 sticky top-0 z-20">
      <div>
        <p className="text-sm text-muted-foreground">มหาวิทยาลัยขอนแก่น · คณะบริหารธุรกิจ</p>
      </div>

      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2.5 h-11 pl-1.5 pr-2.5 rounded-full hover:bg-surface-2 transition-colors cursor-pointer"
        >
          <span className="grid place-items-center h-8 w-8 rounded-full bg-primary-soft text-primary text-xs font-semibold">
            {initials}
          </span>
          <span className="hidden sm:block text-left leading-tight">
            <span className="block text-sm font-medium text-foreground">{name}</span>
            <span className="block text-[11px] text-muted-foreground">{role}</span>
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div
              className={cn(
                "absolute right-0 mt-2 w-52 z-20 bg-surface border border-border rounded-xl shadow-[var(--shadow-lg)] p-1.5",
              )}
            >
              <div className="px-3 py-2 flex items-center gap-2 text-sm text-muted-foreground">
                <UserIcon className="h-4 w-4" aria-hidden />
                บัญชีผู้ใช้
              </div>
              <div className="h-px bg-border my-1" />
              <button
                onClick={logout}
                className="w-full flex items-center gap-2.5 px-3 h-10 rounded-lg text-sm text-danger hover:bg-danger-soft transition-colors cursor-pointer"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                ออกจากระบบ
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
