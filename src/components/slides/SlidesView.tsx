"use client";

import { useEffect, useState } from "react";
import {
  Presentation,
  Sparkles,
  FileDown,
  Loader2,
  Send,
  Clock,
  FileText,
  Check,
  TriangleAlert,
} from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface SlideMeta {
  id: string;
  title: string;
  subtitle: string;
  slideCount: number;
  createdAt: string;
}
interface GenResult extends SlideMeta {
  slides: { layout: string; title?: string }[];
  files: { html: string; pdf: string };
}

const PRESETS = [
  "สรุปสถานะทุนวิจัยทั้งหมดประจำเดือนนี้",
  "รายงานความคืบหน้า OKR สำหรับผู้บริหาร",
  "ทุนที่ใกล้ครบกำหนดและสิ่งที่ต้องเร่งดำเนินการ",
  "สรุปทุนแยกตามแหล่งทุนและสถานะ",
];

export function SlidesView() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GenResult | null>(null);
  const [history, setHistory] = useState<SlideMeta[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function loadHistory() {
    const res = await fetch("/api/slides");
    if (res.ok) setHistory((await res.json()).slides);
  }
  useEffect(() => {
    loadHistory();
  }, []);

  async function generate(t: string) {
    const text = t.trim();
    if (!text || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    setSent(false);
    try {
      const res = await fetch("/api/slides/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "สร้างสไลด์ไม่สำเร็จ");
      } else {
        setResult(data);
        loadHistory();
      }
    } catch {
      setError("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setLoading(false);
    }
  }

  async function sendTelegram(id: string) {
    setSending(true);
    setSent(false);
    try {
      const res = await fetch("/api/telegram/send-slide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) setSent(true);
      else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "ส่ง Telegram ไม่สำเร็จ (ตรวจสอบการตั้งค่าบอท)");
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="p-5 sm:p-7 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold text-foreground">สร้างสไลด์นำเสนอ</h1>
        <p className="text-sm text-muted-foreground mt-1">
          พิมพ์หัวข้อ ระบบจะดึงข้อมูลทุนวิจัยจริงมาสร้างสไลด์ตามสไตล์ที่กำหนด (ได้ทั้ง .pptx และ .pdf)
        </p>
      </div>

      <Card>
        <CardBody>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-sm font-medium text-foreground mb-1.5 block">หัวข้อสไลด์</label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && generate(topic)}
                placeholder="เช่น สรุปสถานะทุนวิจัยประจำเดือนกรกฎาคม"
                className="h-11 w-full px-3.5 rounded-[11px] bg-surface border border-border-strong text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <Button onClick={() => generate(topic)} loading={loading} className="h-11">
              {!loading && <Sparkles className="h-4 w-4" />}
              สร้างสไลด์
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setTopic(p);
                  generate(p);
                }}
                disabled={loading}
                className="text-xs px-3 py-1.5 rounded-full border border-border bg-surface-2 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors cursor-pointer disabled:opacity-50"
              >
                {p}
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      {loading && (
        <Card className="mt-4">
          <CardBody className="py-10 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
            <p className="text-sm text-foreground mt-3 font-medium">กำลังสร้างสไลด์...</p>
            <p className="text-xs text-muted-foreground mt-1">
              ดึงข้อมูลจริง · จัดตามสไตล์ · สร้าง .pptx และ .pdf (ใช้เวลาประมาณ 30–60 วินาที)
            </p>
          </CardBody>
        </Card>
      )}

      {error && (
        <div className="mt-4 flex items-center gap-2 text-sm text-danger bg-danger-soft border border-danger/15 rounded-xl px-4 py-3">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {result && (
        <Card className="mt-4">
          <CardBody>
            <div className="flex items-start gap-3">
              <span className="grid place-items-center h-10 w-10 rounded-xl bg-primary-soft text-primary shrink-0">
                <Presentation className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-display font-semibold text-foreground">{result.title}</h3>
                <p className="text-sm text-muted-foreground">{result.subtitle}</p>
                <Badge tone="primary" className="mt-2">
                  {result.slideCount} สไลด์
                </Badge>
              </div>
            </div>

            <ol className="mt-4 space-y-1.5">
              {result.slides.map((s, i) => (
                <li key={i} className="flex items-center gap-2.5 text-sm text-foreground">
                  <span className="grid place-items-center h-5 w-5 rounded bg-surface-2 text-xs text-muted-foreground tnum shrink-0">
                    {i + 1}
                  </span>
                  {s.title || <span className="text-muted-foreground">(หน้าปก)</span>}
                </li>
              ))}
            </ol>

            <div className="flex flex-wrap items-center gap-2.5 mt-5 pt-4 border-t border-border">
              <a href={result.files.html} target="_blank" rel="noreferrer">
                <Button variant="primary">
                  <Presentation className="h-4 w-4" />
                  เปิดเด็ค (เลื่อนดูได้)
                </Button>
              </a>
              <a href={result.files.pdf} target="_blank" rel="noreferrer">
                <Button variant="outline">
                  <FileDown className="h-4 w-4" />
                  ดาวน์โหลด PDF
                </Button>
              </a>
              <Button variant="ghost" onClick={() => sendTelegram(result.id)} loading={sending} className="ml-auto">
                {sent ? <Check className="h-4 w-4 text-accent" /> : <Send className="h-4 w-4" />}
                {sent ? "ส่งแล้ว" : "ส่งเข้า Telegram"}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* history */}
      {history.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">สไลด์ที่สร้างไว้</h2>
          </div>
          <div className="space-y-2.5">
            {history.map((h) => (
              <Card key={h.id}>
                <CardBody className="p-4 flex items-center gap-3">
                  <span className="grid place-items-center h-9 w-9 rounded-lg bg-surface-2 text-muted-foreground shrink-0">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{h.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {h.slideCount} สไลด์ · {new Date(h.createdAt).toLocaleString("th-TH")}
                    </p>
                  </div>
                  <a href={`/api/slides/${h.id}/html`} target="_blank" rel="noreferrer">
                    <Button variant="ghost" size="sm">
                      เปิดเด็ค
                    </Button>
                  </a>
                  <a href={`/api/slides/${h.id}/pdf`} target="_blank" rel="noreferrer">
                    <Button variant="ghost" size="sm">
                      PDF
                    </Button>
                  </a>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
