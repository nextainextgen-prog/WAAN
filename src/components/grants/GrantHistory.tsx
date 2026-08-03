"use client";

import { useEffect, useState } from "react";
import { History, ArrowRight, Banknote, FilePlus2, Pencil } from "lucide-react";
import { formatThaiDate } from "@/lib/grants";

interface GrantEventRow {
  id: string;
  createdAt: string;
  kind: string;
  detail: string;
  actor: string | null;
}

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  created: FilePlus2,
  status: ArrowRight,
  installment: Banknote,
  edited: Pencil,
};

export function GrantHistory({ grantId }: { grantId: string }) {
  const [events, setEvents] = useState<GrantEventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/grants/${grantId}/events`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => setEvents(d.events ?? []))
      .finally(() => setLoading(false));
  }, [grantId]);

  if (loading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">กำลังโหลดประวัติ...</p>;
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-10">
        <span className="grid place-items-center h-12 w-12 rounded-2xl bg-surface-2 text-muted-foreground mx-auto">
          <History className="h-6 w-6" />
        </span>
        <p className="text-sm text-muted-foreground mt-3">ยังไม่มีประวัติความเคลื่อนไหว</p>
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {events.map((e) => {
        const Icon = KIND_ICON[e.kind] ?? History;
        return (
          <li key={e.id} className="flex gap-3">
            <span className="grid place-items-center h-8 w-8 shrink-0 rounded-lg bg-surface-2 text-muted-foreground">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm text-foreground leading-snug">{e.detail}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatThaiDate(e.createdAt)}
                {e.actor ? ` · ${e.actor}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
