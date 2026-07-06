import * as React from "react";
import { cn } from "@/lib/cn";

type Tone = "primary" | "accent" | "warning" | "neutral";

const toneStyles: Record<Tone, { icon: string }> = {
  primary: { icon: "bg-primary-soft text-primary" },
  accent: { icon: "bg-accent-soft text-accent" },
  warning: { icon: "bg-warning-soft text-warning" },
  neutral: { icon: "bg-surface-2 text-muted-foreground" },
};

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone?: Tone;
}) {
  return (
    <div className="bg-surface border border-border rounded-lg shadow-[var(--shadow-sm)] p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className={cn("grid place-items-center h-9 w-9 rounded-[11px]", toneStyles[tone].icon)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="font-display text-[26px] leading-tight font-semibold text-foreground mt-3 tnum">
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground mt-1.5">{sub}</p>}
    </div>
  );
}
