"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx-republish";
import {
  UploadCloud,
  FileSpreadsheet,
  ArrowRight,
  CheckCircle2,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { IMPORT_FIELDS, autoGuessMapping, type ImportFieldKey } from "@/lib/import";
import { statusLabel } from "@/lib/grants";
import { normalizeStatus, normalizeAmount, normalizeDate } from "@/lib/import";
import { formatBaht, formatThaiDate } from "@/lib/grants";

type Step = "upload" | "map" | "done";
type Row = Record<string, unknown>;

export default function ImportPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [mapping, setMapping] = useState<Record<ImportFieldKey, string | null>>(
    {} as Record<ImportFieldKey, string | null>,
  );
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleFile(file: File) {
    setError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Row>(ws, { defval: "", raw: true });
        if (json.length === 0) {
          setError("ไฟล์นี้ไม่มีข้อมูล");
          return;
        }
        const hdrs = Object.keys(json[0]);
        setHeaders(hdrs);
        setRows(json);
        setMapping(autoGuessMapping(hdrs));
        setFileName(file.name);
        setStep("map");
      } catch {
        setError("อ่านไฟล์ไม่สำเร็จ — รองรับ .xlsx .xls .csv");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function mappedValue(row: Row, key: ImportFieldKey): unknown {
    const col = mapping[key];
    return col ? row[col] : undefined;
  }

  async function doImport() {
    if (!mapping.projectName) {
      setError("กรุณาเลือกคอลัมน์สำหรับ 'ชื่อโครงการ' ก่อน");
      return;
    }
    setImporting(true);
    setError("");
    const payload = rows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (const f of IMPORT_FIELDS) obj[f.key] = mappedValue(row, f.key);
      return obj;
    });
    const res = await fetch("/api/grants/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: payload }),
    });
    setImporting(false);
    if (!res.ok) {
      setError("นำเข้าไม่สำเร็จ");
      return;
    }
    const data = await res.json();
    setResult({ imported: data.imported, skipped: data.skipped });
    setStep("done");
    router.refresh();
  }

  function reset() {
    setStep("upload");
    setRows([]);
    setHeaders([]);
    setResult(null);
    setFileName("");
    setError("");
  }

  const validCount = rows.filter((r) => {
    const v = mappedValue(r, "projectName");
    return v != null && String(v).trim();
  }).length;

  return (
    <div className="p-5 sm:p-7 max-w-5xl mx-auto">
      <PageHeader
        title="นำเข้าข้อมูลทุนวิจัย"
        subtitle="รองรับไฟล์ Excel (.xlsx/.xls) และ CSV — นำเข้าข้อมูลดิบได้เลย ระบบจะจัดรูปแบบให้อัตโนมัติ"
      />

      {/* stepper */}
      <div className="flex items-center gap-2 text-sm mb-6">
        {(["upload", "map", "done"] as Step[]).map((s, i) => {
          const labels = { upload: "เลือกไฟล์", map: "จับคู่คอลัมน์", done: "เสร็จสิ้น" };
          const active = step === s;
          const passed = ["upload", "map", "done"].indexOf(step) > i;
          return (
            <div key={s} className="flex items-center gap-2">
              <span
                className={`grid place-items-center h-6 w-6 rounded-full text-xs font-medium ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : passed
                      ? "bg-accent text-accent-foreground"
                      : "bg-surface-2 text-muted-foreground"
                }`}
              >
                {passed ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
              </span>
              <span className={active ? "text-foreground font-medium" : "text-muted-foreground"}>
                {labels[s]}
              </span>
              {i < 2 && <span className="w-8 h-px bg-border mx-1" />}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-danger bg-danger-soft border border-danger/15 rounded-xl px-4 py-3 mb-4">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {step === "upload" && (
        <Card>
          <CardBody>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
              }}
              className={`border-2 border-dashed rounded-2xl py-16 text-center transition-colors ${
                dragOver ? "border-primary bg-primary-soft/40" : "border-border-strong"
              }`}
            >
              <span className="grid place-items-center h-14 w-14 rounded-2xl bg-primary-soft text-primary mx-auto">
                <UploadCloud className="h-7 w-7" />
              </span>
              <p className="font-medium text-foreground mt-4">ลากไฟล์มาวางที่นี่</p>
              <p className="text-sm text-muted-foreground mt-1">หรือเลือกไฟล์จากเครื่อง (.xlsx .xls .csv)</p>
              <Button variant="primary" className="mt-5" onClick={() => inputRef.current?.click()}>
                <FileSpreadsheet className="h-4 w-4" />
                เลือกไฟล์
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </div>
          </CardBody>
        </Card>
      )}

      {step === "map" && (
        <div className="space-y-4">
          <Card>
            <CardBody>
              <div className="flex items-center gap-2 mb-4">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-foreground">{fileName}</span>
                <Badge tone="primary">{rows.length} แถว</Badge>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                จับคู่คอลัมน์ในไฟล์กับข้อมูลของระบบ (ระบบเดาให้แล้ว ปรับได้ตามต้องการ)
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {IMPORT_FIELDS.map((f) => (
                  <div key={f.key} className="flex items-center gap-3">
                    <label className="w-32 shrink-0 text-sm text-foreground">
                      {f.label}
                      {f.required && <span className="text-danger">*</span>}
                    </label>
                    <select
                      value={mapping[f.key] ?? ""}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [f.key]: e.target.value || null }))
                      }
                      className="flex-1 h-10 px-3 rounded-[10px] bg-surface border border-border-strong text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
                    >
                      <option value="">— ไม่นำเข้า —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          {/* preview */}
          <Card>
            <CardBody>
              <p className="text-sm font-medium text-foreground mb-3">
                ตัวอย่างข้อมูลหลังจัดรูปแบบ (5 แถวแรก)
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="py-2 pr-4 font-medium">ชื่อโครงการ</th>
                      <th className="py-2 pr-4 font-medium">เจ้าของ</th>
                      <th className="py-2 pr-4 font-medium">แหล่งทุน</th>
                      <th className="py-2 pr-4 font-medium text-right">มูลค่า</th>
                      <th className="py-2 pr-4 font-medium">สถานะ</th>
                      <th className="py-2 font-medium">กำหนดส่ง</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((r, i) => {
                      const pn = mappedValue(r, "projectName");
                      const valid = pn != null && String(pn).trim();
                      return (
                        <tr key={i} className="border-b border-border/60">
                          <td className="py-2 pr-4 text-foreground">
                            {valid ? (
                              String(pn)
                            ) : (
                              <span className="text-danger text-xs">(ว่าง — จะข้าม)</span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground">
                            {String(mappedValue(r, "ownerName") ?? "-")}
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground">
                            {String(mappedValue(r, "source") ?? "-")}
                          </td>
                          <td className="py-2 pr-4 text-right tnum text-foreground">
                            {formatBaht(normalizeAmount(mappedValue(r, "amount")))}
                          </td>
                          <td className="py-2 pr-4">
                            <span className="text-xs">{statusLabel(normalizeStatus(mappedValue(r, "status")))}</span>
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {formatThaiDate(normalizeDate(mappedValue(r, "nextDeadline")))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
              เลือกไฟล์ใหม่
            </Button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                จะนำเข้า <span className="font-medium text-foreground tnum">{validCount}</span> รายการ
              </span>
              <Button variant="primary" onClick={doImport} loading={importing}>
                นำเข้าข้อมูล
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <Card>
          <CardBody className="py-14 text-center">
            <span className="grid place-items-center h-14 w-14 rounded-2xl bg-accent-soft text-accent mx-auto">
              <CheckCircle2 className="h-7 w-7" />
            </span>
            <h3 className="font-display text-lg font-semibold text-foreground mt-4">นำเข้าสำเร็จ</h3>
            <p className="text-sm text-muted-foreground mt-1.5">
              เพิ่มทุนใหม่ <span className="font-medium text-foreground tnum">{result.imported}</span> รายการ
              {result.skipped > 0 && (
                <> · ข้าม <span className="tnum">{result.skipped}</span> แถวที่ไม่มีชื่อโครงการ</>
              )}
            </p>
            <div className="flex items-center justify-center gap-2.5 mt-6">
              <Button variant="primary" onClick={() => router.push("/grants")}>
                ดูใน Kanban
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" onClick={reset}>
                นำเข้าไฟล์อื่น
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
