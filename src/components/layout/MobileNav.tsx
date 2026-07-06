"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, KanbanSquare, CalendarClock, Bot, Upload } from "lucide-react";
import { cn } from "@/lib/cn";

const ITEMS = [
  { href: "/dashboard", label: "ภาพรวม", icon: LayoutDashboard },
  { href: "/grants", label: "ทุนวิจัย", icon: KanbanSquare },
  { href: "/timeline", label: "Deadline", icon: CalendarClock },
  { href: "/secretary", label: "เลขา AI", icon: Bot },
  { href: "/import", label: "นำเข้า", icon: Upload },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-border flex justify-around px-1 pt-1.5 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-col items-center gap-1 py-1.5 px-2 rounded-lg min-w-14 text-[11px] font-medium transition-colors",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
