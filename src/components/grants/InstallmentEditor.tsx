"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, CircleCheck, Circle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatBaht, formatBahtShort, daysUntil } from "@/lib/grants";
import { cn } from "@/lib/cn";

export interface Installment {
  id: string;
  seq: number;
  label: string | null;
  amount: number;
  dueDate: string | null;
  receivedAt: string | null;
  receivedAmount: number | null;
  note: string | null;
}

function toDateInput(v: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function todayInput(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function InstallmentEditor({
  grantId,
  grantAmount,
  onChanged,
}: {
  grantId: string;
  grantAmount: number;
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<Installment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/grants/${grantId}/installments`);
    if (res.ok) {
      const data = await res.json();
      setRows(data.installments);
    }
    setLoading(false);
  }, [grantId]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    // อัปเดตหน้าจอทันที แล้วค่อยยิงหลังบ้าน
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...(body as Partial<Installment>) } : r)));
    await fetch(`/api/grants/${grantId}/installments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    onChanged?.();
  }

  async function addRow() {
    setBusy(true);
    const res = await fetch(`/api/grants/${grantId}/installments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 0 }),
    });
    if (res.ok) await load();
    setBusy(false);
    onChanged?.();
  }

  async function split(n: number) {
    setBusy(true);
    const res = await fetch(`/api/grants/${grantId}/installments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ split: n }),
    });
    if (res.ok) await load();
    setBusy(false);
    onChanged?.();
  }

  async function remove(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id));
    await fetch(`/api/grants/${grantId}/installments/${id}`, { method: "DELETE" });
    onChanged?.();
  }

  const planned = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const received = rows
    .filter((r) => r.receivedAt)
    .reduce((s, r) => s + (r.receivedAmount ?? r.amount ?? 0), 0);
  const receivedCount = rows.filter((r) => r.receivedAt).length;
  const pct = planned > 0 ? Math.min(Math.round((received / planned) * 100), 100) : 0;
  const mismatch = rows.length > 0 && Math.abs(planned - grantAmount) >= 1;

  if (loading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">กำลังโหลดงวดเงิน...</p>;
  }

  if (rows.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm font-medium text-foreground">ยังไม่ได้ระบุงวดเงิน</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
          เงินรับจริงใน OKR นับจากงวดที่ติ๊กว่ารับแล้วเท่านั้น ทุนที่ยังไม่ลงงวดจะยังไม่ถูกนับเป็นผลงาน
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 mt-5">
          {[1, 2, 3, 4].map((n) => (
            <Button key={n} variant="outline" size="sm" disabled={busy} onClick={() => split(n)}>
              แบ่ง {n} งวด
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          แบ่งเท่า ๆ กันจากมูลค่าสัญญา {formatBaht(grantAmount)} แล้วแก้ยอดรายงวดได้
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* สรุปหัวตาราง */}
      <div className="rounded-[11px] bg-surface-2 p-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            รับแล้ว {receivedCount} จาก {rows.length} งวด
          </p>
          <p className="text-sm font-semibold text-foreground tnum">
            {formatBahtShort(received)} / {formatBahtShort(planned)} บาท
          </p>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        {mismatch && (
          <p className="flex items-center gap-1.5 text-xs text-warning mt-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            ผลรวมงวด {formatBahtShort(planned)} ไม่ตรงกับมูลค่าสัญญา {formatBahtShort(grantAmount)} บาท
          </p>
        )}
      </div>

      <div className="space-y-2">
        {rows.map((r) => {
          const isReceived = Boolean(r.receivedAt);
          const d = daysUntil(r.dueDate);
          const overdue = !isReceived && d !== null && d < 0;
          return (
            <div
              key={r.id}
              className={cn(
                "rounded-[11px] border p-3",
                isReceived ? "border-accent/40 bg-accent-soft/30" : "border-border bg-surface",
              )}
            >
              <div className="flex items-start gap-2.5">
                <button
                  type="button"
                  aria-label={isReceived ? "ยกเลิกการรับเงิน" : "ติ๊กว่ารับเงินแล้ว"}
                  onClick={() =>
                    patch(r.id, { receivedAt: isReceived ? null : todayInput() })
                  }
                  className={cn(
                    "shrink-0 mt-1 cursor-pointer transition-colors",
                    isReceived ? "text-accent" : "text-muted-foreground hover:text-accent",
                  )}
                >
                  {isReceived ? (
                    <CircleCheck className="h-[18px] w-[18px]" />
                  ) : (
                    <Circle className="h-[18px] w-[18px]" />
                  )}
                </button>

                <div className="flex-1 min-w-0 grid sm:grid-cols-2 gap-2.5">
                  <input
                    value={r.label ?? ""}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs.map((x) => (x.id === r.id ? { ...x, label: e.target.value } : x)),
                      )
                    }
                    onBlur={(e) => patch(r.id, { label: e.target.value })}
                    placeholder={`งวดที่ ${r.seq}`}
                    className="h-9 px-3 rounded-lg bg-surface border border-border text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    value={r.amount || ""}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs.map((x) =>
                          x.id === r.id ? { ...x, amount: Number(e.target.value) } : x,
                        ),
                      )
                    }
                    onBlur={(e) => patch(r.id, { amount: Number(e.target.value) || 0 })}
                    placeholder="ยอดตามสัญญา"
                    className="h-9 px-3 rounded-lg bg-surface border border-border text-sm text-foreground tnum focus:border-primary focus:outline-none"
                  />

                  <label className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground shrink-0 w-16">กำหนดรับ</span>
                    <input
                      type="date"
                      value={toDateInput(r.dueDate)}
                      onChange={(e) => patch(r.id, { dueDate: e.target.value || null })}
                      className={cn(
                        "h-9 flex-1 min-w-0 px-2.5 rounded-lg bg-surface border text-sm focus:border-primary focus:outline-none",
                        overdue ? "border-danger/50 text-danger" : "border-border text-foreground",
                      )}
                    />
                  </label>

                  {isReceived ? (
                    <label className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground shrink-0 w-16">รับจริง</span>
                      <input
                        type="date"
                        value={toDateInput(r.receivedAt)}
                        onChange={(e) => patch(r.id, { receivedAt: e.target.value || null })}
                        className="h-9 flex-1 min-w-0 px-2.5 rounded-lg bg-surface border border-accent/40 text-sm text-foreground focus:border-primary focus:outline-none"
                      />
                    </label>
                  ) : (
                    <div className="flex items-center text-xs">
                      {overdue ? (
                        <span className="flex items-center gap-1.5 text-danger">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          เลยกำหนดรับ {Math.abs(d!)} วัน
                        </span>
                      ) : d !== null ? (
                        <span className="text-muted-foreground">อีก {d} วัน</span>
                      ) : (
                        <span className="text-muted-foreground">ยังไม่ได้รับเงิน</span>
                      )}
                    </div>
                  )}

                  {isReceived && (
                    <label className="flex items-center gap-2 sm:col-span-2">
                      <span className="text-xs text-muted-foreground shrink-0 w-16">ยอดที่เข้า</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={r.receivedAmount ?? ""}
                        onChange={(e) =>
                          setRows((rs) =>
                            rs.map((x) =>
                              x.id === r.id
                                ? {
                                    ...x,
                                    receivedAmount:
                                      e.target.value === "" ? null : Number(e.target.value),
                                  }
                                : x,
                            ),
                          )
                        }
                        onBlur={(e) =>
                          patch(r.id, {
                            receivedAmount: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                        placeholder={`ว่างไว้ = เท่ายอดสัญญา (${formatBahtShort(r.amount)})`}
                        className="h-9 flex-1 min-w-0 px-3 rounded-lg bg-surface border border-border text-sm text-foreground tnum focus:border-primary focus:outline-none"
                      />
                    </label>
                  )}
                </div>

                <button
                  type="button"
                  aria-label="ลบงวดนี้"
                  onClick={() => remove(r.id)}
                  className="shrink-0 grid place-items-center h-8 w-8 rounded-lg text-muted-foreground hover:bg-danger-soft hover:text-danger cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Button variant="outline" size="sm" onClick={addRow} loading={busy} className="w-full">
        <Plus className="h-4 w-4" />
        เพิ่มงวด
      </Button>
    </div>
  );
}
