"use client";

import { useEffect, useState } from "react";
import {
  BrainCircuit,
  Presentation,
  Plug,
  Check,
  CircleAlert,
  Save,
  Bot,
  Sparkles,
  Webhook,
  Send,
  NotebookPen,
  PenLine,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/cn";

interface Conn {
  ok: boolean;
  detail: string;
}
interface SettingsData {
  brainModel: string;
  style: string;
  connections: Record<string, Conn>;
}

const MODELS = [
  { key: "hermes", label: "น้องวาน (Hermes)", desc: "หลัก · agent gpt-5.5 · คิด+ใช้ tool เอง", icon: BrainCircuit },
  { key: "codex", label: "Codex GPT-5.5", desc: "gpt-5.5 ตรง · ไม่ผ่าน agent (เร็วกว่า)", icon: Sparkles },
  { key: "claude", label: "Claude", desc: "co-brain · ร่างเอกสาร/สไลด์/รีวิว", icon: Sparkles },
  { key: "gemini", label: "Gemini", desc: "สำรอง · REST API", icon: Bot },
  { key: "auto", label: "อัตโนมัติ", desc: "น้องวาน ก่อน สลับสำรองเอง", icon: BrainCircuit },
];

const CONN_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  codex: { label: "Codex GPT-5.5", icon: Sparkles },
  claude: { label: "Claude CLI", icon: Sparkles },
  gemini: { label: "Gemini API", icon: Bot },
  hermes: { label: "Hermes agent", icon: Webhook },
  telegram: { label: "Telegram", icon: Send },
  obsidian: { label: "Obsidian vault", icon: NotebookPen },
  signature: { label: "ลายเซ็นเอกสาร", icon: PenLine },
};

export function SettingsView() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [style, setStyle] = useState("");
  const [savingStyle, setSavingStyle] = useState(false);
  const [savedStyle, setSavedStyle] = useState(false);
  const [model, setModel] = useState("hermes");

  async function load() {
    const res = await fetch("/api/settings");
    if (res.ok) {
      const d = await res.json();
      setData(d);
      setStyle(d.style);
      setModel(d.brainModel);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function saveModel(m: string) {
    setModel(m);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "brain", model: m }),
    });
  }

  async function saveStyle() {
    setSavingStyle(true);
    setSavedStyle(false);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "style", content: style }),
    });
    setSavingStyle(false);
    setSavedStyle(true);
    setTimeout(() => setSavedStyle(false), 2500);
  }

  return (
    <div className="p-5 sm:p-7 max-w-3xl mx-auto">
      <PageHeader title="ตั้งค่า" subtitle="เลือกสมอง AI สอนสไตล์สไลด์ และดูสถานะการเชื่อมต่อ" />

      {/* Brain model */}
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 mb-1">
            <BrainCircuit className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-foreground">สมอง AI ของเลขา</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            เลือกโมเดลที่ใช้ตอบ ระบบดึงความรู้จากข้อมูลทุนจริง + Obsidian ให้อัตโนมัติ
          </p>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {MODELS.map((m) => {
              const active = model === m.key;
              const Icon = m.icon;
              return (
                <button
                  key={m.key}
                  onClick={() => saveModel(m.key)}
                  className={cn(
                    "flex items-center gap-3 text-left p-3.5 rounded-xl border transition-colors cursor-pointer",
                    active
                      ? "border-primary bg-primary-soft"
                      : "border-border bg-surface hover:border-border-strong",
                  )}
                >
                  <span
                    className={cn(
                      "grid place-items-center h-9 w-9 rounded-lg shrink-0",
                      active ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{m.label}</p>
                    <p className="text-xs text-muted-foreground">{m.desc}</p>
                  </div>
                  {active && <Check className="h-4 w-4 text-primary ml-auto shrink-0" />}
                </button>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* Style memory */}
      <Card className="mt-4">
        <CardBody>
          <div className="flex items-center gap-2 mb-1">
            <Presentation className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-foreground">สไตล์สไลด์ (Style Memory)</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            พิมพ์อธิบายสไตล์ที่ต้องการ ระบบจะจำและใช้ทุกครั้งที่สร้างสไลด์ (บอกผ่านแชทเลขาก็ได้)
          </p>
          <Textarea
            rows={5}
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="เช่น ใช้โทนน้ำเงิน หัวข้อใหญ่ หนึ่งประเด็นต่อสไลด์ เน้นตัวเลขสำคัญ..."
          />
          <div className="flex items-center gap-2 mt-3">
            <Button onClick={saveStyle} loading={savingStyle}>
              {savedStyle ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {savedStyle ? "บันทึกแล้ว" : "บันทึกสไตล์"}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Connections */}
      <Card className="mt-4">
        <CardBody>
          <div className="flex items-center gap-2 mb-4">
            <Plug className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-foreground">สถานะการเชื่อมต่อ</h2>
          </div>
          <div className="space-y-2.5">
            {data &&
              Object.entries(data.connections).map(([key, c]) => {
                const meta = CONN_META[key] || { label: key, icon: Plug };
                const Icon = meta.icon;
                return (
                  <div key={key} className="flex items-center gap-3 p-3 rounded-xl border border-border">
                    <span className="grid place-items-center h-9 w-9 rounded-lg bg-surface-2 text-muted-foreground shrink-0">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{meta.label}</p>
                      <p className="text-xs text-muted-foreground truncate">{c.detail}</p>
                    </div>
                    {c.ok ? (
                      <span className="inline-flex items-center gap-1 text-xs text-accent shrink-0">
                        <Check className="h-4 w-4" />
                        พร้อม
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-warning shrink-0">
                        <CircleAlert className="h-4 w-4" />
                        รอตั้งค่า
                      </span>
                    )}
                  </div>
                );
              })}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
