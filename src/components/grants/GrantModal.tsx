"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Field } from "@/components/ui/Input";
import { GRANT_STATUSES, DEFAULT_PROBABILITY } from "@/lib/grants";
import { fiscalLabel, fiscalYearOptions, fiscalYearOf } from "@/lib/fiscal";
import { InstallmentEditor } from "./InstallmentEditor";
import { GrantHistory } from "./GrantHistory";
import { cn } from "@/lib/cn";

export interface GrantData {
  id?: string;
  projectName: string;
  ownerName: string | null;
  source: string | null;
  amount: number;
  status: string;
  nextDeadline: string | null;
  note: string | null;
  fiscalYear?: number | null;
  probability?: number | null;
  startDate?: string | null;
  endDate?: string | null;
}

function toDateInput(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

type Tab = "info" | "money" | "history";

export function GrantModal({
  open,
  onClose,
  grant,
  defaultStatus,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  grant?: GrantData | null;
  defaultStatus?: string;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const editing = Boolean(grant?.id);
  const [tab, setTab] = useState<Tab>("info");
  const [form, setForm] = useState<GrantData>(
    grant ?? {
      projectName: "",
      ownerName: "",
      source: "",
      amount: 0,
      status: defaultStatus || "submitted",
      nextDeadline: "",
      note: "",
      fiscalYear: fiscalYearOf(),
      probability: null,
      startDate: "",
      endDate: "",
    },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set<K extends keyof GrantData>(k: K, v: GrantData[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    if (!form.projectName.trim()) {
      setError("กรุณาระบุชื่อโครงการ");
      setTab("info");
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      projectName: form.projectName,
      ownerName: form.ownerName,
      source: form.source,
      amount: form.amount,
      status: form.status,
      nextDeadline: form.nextDeadline || null,
      note: form.note,
      fiscalYear: form.fiscalYear ?? fiscalYearOf(),
      probability: form.probability ?? null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
    };
    const res = await fetch(editing ? `/api/grants/${grant!.id}` : "/api/grants", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      setError("บันทึกไม่สำเร็จ");
      return;
    }
    onSaved();
    onClose();
  }

  async function remove() {
    if (!grant?.id) return;
    if (!confirm("ยืนยันการลบทุนนี้? งวดเงินและประวัติจะถูกลบไปด้วย")) return;
    setSaving(true);
    await fetch(`/api/grants/${grant.id}`, { method: "DELETE" });
    setSaving(false);
    onDeleted?.();
    onClose();
  }

  const isPipeline = form.status === "submitted";

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? "แก้ไขข้อมูลทุน" : "เพิ่มทุนวิจัย"}
      footer={
        <>
          {editing && onDeleted && (
            <Button variant="ghost" onClick={remove} className="text-danger hover:bg-danger-soft mr-auto">
              <Trash2 className="h-4 w-4" />
              ลบ
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {tab === "info" ? "ยกเลิก" : "ปิด"}
          </Button>
          <Button variant="primary" onClick={save} loading={saving}>
            {editing ? "บันทึกการแก้ไข" : "เพิ่มทุน"}
          </Button>
        </>
      }
    >
      {editing && (
        <div className="flex items-center gap-1 p-1 rounded-[11px] bg-surface-2 mb-4">
          {(
            [
              ["info", "ข้อมูลทุน"],
              ["money", "งวดเงิน"],
              ["history", "ประวัติ"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "flex-1 h-9 rounded-lg text-sm font-medium transition-colors cursor-pointer",
                tab === key
                  ? "bg-surface text-foreground shadow-[var(--shadow-sm)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === "info" && (
        <div className="space-y-4">
          <Field label="ชื่อโครงการ" htmlFor="pn" required>
            <Input id="pn" value={form.projectName} onChange={(e) => set("projectName", e.target.value)} placeholder="เช่น การพัฒนานวัตกรรมการสอน" />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="อาจารย์เจ้าของทุน" htmlFor="on">
              <Input id="on" value={form.ownerName ?? ""} onChange={(e) => set("ownerName", e.target.value)} placeholder="ชื่อ-สกุล" />
            </Field>
            <Field label="แหล่งทุน" htmlFor="src">
              <Input id="src" value={form.source ?? ""} onChange={(e) => set("source", e.target.value)} placeholder="เช่น สกสว, บพข, งบมหาวิทยาลัย" />
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="มูลค่าทุนตามสัญญา (บาท)" htmlFor="amt">
              <Input id="amt" type="number" inputMode="numeric" value={form.amount || ""} onChange={(e) => set("amount", Number(e.target.value))} placeholder="0" className="tnum" />
            </Field>
            <Field label="สถานะ" htmlFor="st">
              <select
                id="st"
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
                className="h-11 w-full px-3.5 rounded-[11px] bg-surface border border-border-strong text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
              >
                {GRANT_STATUSES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="ปีงบประมาณที่นับผล" htmlFor="fy">
              <select
                id="fy"
                value={form.fiscalYear ?? fiscalYearOf()}
                onChange={(e) => set("fiscalYear", Number(e.target.value))}
                className="h-11 w-full px-3.5 rounded-[11px] bg-surface border border-border-strong text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
              >
                {fiscalYearOptions().map((fy) => (
                  <option key={fy} value={fy}>
                    ปีงบ {fiscalLabel(fy)}
                  </option>
                ))}
              </select>
            </Field>
            {isPipeline && (
              <Field label="โอกาสได้ทุน (%)" htmlFor="prob">
                <Input
                  id="prob"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  value={form.probability ?? ""}
                  onChange={(e) => set("probability", e.target.value === "" ? null : Number(e.target.value))}
                  placeholder={`ว่างไว้ = ${DEFAULT_PROBABILITY}%`}
                  className="tnum"
                />
              </Field>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="วันเริ่มโครงการ" htmlFor="sd">
              <Input id="sd" type="date" value={toDateInput(form.startDate)} onChange={(e) => set("startDate", e.target.value)} />
            </Field>
            <Field label="วันสิ้นสุดโครงการ" htmlFor="ed">
              <Input id="ed" type="date" value={toDateInput(form.endDate)} onChange={(e) => set("endDate", e.target.value)} />
            </Field>
          </div>
          <Field label="วันครบกำหนดงวดถัดไป" htmlFor="dl">
            <Input id="dl" type="date" value={toDateInput(form.nextDeadline)} onChange={(e) => set("nextDeadline", e.target.value)} />
          </Field>
          <Field label="หมายเหตุ" htmlFor="note">
            <Textarea id="note" rows={3} value={form.note ?? ""} onChange={(e) => set("note", e.target.value)} placeholder="รายละเอียดเพิ่มเติม" />
          </Field>
          {!editing && (
            <p className="text-xs text-muted-foreground">
              บันทึกทุนแล้วจึงเปิดแท็บงวดเงินเพื่อลงงวดรับเงินได้
            </p>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}

      {tab === "money" && editing && (
        <InstallmentEditor grantId={grant!.id!} grantAmount={form.amount} onChanged={onSaved} />
      )}

      {tab === "history" && editing && <GrantHistory grantId={grant!.id!} />}
    </Modal>
  );
}
