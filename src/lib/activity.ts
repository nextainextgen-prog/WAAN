import { db } from "./db";

// บันทึกสิ่งที่น้องวานทำ/เฝ้า ลง BotActivity (append-only) — ให้วานตอบย้อนหลัง + รายงานสุขภาพตัวเองได้
export interface ActivityInput {
  source: string; // oho | fb | line | usage | aff | thunder | bot
  kind: string; // close-remind | waiting-alert | aff-check | expiry | popup-dismiss | session-expired | tick-error ...
  summary: string; // ประโยคเดียวอ่านรู้เรื่อง
  severity?: "info" | "warn" | "error";
  company?: string | null;
  platform?: string | null;
  channel?: string | null;
  customer?: string | null;
  admin?: string | null;
  shiftNames?: string | null;
  convId?: string | null;
  chatId?: string | null;
  level?: number | null;
  waitSec?: number | null;
  requestedBy?: string | null;
  outcome?: string | null;
  payload?: unknown;
}

function clip(s: unknown, n: number): string | null {
  if (s === undefined || s === null) return null;
  const t = String(s).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, n) : null;
}

export async function logActivity(input: ActivityInput) {
  if (!input?.source || !input?.kind || !input?.summary) return null;
  return db.botActivity
    .create({
      data: {
        source: clip(input.source, 24)!,
        kind: clip(input.kind, 40)!,
        severity: input.severity || "info",
        summary: clip(input.summary, 500)!,
        company: clip(input.company, 60),
        platform: clip(input.platform, 20),
        channel: clip(input.channel, 80),
        customer: clip(input.customer, 80),
        admin: clip(input.admin, 60),
        shiftNames: clip(input.shiftNames, 200),
        convId: clip(input.convId, 80),
        chatId: clip(input.chatId, 40),
        level: typeof input.level === "number" ? input.level : null,
        waitSec: typeof input.waitSec === "number" ? Math.round(input.waitSec) : null,
        requestedBy: clip(input.requestedBy, 80),
        outcome: clip(input.outcome, 120),
        payload: input.payload != null ? JSON.stringify(input.payload).slice(0, 2000) : null,
      },
    })
    .catch(() => null); // จดไม่สำเร็จห้ามทำให้ flow หลักล้ม
}

const TZ = "Asia/Bangkok";
const thaiDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD (เขต gregory)
const thaiTime = (d: Date) => d.toLocaleTimeString("th-TH", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const mmss = (sec?: number | null) => {
  if (!sec && sec !== 0) return "";
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} นาที`;
};

// สรุปกิจกรรมล่าสุดเป็นข้อความกระชับ ฉีดเข้า system prompt ให้วานตอบเรื่องงานเฝ้าแชท/เคส/สุขภาพระบบ
// days=2 (ดีฟอลต์ ฉีดทุกข้อความ) · days=7 (สำหรับรีวิวตัวเอง)
export async function getActivityDigest(days = 2): Promise<string> {
  const hours = Math.max(1, Math.round(days * 24));
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const recentLimit = days > 3 ? 60 : 30;
  const rows = await db.botActivity
    .findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 500 })
    .catch(() => []);
  if (!rows.length) return `(ยังไม่มีบันทึกกิจกรรมในช่วง ${hours} ชม.ที่ผ่านมา)`;

  const todayStr = thaiDate(new Date());
  const today = rows.filter((r) => thaiDate(r.createdAt) === todayStr);

  // (ก) นับตาม kind วันนี้
  const byKind = new Map<string, number>();
  for (const r of today) byKind.set(r.kind, (byKind.get(r.kind) || 0) + 1);
  const kindLine = [...byKind.entries()].map(([k, n]) => `${k} ${n}`).join(" · ") || "ยังไม่มี";

  // (ข) ลืมปิดเคส แยกตามแอดมิน (วันนี้)
  const closeByAdmin = new Map<string, number>();
  for (const r of today.filter((r) => r.kind === "close-remind")) {
    const a = r.admin || "ไม่ทราบแอดมิน";
    closeByAdmin.set(a, (closeByAdmin.get(a) || 0) + 1);
  }
  const closeLine = closeByAdmin.size
    ? [...closeByAdmin.entries()].sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a} ${n} เคส`).join(", ")
    : "ไม่มี";

  // (ค) สุขภาพระบบวันนี้ (error/warn)
  const problems = today.filter((r) => r.severity === "error" || r.severity === "warn");
  const healthLine = problems.length
    ? problems.slice(0, 8).map((r) => `[${r.severity}] ${thaiTime(r.createdAt)} ${r.summary}`).join("\n")
    : "ปกติดี ไม่มี error/warn วันนี้";

  // (ง) รายการล่าสุด
  const recent = rows
    .slice(0, recentLimit)
    .map((r) => {
      const parts = [
        thaiTime(r.createdAt),
        r.kind,
        r.company || r.channel || r.source,
        r.customer,
        r.admin ? `โดย ${r.admin}` : null,
        r.waitSec ? mmss(r.waitSec) : null,
      ].filter(Boolean);
      return `- ${parts.join(" · ")}${r.summary ? ` — ${r.summary}` : ""}`;
    })
    .join("\n");

  return [
    `วันนี้ (${todayStr}) รวม ${today.length} รายการ · แยกประเภท: ${kindLine}`,
    `แอดมินที่ถูกเตือน "ลืมปิดเคส" วันนี้: ${closeLine}`,
    `สุขภาพระบบวันนี้:\n${healthLine}`,
    `รายการล่าสุด (ย้อนหลังสูงสุด ${hours} ชม.):\n${recent}`,
  ].join("\n\n");
}
