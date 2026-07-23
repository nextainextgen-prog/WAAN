"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2, Wallet, Landmark, Paperclip, SendHorizontal,
  FileText, UploadCloud, X, CheckCircle2, AlertTriangle, Loader2, Info,
  FileStack, RotateCcw, Percent, Check, ClipboardPaste, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Field } from "@/components/ui/Input";
import { bahtText } from "@/lib/baht-text";
import { UPLOAD_SLOTS, type Brand, type DocType, type RefundFormInput } from "@/lib/refund-slots";
import { getPackages, packagePrice, getMonthOptions } from "@/lib/refund-packages";
import { cn } from "@/lib/cn";

const STEPS = [
  { title: "บริษัท & ลูกค้า", sub: "เลือกบริษัทและข้อมูลลูกค้า", icon: Building2 },
  { title: "รายละเอียดเงิน", sub: "ยอดเงินและแพ็กเกจ", icon: Wallet },
  { title: "บัญชีรับเงินคืน", sub: "บัญชีที่จะโอนเงินคืน", icon: Landmark },
  { title: "อัพโหลดเอกสาร", sub: "แนบไฟล์แยกตามประเภท", icon: Paperclip },
  { title: "ตรวจ & ส่ง", sub: "ตรวจแล้วส่งออกเอกสาร", icon: SendHorizontal },
];

type FieldsState = {
  docType: DocType;
  brand: Brand | "";
  user: string; userId: string; companyName: string; serviceLabel: string; reason: string;
  topupDate: string; amount: string; purchaseDate: string; packageName: string; months: string;
  netPrice: string; remainingCredit: string; whtAmount: string; whtDate: string; refund: string;
  bank: string; accountNo: string; accountName: string;
  otherDocLabel: string;
};

const EMPTY: FieldsState = {
  docType: "general",
  brand: "", user: "", userId: "", companyName: "", serviceLabel: "", reason: "",
  topupDate: "", amount: "", purchaseDate: "", packageName: "", months: "",
  netPrice: "", remainingCredit: "", whtAmount: "", whtDate: "", refund: "", bank: "", accountNo: "", accountName: "",
  otherDocLabel: "",
};

const DOC_TYPES: { v: DocType; t: string; d: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { v: "general", t: "คืนเงินทั่วไป", d: "ยกเลิก / ใช้งานไม่ได้", icon: RotateCcw },
  { v: "wht", t: "คืนเงินหัก ณ ที่จ่าย", d: "ขอหักภาษี ณ ที่จ่ายย้อนหลัง", icon: Percent },
];

function num(s: string): number {
  const n = Number(String(s).replace(/[, ]/g, ""));
  return isNaN(n) ? 0 : n;
}

// จัดรูปวันที่ให้ใส่ "/" อัตโนมัติ วว/ดด/ปปปป (ไม่ใส่ / ตอนกำลังลบ เพื่อให้ลบได้)
function autoDate(v: string, deleting: boolean): string {
  const d = v.replace(/\D/g, "").slice(0, 8); // DDMMYYYY
  let out = d.slice(0, 2);
  if (d.length > 2) out += "/" + d.slice(2, 4);
  else if (d.length === 2 && !deleting) out += "/";
  if (d.length > 4) out += "/" + d.slice(4, 8);
  else if (d.length === 4 && !deleting) out += "/";
  return out;
}

type Result = { ok: true } | { ok: false; error: string };

export function RefundWizard() {
  const [f, setF] = useState<FieldsState>(EMPTY);
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [active, setActive] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const [userSug, setUserSug] = useState<string[]>([]);
  const [showUserSug, setShowUserSug] = useState(false);

  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const sugTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = <K extends keyof FieldsState>(k: K, v: FieldsState[K]) => setF((p) => ({ ...p, [k]: v }));

  // ช่องวันที่: ใส่ "/" อัตโนมัติ
  const setDate = (k: "topupDate" | "purchaseDate" | "whtDate") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    set(k, autoDate(next, next.length < f[k].length));
  };

  // ความจำระบบ: พอกรอกยูสเซอร์เสร็จ ถ้าเคยมีข้อมูลเดิม ดึงกลับมาให้ทันที (แล้วให้แอดมินตรวจ)
  async function lookupUser(userArg?: string) {
    const u = (userArg ?? f.user).trim();
    if (!u) return;
    try {
      const res = await fetch(`/api/memo/lookup?user=${encodeURIComponent(u)}`);
      const data = await res.json();
      if (data.found && data.contact) {
        const c = data.contact;
        setF((p) => ({
          ...p,
          brand: c.brand === "easyslip" || c.brand === "thunder" ? c.brand : p.brand,
          userId: c.userId || p.userId,
          companyName: c.companyName || p.companyName,
          serviceLabel: c.serviceLabel || p.serviceLabel,
          packageName: c.packageName || p.packageName,
          bank: c.bank || p.bank,
          accountNo: c.accountNo || p.accountNo,
          accountName: c.accountName || p.accountName,
        }));
        setPrefilled(true);
      } else {
        setPrefilled(false);
      }
    } catch {
      /* เงียบไว้ — แค่ช่วยเติมให้ */
    }
  }

  // พิมพ์ยูสเซอร์ → เด้งรายชื่อยูสเซอร์เดิมที่ตรงคำค้น (autocomplete)
  const onUserInput = (v: string) => {
    set("user", v);
    if (sugTimer.current) clearTimeout(sugTimer.current);
    if (!v.trim()) {
      setUserSug([]);
      setShowUserSug(false);
      return;
    }
    sugTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/memo/lookup?q=${encodeURIComponent(v.trim())}`);
        const d = await r.json();
        setUserSug(d.users || []);
        setShowUserSug((d.users || []).length > 0);
      } catch {
        /* ignore */
      }
    }, 180);
  };
  const pickUser = (u: string) => {
    set("user", u);
    setUserSug([]);
    setShowUserSug(false);
    lookupUser(u);
  };

  // scroll-spy: ไฮไลต์ขั้นตอนตามตำแหน่งที่เลื่อนถึง (ไม่มีปุ่มถัดไป)
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
        });
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 },
    );
    sectionRefs.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const goStep = (i: number) =>
    sectionRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });

  const refundText = useMemo(() => (num(f.refund) > 0 ? bahtText(num(f.refund)) : ""), [f.refund]);
  const totalFiles = useMemo(() => Object.values(files).reduce((a, b) => a + b.length, 0), [files]);
  // แพ็กเกจตามแบรนด์+บริการ (มีดรอปดาว = Thunder BOT) · เลือกแล้วคำนวณราคาอัตโนมัติตามจำนวนเดือน
  const pkgs = useMemo(() => getPackages(f.brand || "", f.serviceLabel), [f.brand, f.serviceLabel]);
  const monthOpts = useMemo(() => getMonthOptions(f.serviceLabel), [f.serviceLabel]);

  // เปลี่ยนประเภทบริการ (BOT/API) → รีเซ็ตแพ็กเกจ/เดือน/ราคา (เพราะรายการ+ตัวเลือกต่างกัน)
  const selectService = (v: "BOT" | "API") => {
    const nv = f.serviceLabel === v ? "" : v;
    setF((p) => ({ ...p, serviceLabel: nv, packageName: "", months: "", netPrice: "" }));
  };
  const selectPackage = (name: string) => {
    set("packageName", name);
    const pkg = pkgs.find((x) => x.name === name);
    const mo = num(f.months);
    if (pkg && mo > 0) set("netPrice", String(packagePrice(pkg, mo)));
  };
  const selectMonths = (m: string) => {
    const nm = f.months === m ? "" : m;
    set("months", nm);
    const pkg = pkgs.find((x) => x.name === f.packageName);
    if (pkg && nm) set("netPrice", String(packagePrice(pkg, num(nm))));
  };

  const addFiles = (key: string, list: FileList | File[] | null) => {
    if (!list?.length) return;
    setFiles((p) => ({ ...p, [key]: [...(p[key] || []), ...Array.from(list)] }));
  };
  const removeFile = (key: string, idx: number) =>
    setFiles((p) => ({ ...p, [key]: (p[key] || []).filter((_, i) => i !== idx) }));

  async function submit() {
    setResult(null);
    if (!f.brand) return setResult({ ok: false, error: "กรุณาเลือกบริษัท (Thunder / EasySlip)" });
    if (!f.user.trim()) return setResult({ ok: false, error: "กรุณากรอกยูสเซอร์" });
    if (num(f.refund) <= 0) return setResult({ ok: false, error: "กรุณากรอกยอดโอนคืนทั้งสิ้น" });

    const payload: RefundFormInput = {
      brand: f.brand,
      docType: f.docType,
      user: f.user.trim(),
      userId: f.userId.trim(),
      companyName: f.companyName.trim(),
      serviceLabel: f.serviceLabel.trim(),
      reason: f.reason.trim(),
      topupDate: f.topupDate.trim(),
      amount: num(f.amount),
      purchaseDate: f.purchaseDate.trim(),
      packageName: f.packageName.trim(),
      months: num(f.months),
      netPrice: num(f.netPrice),
      remainingCredit: f.remainingCredit.trim() ? num(f.remainingCredit) : undefined,
      whtAmount: f.whtAmount.trim() ? num(f.whtAmount) : undefined,
      whtDate: f.whtDate.trim(),
      refund: num(f.refund),
      bank: f.bank.trim(),
      accountNo: f.accountNo.trim(),
      accountName: f.accountName.trim(),
      otherDocLabel: f.otherDocLabel.trim(),
    };

    const fd = new FormData();
    fd.append("payload", JSON.stringify(payload));
    for (const slot of UPLOAD_SLOTS) for (const file of files[slot.key] || []) fd.append(`f:${slot.key}`, file);

    setSubmitting(true);
    try {
      const res = await fetch("/api/memo/create", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) setResult({ ok: false, error: data.error || "ส่งไม่สำเร็จ" });
      else setResult({ ok: true });
    } catch {
      setResult({ ok: false, error: "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 text-[15px] lg:py-10">
      {/* หัวเรื่องแบบเรียบ (ไม่มีแบนเนอร์ใหญ่) */}
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold text-foreground">ออกเอกสารคืนเงินลูกค้า</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          กรอกข้อมูลให้ครบ แนบไฟล์แยกตามประเภท แล้วกดส่ง — ระบบจะออกร่างเอกสารเข้ากลุ่มให้ตรวจและเซ็นทันที
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[248px_1fr]">
        {/* Step sidebar */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-2xl border border-border bg-surface p-3 shadow-sm">
            <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">ขั้นตอน</p>
            <ol className="mt-1 space-y-1">
              {STEPS.map((s, i) => {
                const on = active === i;
                return (
                  <li key={s.title}>
                    <button
                      onClick={() => goStep(i)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
                        on ? "bg-primary-soft" : "hover:bg-surface-2",
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
                          on ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground",
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className={cn("block truncate text-sm font-medium", on ? "text-primary" : "text-foreground")}>
                          {s.title}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{s.sub}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* เลือกชนิดเอกสาร */}
          <div className="mt-4 rounded-2xl border border-border bg-surface p-3 shadow-sm">
            <p className="mb-2 flex items-center gap-1.5 px-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <FileStack className="h-3.5 w-3.5" aria-hidden />
              ชนิดเอกสาร
            </p>
            <div className="space-y-2">
              {DOC_TYPES.map((dt) => {
                const on = f.docType === dt.v;
                const Icon = dt.icon;
                return (
                  <button
                    key={dt.v}
                    onClick={() => set("docType", dt.v)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-150",
                      on
                        ? "border-primary bg-primary-soft shadow-sm ring-2 ring-primary/15"
                        : "border-border-strong hover:border-primary/40 hover:bg-surface-2",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors",
                        on ? "bg-primary text-primary-foreground shadow-sm" : "bg-surface-2 text-muted-foreground",
                      )}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm font-semibold leading-tight", on ? "text-primary" : "text-foreground")}>
                        {dt.t}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{dt.d}</span>
                    </span>
                    {on && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Sections */}
        <div className="space-y-6">
          {/* 1. บริษัท & ลูกค้า */}
          <Section idx={0} refs={sectionRefs} icon={Building2} title="ข้อมูลบริษัท & ลูกค้า" sub="เลือกบริษัทที่ออกเอกสาร และข้อมูลลูกค้า" required>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">บริษัทที่ออกเอกสาร <span className="text-danger">*</span></label>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { v: "thunder", t: "Thunder", d: "ธันเดอร์ โซลูชั่น", logo: "/brand/card-thunder.png" },
                  { v: "easyslip", t: "EasySlip", d: "อีซี่สลิป", logo: "/brand/card-easyslip.png" },
                ] as const).map((b) => (
                  <button
                    key={b.v}
                    onClick={() => set("brand", b.v)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-3.5 text-left transition-colors",
                      f.brand === b.v ? "border-primary bg-primary-soft ring-2 ring-primary/20" : "border-border-strong hover:bg-surface-2",
                    )}
                  >
                    <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={b.logo} alt={b.t} className="h-full w-full object-contain" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-display text-base font-semibold">{b.t}</span>
                      <span className="block text-xs text-muted-foreground">{b.d}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {prefilled && (
              <div className="flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary-soft px-4 py-3 text-sm">
                <Info className="mt-0.5 h-4.5 w-4.5 shrink-0 text-primary" aria-hidden />
                <p className="text-foreground/80">
                  พบข้อมูลเดิมของยูสเซอร์นี้ — ดึงกลับมาให้แล้ว <span className="font-medium">กรุณาตรวจสอบความถูกต้องก่อนส่ง</span>
                </p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="relative">
                <Field label="ยูสเซอร์ / อีเมล" required hint="พิมพ์แล้วเลือกจากรายชื่อเดิม ระบบจะดึงข้อมูลให้">
                  <Input
                    value={f.user}
                    onChange={(e) => onUserInput(e.target.value)}
                    onFocus={() => { if (userSug.length) setShowUserSug(true); }}
                    onBlur={() => { setTimeout(() => setShowUserSug(false), 120); lookupUser(); }}
                    autoComplete="off"
                  />
                </Field>
                {showUserSug && userSug.length > 0 && (
                  <ul className="absolute left-0 right-0 z-30 mt-1 max-h-56 overflow-auto rounded-xl border border-border bg-surface py-1 shadow-lg">
                    {userSug.map((u, i) => (
                      <li key={u}>
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); pickUser(u); }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
                        >
                          <span className="shrink-0 text-xs text-muted-foreground">#{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate">{u}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Field label="ไอดียูสเซอร์">
                <Input value={f.userId} onChange={(e) => set("userId", e.target.value)} />
              </Field>
            </div>
            <Field label="ลูกค้าบริษัท (ชื่อบริษัท/ห้างหุ้นส่วน)">
              <Input value={f.companyName} onChange={(e) => set("companyName", e.target.value)} />
            </Field>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">ประเภทบริการ</label>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { v: "BOT", t: "บริการ BOT" },
                  { v: "API", t: "บริการ API" },
                ] as const).map((s) => (
                  <button
                    key={s.v}
                    onClick={() => selectService(s.v)}
                    className={cn(
                      "rounded-xl border px-4 py-3 text-center text-sm font-medium transition-colors",
                      f.serviceLabel === s.v ? "border-primary bg-primary-soft text-primary ring-2 ring-primary/20" : "border-border-strong hover:bg-surface-2",
                    )}
                  >
                    {s.t}
                  </button>
                ))}
              </div>
            </div>
            {f.docType !== "wht" && (
              <Field label="เหตุผลขอคืน">
                <Textarea rows={4} value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="พิมพ์เหตุผลที่ลูกค้าขอคืนเงินได้ยาว ๆ ตามต้องการ..." />
              </Field>
            )}
          </Section>

          {/* 2. รายละเอียดเงิน */}
          <Section idx={1} refs={sectionRefs} icon={Wallet} title="รายละเอียดเงิน" sub="ยอดเงิน แพ็กเกจ และยอดที่ต้องโอนคืน" required>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="วันที่เติมเครดิต">
                <Input value={f.topupDate} onChange={setDate("topupDate")} inputMode="numeric" placeholder="วว/ดด/ปปปป" />
              </Field>
              <Field label="จำนวนเงินที่เติมเข้ามา (บาท)">
                <Input value={f.amount} onChange={(e) => set("amount", e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="วันที่ซื้อบริการ">
                <Input value={f.purchaseDate} onChange={setDate("purchaseDate")} inputMode="numeric" placeholder="วว/ดด/ปปปป" />
              </Field>
              <Field label="แพ็กเกจ" hint={pkgs.length ? "เลือกแพ็กเกจ + จำนวนเดือน แล้วราคาจะคำนวณให้อัตโนมัติ (แก้ได้)" : undefined}>
                {pkgs.length > 0 ? (
                  <div className="relative">
                    <select
                      value={f.packageName}
                      onChange={(e) => selectPackage(e.target.value)}
                      className={cn(
                        "h-11 w-full appearance-none rounded-[11px] border border-border-strong bg-surface px-3.5 pr-9 text-foreground",
                        "focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20",
                        f.packageName ? "" : "text-muted-foreground/70",
                      )}
                    >
                      <option value="">เลือกแพ็กเกจ</option>
                      {pkgs.map((p) => (
                        <option key={p.name} value={p.name} className="text-foreground">
                          {p.name} · {p.price.toLocaleString("th-TH")} บ./เดือน
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  </div>
                ) : (
                  <Input value={f.packageName} onChange={(e) => set("packageName", e.target.value)} />
                )}
              </Field>
              <Field label="จำนวนเดือน">
                <div className="flex gap-2">
                  {monthOpts.map((m) => (
                    <button
                      key={m}
                      onClick={() => selectMonths(m)}
                      className={cn(
                        "h-11 flex-1 rounded-[11px] border text-sm font-medium transition-colors",
                        f.months === m
                          ? "border-primary bg-primary-soft text-primary ring-2 ring-primary/20"
                          : "border-border-strong hover:bg-surface-2",
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="ราคาค่าบริการ (บาท)">
                <Input value={f.netPrice} onChange={(e) => set("netPrice", e.target.value)} inputMode="decimal" />
              </Field>
              <Field label="เครดิตคงเหลือก่อนขอคืน (บาท)">
                <Input value={f.remainingCredit} onChange={(e) => set("remainingCredit", e.target.value)} inputMode="decimal" />
              </Field>
              {f.docType === "wht" && (
                <>
                  <Field label="ยอดหักภาษี ณ ที่จ่าย (บาท)">
                    <Input value={f.whtAmount} onChange={(e) => set("whtAmount", e.target.value)} inputMode="decimal" />
                  </Field>
                  <Field label="วันที่หักภาษี ณ ที่จ่าย (ตามเอกสารจริง)">
                    <Input value={f.whtDate} onChange={setDate("whtDate")} inputMode="numeric" placeholder="วว/ดด/ปปปป" />
                  </Field>
                </>
              )}
              <Field label="ยอดโอนคืนทั้งสิ้น (บาท)" required>
                <Input value={f.refund} onChange={(e) => set("refund", e.target.value)} inputMode="decimal" />
              </Field>
            </div>
            {refundText && (
              <div className="rounded-xl bg-primary-soft px-4 py-3 text-sm">
                <span className="text-muted-foreground">ตัวอักษร: </span>
                <span className="font-medium text-primary">({refundText})</span>
              </div>
            )}
          </Section>

          {/* 3. บัญชีรับเงินคืน */}
          <Section idx={2} refs={sectionRefs} icon={Landmark} title="บัญชีรับเงินคืน" sub="บัญชีธนาคารที่จะโอนเงินคืนให้ลูกค้า">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ธนาคาร">
                <Input value={f.bank} onChange={(e) => set("bank", e.target.value)} />
              </Field>
              <Field label="เลขที่บัญชี">
                <Input value={f.accountNo} onChange={(e) => set("accountNo", e.target.value)} />
              </Field>
            </div>
            <Field label="ชื่อบัญชี">
              <Input value={f.accountName} onChange={(e) => set("accountName", e.target.value)} />
            </Field>
          </Section>

          {/* 4. อัพโหลดเอกสาร */}
          <Section idx={3} refs={sectionRefs} icon={Paperclip} title="อัพโหลดเอกสาร" sub="แนบไฟล์แยกช่องตามประเภท เพื่อให้เอกสารแนบถูกต้อง">
            <div className="grid gap-4 sm:grid-cols-2">
              {UPLOAD_SLOTS.map((slot) => (
                <UploadDropzone
                  key={slot.key}
                  slot={slot}
                  files={files[slot.key] || []}
                  onAdd={(list) => addFiles(slot.key, list)}
                  onRemove={(i) => removeFile(slot.key, i)}
                  otherLabel={f.otherDocLabel}
                  onOtherLabel={(v) => set("otherDocLabel", v)}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              ช่อง “เอกสารแนบ” ในเอกสารจะติ๊กครบทุกข้อ · ไฟล์แต่ละช่องจะกลายเป็นหน้าเอกสารแนบท้ายเอกสารตามลำดับ · แต่ละช่องแนบได้หลายไฟล์ — เลือกไฟล์ / ลากมาวาง / กดปุ่ม “วางรูปที่ก็อปไว้”
            </p>
          </Section>

          {/* 5. ตรวจ & ส่ง */}
          <Section idx={4} refs={sectionRefs} icon={SendHorizontal} title="ตรวจ & ส่ง" sub="ตรวจสรุปแล้วส่งเพื่อออกเอกสาร">
            <dl className="grid gap-x-6 gap-y-2 rounded-xl bg-surface-2/50 p-4 text-sm sm:grid-cols-2">
              <Row k="บริษัท" v={f.brand === "thunder" ? "Thunder (ธันเดอร์ โซลูชั่น)" : f.brand === "easyslip" ? "EasySlip (อีซี่สลิป)" : "—"} />
              <Row k="ลูกค้า" v={f.companyName || f.user || "—"} />
              <Row k="ยอดโอนคืน" v={num(f.refund) > 0 ? `${num(f.refund).toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท` : "—"} />
              <Row k="ตัวอักษร" v={refundText || "—"} />
              <Row k="บัญชีรับคืน" v={f.accountNo ? `${f.bank} ${f.accountNo}` : "—"} />
              <Row k="ไฟล์แนบ" v={`${totalFiles} ไฟล์`} />
            </dl>

            {result && (
              result.ok ? (
                <div className="flex items-start gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
                  <div>
                    <p className="font-medium text-accent-foreground/90">ส่งเรียบร้อยแล้ว</p>
                    <p className="text-muted-foreground">
                      ระบบกำลังออกเอกสารเข้ากลุ่มให้อยู่เบื้องหลัง — รอสักครู่แล้วตรวจในกลุ่ม Telegram กด “เซ็นเลย” ได้เลย
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
                  <p className="text-danger">{result.error}</p>
                </div>
              )
            )}

            <Button size="lg" onClick={submit} disabled={submitting} className="w-full sm:w-auto">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
              {submitting ? "กำลังส่ง..." : "ส่งออกเอกสาร"}
            </Button>
          </Section>
        </div>
      </div>
    </div>
  );
}

// ช่องอัพโหลด: คลิกเลือกไฟล์ · ลากวาง (drag & drop) · ก็อปวาง (paste เมื่อโฟกัสช่องนี้)
function UploadDropzone({
  slot, files, onAdd, onRemove, otherLabel, onOtherLabel,
}: {
  slot: { key: string; label: string; hint: string };
  files: File[];
  onAdd: (list: FileList | File[] | null) => void;
  onRemove: (idx: number) => void;
  otherLabel: string;
  onOtherLabel: (v: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  // อ่านรูปจากคลิปบอร์ดตรง ๆ (กดปุ่มเดียว ไม่ต้องโฟกัสช่องก่อน)
  const pasteFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      const out: File[] = [];
      for (const it of items) {
        const t = it.types.find((x) => x.startsWith("image/"));
        if (t) out.push(new File([await it.getType(t)], "paste.png", { type: t }));
      }
      if (out.length) onAdd(out);
    } catch {
      /* เบราว์เซอร์ไม่ให้สิทธิ์คลิปบอร์ด หรือไม่มีรูป — ใช้ลากวาง/เลือกไฟล์แทนได้ */
    }
  };
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onAdd(e.dataTransfer.files); }}
        onPaste={(e) => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); onAdd(fs); } }}
        className={cn(
          "group block cursor-pointer rounded-xl border border-dashed p-4 text-center outline-none transition-colors",
          drag
            ? "border-primary bg-primary-soft/60 ring-2 ring-primary/20"
            : "border-border-strong bg-surface-2/40 hover:border-primary hover:bg-primary-soft/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => { onAdd(e.target.files); e.target.value = ""; }}
        />
        <UploadCloud className="mx-auto h-6 w-6 text-muted-foreground group-hover:text-primary" aria-hidden />
        <span className="mt-1.5 block text-sm font-medium">{slot.label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{slot.hint}</span>
        <span className="mt-1.5 block text-[11px] text-muted-foreground/70">คลิกเพื่อเลือกไฟล์ · หรือลากรูปมาวางที่นี่</span>
      </div>
      <button
        type="button"
        onClick={pasteFromClipboard}
        className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-surface py-2 text-xs font-medium text-primary transition-colors hover:border-primary hover:bg-primary-soft"
      >
        <ClipboardPaste className="h-3.5 w-3.5" aria-hidden /> วางรูปที่ก็อปไว้
      </button>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((file, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{file.name || "รูปที่วาง"}</span>
              <button onClick={() => onRemove(i)} className="text-muted-foreground hover:text-danger" aria-label="ลบ">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {slot.key === "other" && files.length > 0 && (
        <input
          className="mt-2 h-9 w-full rounded-lg border border-border-strong bg-surface px-3 text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          value={otherLabel}
          onChange={(e) => onOtherLabel(e.target.value)}
          placeholder="ระบุชื่อเอกสารอื่นๆ (จะเขียนในข้อ 4)"
        />
      )}
    </div>
  );
}

function Section({
  idx, refs, icon: Icon, title, sub, required, children,
}: {
  idx: number;
  refs: React.RefObject<(HTMLElement | null)[]>;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      ref={(el) => { refs.current[idx] = el; }}
      data-step={idx}
      className="scroll-mt-6 rounded-2xl border border-border bg-surface p-5 shadow-sm lg:p-6"
    >
      <div className="mb-4 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{sub}</p>
        </div>
        {required && (
          <span className="rounded-full bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger">* จำเป็น</span>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/60 py-1 last:border-0 sm:border-0">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}
