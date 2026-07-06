"use client";

import { useEffect, useRef, useState } from "react";
import {
  FileStack,
  Upload,
  FileText,
  Check,
  X,
  Download,
  PenLine,
  Loader2,
  Clock,
} from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";

interface Doc {
  id: string;
  filename: string;
  source: string | null;
  summary: string | null;
  status: string;
  signedPath: string | null;
  createdAt: string;
}

export function DocumentsView() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch("/api/documents");
    if (res.ok) setDocs((await res.json()).documents);
  }
  useEffect(() => {
    load();
  }, []);

  async function upload(file: File) {
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    form.append("source", "อัปโหลดผ่านเว็บ");
    await fetch("/api/documents", { method: "POST", body: form });
    setUploading(false);
    load();
  }

  async function decide(id: string, decision: "approve" | "reject") {
    setBusyId(id);
    await fetch(`/api/documents/${id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    setBusyId(null);
    load();
  }

  const pending = docs.filter((d) => d.status === "pending");
  const decided = docs.filter((d) => d.status !== "pending");

  return (
    <div className="p-5 sm:p-7 max-w-4xl mx-auto">
      <PageHeader
        title="เอกสารรออนุมัติ"
        subtitle="อัปโหลดเอกสาร ระบบจะสรุปด้วย AI แล้วให้อนุมัติ/เซ็นได้ทันที"
        actions={
          <>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
            <Button onClick={() => inputRef.current?.click()} loading={uploading}>
              {!uploading && <Upload className="h-4 w-4" />}
              อัปโหลดเอกสาร
            </Button>
          </>
        }
      />

      {docs.length === 0 && !uploading && (
        <Card>
          <CardBody className="py-14 text-center">
            <span className="grid place-items-center h-14 w-14 rounded-2xl bg-surface-2 text-muted-foreground mx-auto">
              <FileStack className="h-7 w-7" />
            </span>
            <p className="text-foreground font-medium mt-4">ยังไม่มีเอกสารในระบบ</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              อัปโหลด PDF/DOCX เพื่อให้ AI สรุปและเข้าสู่ขั้นตอนอนุมัติ หรือวางไฟล์ในโฟลเดอร์ที่เฝ้าดูไว้
            </p>
          </CardBody>
        </Card>
      )}

      {uploading && (
        <Card>
          <CardBody className="py-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
            <p className="text-sm text-muted-foreground mt-2">กำลังอัปโหลดและสรุปเอกสาร...</p>
          </CardBody>
        </Card>
      )}

      {pending.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">รออนุมัติ ({pending.length})</h2>
          {pending.map((d) => (
            <DocCard key={d.id} d={d} busy={busyId === d.id} onDecide={decide} />
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <div className="space-y-3 mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground">ดำเนินการแล้ว ({decided.length})</h2>
          {decided.map((d) => (
            <DocCard key={d.id} d={d} busy={false} onDecide={decide} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocCard({
  d,
  busy,
  onDecide,
}: {
  d: Doc;
  busy: boolean;
  onDecide: (id: string, decision: "approve" | "reject") => void;
}) {
  const pending = d.status === "pending";
  return (
    <Card>
      <CardBody>
        <div className="flex items-start gap-3">
          <span className="grid place-items-center h-10 w-10 rounded-xl bg-primary-soft text-primary shrink-0">
            <FileText className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-foreground">{d.filename}</p>
              {d.status === "pending" && <Badge tone="warning"><Clock className="h-3 w-3" />รออนุมัติ</Badge>}
              {d.status === "approved" && <Badge tone="success"><Check className="h-3 w-3" />อนุมัติแล้ว</Badge>}
              {d.status === "rejected" && <Badge tone="danger"><X className="h-3 w-3" />ไม่อนุมัติ</Badge>}
              {d.signedPath && <Badge tone="primary"><PenLine className="h-3 w-3" />เซ็นแล้ว</Badge>}
            </div>
            {d.source && <p className="text-xs text-muted-foreground mt-0.5">ที่มา: {d.source}</p>}
            {d.summary && (
              <p className="text-sm text-foreground/80 mt-2 whitespace-pre-wrap leading-relaxed bg-surface-2 rounded-lg p-3">
                {d.summary}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <a href={`/api/documents/${d.id}/download?type=original`} target="_blank" rel="noreferrer">
                <Button variant="ghost" size="sm">
                  <Download className="h-4 w-4" />
                  ไฟล์ต้นฉบับ
                </Button>
              </a>
              {d.signedPath && (
                <a href={`/api/documents/${d.id}/download?type=signed`} target="_blank" rel="noreferrer">
                  <Button variant="ghost" size="sm">
                    <PenLine className="h-4 w-4" />
                    ไฟล์ที่เซ็นแล้ว
                  </Button>
                </a>
              )}
              {pending && (
                <div className="flex items-center gap-2 ml-auto">
                  <Button variant="outline" size="sm" onClick={() => onDecide(d.id, "reject")} loading={busy}>
                    <X className="h-4 w-4" />
                    ไม่อนุมัติ
                  </Button>
                  <Button variant="accent" size="sm" onClick={() => onDecide(d.id, "approve")} loading={busy}>
                    <Check className="h-4 w-4" />
                    อนุมัติ + เซ็น
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
