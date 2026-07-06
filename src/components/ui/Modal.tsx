"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "md" | "lg";
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative w-full bg-surface rounded-t-2xl sm:rounded-2xl shadow-[var(--shadow-lg)] max-h-[92vh] flex flex-col animate-[modalIn_.18s_ease-out]",
          size === "lg" ? "sm:max-w-2xl" : "sm:max-w-md",
        )}
      >
        <div className="flex items-center justify-between px-5 h-14 border-b border-border shrink-0">
          <h3 className="font-display font-semibold text-foreground">{title}</h3>
          <button
            onClick={onClose}
            aria-label="ปิด"
            className="grid place-items-center h-9 w-9 rounded-lg text-muted-foreground hover:bg-surface-2 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-border shrink-0">
            {footer}
          </div>
        )}
      </div>
      <style>{`@keyframes modalIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}
