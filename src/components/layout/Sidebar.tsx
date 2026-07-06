"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  KanbanSquare,
  CalendarClock,
  Bot,
  Presentation,
  Upload,
  FileStack,
  Settings,
  GraduationCap,
} from "lucide-react";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/dashboard", label: "ภาพรวม OKR", icon: LayoutDashboard },
  { href: "/grants", label: "ทุนวิจัย (Kanban)", icon: KanbanSquare },
  { href: "/timeline", label: "ไทม์ไลน์ / Deadline", icon: CalendarClock },
  { href: "/secretary", label: "เลขา AI", icon: Bot },
  { href: "/slides", label: "สร้างสไลด์", icon: Presentation },
  { href: "/import", label: "นำเข้าข้อมูล", icon: Upload },
  { href: "/documents", label: "เอกสารรออนุมัติ", icon: FileStack },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="h-16 flex items-center gap-2.5 px-5 border-b border-border">
        <span className="grid place-items-center h-9 w-9 rounded-[11px] bg-primary text-primary-foreground">
          <GraduationCap className="h-5 w-5" aria-hidden />
        </span>
        <div className="leading-tight">
          <p className="font-display font-semibold text-[15px] text-foreground">Changoh</p>
          <p className="text-[11px] text-muted-foreground">ระบบบริหารทุนวิจัย</p>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 h-11 rounded-[11px] text-sm font-medium transition-colors",
                active
                  ? "bg-primary-soft text-primary"
                  : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-3 h-11 rounded-[11px] text-sm font-medium transition-colors",
            pathname.startsWith("/settings")
              ? "bg-primary-soft text-primary"
              : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
          )}
        >
          <Settings className="h-[18px] w-[18px]" aria-hidden />
          ตั้งค่า
        </Link>
      </div>
    </aside>
  );
}
