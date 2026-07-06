"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Bot, Sparkles, FileText, ListChecks, CalendarClock, Presentation } from "lucide-react";
import { cn } from "@/lib/cn";

interface Msg {
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
}

const SUGGESTIONS = [
  { icon: ListChecks, text: "สรุปสถานะทุนทั้งหมดให้หน่อย" },
  { icon: CalendarClock, text: "ทุนไหนใกล้ deadline ในสัปดาห์นี้" },
  { icon: FileText, text: "ร่างอีเมลแจ้งความก้าวหน้าโครงการ" },
  { icon: Presentation, text: "เตรียม talking points สำหรับประชุมผู้บริหาร" },
];

export function SecretaryChat({ initialMessages }: { initialMessages: Msg[] }) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: msg }, { role: "assistant", content: "", pending: true }]);
    setBusy(true);
    try {
      const res = await fetch("/api/secretary/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", content: data.reply || "ไม่มีคำตอบ" };
        return copy;
      });
    } catch {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", content: "เกิดข้อผิดพลาดในการเชื่อมต่อ" };
        return copy;
      });
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
          {empty ? (
            <div className="pt-8 sm:pt-16 text-center">
              <span className="grid place-items-center h-14 w-14 rounded-2xl bg-primary text-primary-foreground mx-auto">
                <Bot className="h-7 w-7" />
              </span>
              <h2 className="font-display text-2xl font-semibold text-foreground mt-5">
                สวัสดีครับอาจารย์ช้างโอ๋
              </h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
                ผมเป็นเลขา AI ถามเรื่องทุนวิจัย ให้ช่วยตามงาน ร่างเอกสาร หรือสรุปภาพรวมได้เลยครับ
              </p>
              <div className="grid sm:grid-cols-2 gap-2.5 mt-8 max-w-xl mx-auto">
                {SUGGESTIONS.map(({ icon: Icon, text }) => (
                  <button
                    key={text}
                    onClick={() => send(text)}
                    className="flex items-center gap-3 text-left p-3.5 rounded-xl border border-border bg-surface hover:border-primary/40 hover:bg-primary-soft/40 transition-colors cursor-pointer"
                  >
                    <span className="grid place-items-center h-8 w-8 rounded-lg bg-surface-2 text-primary shrink-0">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="text-sm text-foreground">{text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {messages.map((m, i) => (
                <MessageBubble key={i} msg={m} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-surface/80 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-end gap-2 bg-surface border border-border-strong rounded-2xl p-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder="พิมพ์คำถามหรือสิ่งที่ต้องการให้ช่วย... (Enter เพื่อส่ง)"
              className="flex-1 resize-none bg-transparent px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none max-h-40"
              style={{ minHeight: 40 }}
            />
            <button
              onClick={() => send(input)}
              disabled={busy || !input.trim()}
              aria-label="ส่งข้อความ"
              className="grid place-items-center h-10 w-10 rounded-xl bg-primary text-primary-foreground hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shrink-0"
            >
              <Send className="h-4.5 w-4.5" />
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground text-center mt-2">
            <Sparkles className="h-3 w-3 inline mr-1" />
            ขับเคลื่อนด้วย Claude · ตอบจากข้อมูลทุนวิจัยจริงในระบบ
          </p>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <span className="grid place-items-center h-8 w-8 rounded-lg bg-primary-soft text-primary shrink-0 mt-0.5">
        <Bot className="h-4 w-4" />
      </span>
      <div
        className={cn(
          "max-w-[85%] bg-surface border border-border rounded-2xl rounded-tl-md px-4 py-3 text-sm text-foreground whitespace-pre-wrap leading-relaxed",
          msg.pending && "text-muted-foreground",
        )}
      >
        {msg.pending ? <TypingDots /> : msg.content}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 items-center py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}
