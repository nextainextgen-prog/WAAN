"use client";

import { useCallback, useMemo, useState } from "react";
import { Plus, CalendarClock, User, Building2, AlertTriangle } from "lucide-react";
import { GRANT_STATUSES, formatBahtShort, formatThaiDate, daysUntil } from "@/lib/grants";
import { Button } from "@/components/ui/Button";
import { GrantModal, type GrantData } from "./GrantModal";
import { cn } from "@/lib/cn";

export interface Grant {
  id: string;
  projectName: string;
  ownerName: string | null;
  source: string | null;
  amount: number;
  status: string;
  nextDeadline: string | null;
  note: string | null;
  orderIndex: number;
}

export function KanbanBoard({ initialGrants }: { initialGrants: Grant[] }) {
  const [grants, setGrants] = useState<Grant[]>(initialGrants);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GrantData | null>(null);
  const [addStatus, setAddStatus] = useState<string>("submitted");

  const columns = useMemo(() => {
    const map: Record<string, Grant[]> = {};
    for (const s of GRANT_STATUSES) map[s.key] = [];
    for (const g of grants) (map[g.status] ??= []).push(g);
    for (const k of Object.keys(map)) map[k].sort((a, b) => a.orderIndex - b.orderIndex);
    return map;
  }, [grants]);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/grants");
    if (res.ok) {
      const data = await res.json();
      setGrants(data.grants);
    }
  }, []);

  async function persistColumn(status: string, ordered: Grant[]) {
    const updates = ordered.map((g, i) => ({ id: g.id, status, orderIndex: i }));
    await fetch("/api/grants/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });
  }

  function onDrop(targetStatus: string) {
    setOverCol(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const moved = grants.find((g) => g.id === id);
    if (!moved || moved.status === targetStatus) {
      // reordering within same column not tracked precisely on drop-to-column; skip if same
      if (moved && moved.status === targetStatus) return;
      return;
    }
    // optimistic: move to end of target column
    const targetItems = columns[targetStatus] ?? [];
    const updated = grants.map((g) =>
      g.id === id ? { ...g, status: targetStatus, orderIndex: targetItems.length } : g,
    );
    setGrants(updated);
    persistColumn(
      targetStatus,
      [...targetItems, { ...moved, status: targetStatus }],
    );
  }

  function openAdd(status: string) {
    setEditing(null);
    setAddStatus(status);
    setModalOpen(true);
  }

  function openEdit(g: Grant) {
    setEditing({
      id: g.id,
      projectName: g.projectName,
      ownerName: g.ownerName,
      source: g.source,
      amount: g.amount,
      status: g.status,
      nextDeadline: g.nextDeadline,
      note: g.note,
    });
    setModalOpen(true);
  }

  const totalCount = grants.length;
  const totalAmount = grants.reduce((s, g) => s + g.amount, 0);

  return (
    <>
      <div className="flex items-center justify-between mb-4 gap-3">
        <p className="text-sm text-muted-foreground">
          ทั้งหมด <span className="font-medium text-foreground tnum">{totalCount}</span> ทุน ·
          มูลค่ารวม <span className="font-medium text-foreground tnum">{formatBahtShort(totalAmount)}</span> บาท
        </p>
        <Button onClick={() => openAdd("submitted")}>
          <Plus className="h-4 w-4" />
          เพิ่มทุน
        </Button>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1 snap-x">
        {GRANT_STATUSES.map((col) => {
          const items = columns[col.key] ?? [];
          const total = items.reduce((s, g) => s + g.amount, 0);
          return (
            <div
              key={col.key}
              onDragOver={(e) => {
                e.preventDefault();
                setOverCol(col.key);
              }}
              onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
              onDrop={() => onDrop(col.key)}
              className={cn(
                "shrink-0 w-[290px] snap-start flex flex-col rounded-2xl bg-surface-2/60 border transition-colors",
                overCol === col.key ? "border-primary/40 bg-primary-soft/40" : "border-transparent",
              )}
            >
              <div className="flex items-center justify-between px-3.5 pt-3.5 pb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", col.dot)} />
                  <span className="text-sm font-semibold text-foreground truncate">{col.label}</span>
                  <span className="text-xs text-muted-foreground tnum">{items.length}</span>
                </div>
                <button
                  onClick={() => openAdd(col.key)}
                  aria-label={`เพิ่มทุนในสถานะ ${col.label}`}
                  className="grid place-items-center h-7 w-7 rounded-lg text-muted-foreground hover:bg-surface hover:text-primary cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <p className="px-3.5 pb-2.5 text-xs text-muted-foreground tnum">
                รวม {formatBahtShort(total)} บาท
              </p>

              <div className="flex-1 space-y-2.5 p-2.5 pt-0 min-h-24">
                {items.map((g) => {
                  const d = daysUntil(g.nextDeadline);
                  const overdue = d !== null && d < 0 && g.status !== "closed";
                  const urgent = d !== null && d >= 0 && d <= 7 && g.status !== "closed";
                  return (
                    <button
                      key={g.id}
                      draggable
                      onDragStart={() => setDragId(g.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverCol(null);
                      }}
                      onClick={() => openEdit(g)}
                      className={cn(
                        "w-full text-left bg-surface border border-border rounded-xl p-3.5 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-card)] hover:border-border-strong transition-all cursor-grab active:cursor-grabbing",
                        dragId === g.id && "opacity-40",
                      )}
                    >
                      <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">
                        {g.projectName}
                      </p>
                      <p className="font-display text-lg font-semibold text-foreground mt-1.5 tnum">
                        {formatBahtShort(g.amount)}
                        <span className="text-xs font-normal text-muted-foreground"> บาท</span>
                      </p>
                      <div className="mt-2.5 space-y-1.5">
                        {g.ownerName && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <User className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{g.ownerName}</span>
                          </div>
                        )}
                        {g.source && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Building2 className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{g.source}</span>
                          </div>
                        )}
                        {g.nextDeadline && (
                          <div
                            className={cn(
                              "flex items-center gap-1.5 text-xs",
                              overdue ? "text-danger" : urgent ? "text-warning" : "text-muted-foreground",
                            )}
                          >
                            {overdue ? (
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            ) : (
                              <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                            )}
                            <span>
                              {formatThaiDate(g.nextDeadline)}
                              {overdue && ` · เลย ${Math.abs(d!)} วัน`}
                              {urgent && ` · อีก ${d} วัน`}
                            </span>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
                {items.length === 0 && (
                  <button
                    onClick={() => openAdd(col.key)}
                    className="w-full border border-dashed border-border-strong rounded-xl py-6 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer"
                  >
                    ลากการ์ดมาที่นี่ หรือกดเพิ่ม
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <GrantModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          grant={editing}
          defaultStatus={addStatus}
          onSaved={refresh}
          onDeleted={refresh}
        />
      )}
    </>
  );
}

export function AddGrantButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button onClick={onOpen}>
      <Plus className="h-4 w-4" />
      เพิ่มทุน
    </Button>
  );
}
