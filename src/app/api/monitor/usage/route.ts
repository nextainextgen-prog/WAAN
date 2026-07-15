import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { readUsage, formatMonitorCard, monitorCardHtml } from "@/lib/usage";
import { renderHtmlToPng } from "@/lib/html-pdf";
import { findRoleTopic } from "@/lib/roles";
import { getAllowedChatId } from "@/lib/telegram";
import { logActivity } from "@/lib/activity";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// บอทเรียกเป็นระยะ → คืนการ์ด Usage Monitor เป็น "ภาพ" (หลอด progress สไตล์การ์ด)
// + text สำรอง (เผื่อเรนเดอร์ภาพล้มเหลว) + เป้าหมายที่จะโพสต์ (ห้อง monitor) + alert
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = Date.now();
  const usages = readUsage(now);
  const nowLabel = new Date(now).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
  const { text, alerts } = formatMonitorCard(usages, nowLabel);

  // เรนเดอร์การ์ดเป็น PNG — ถ้าล้มเหลวก็ยังส่ง text แทนได้
  let imageBase64: string | null = null;
  try {
    // height เล็กกว่าเนื้อหา → fullPage ครอปพอดีการ์ด (ไม่เหลือพื้นที่ว่างด้านล่าง)
    const png = await renderHtmlToPng(monitorCardHtml(usages, nowLabel, now), { width: 720, height: 40 });
    imageBase64 = png.toString("base64");
  } catch {
    /* เรนเดอร์ไม่ได้ → ใช้ text สำรอง */
  }

  // จด usage-alert ลง activity (dedup 55 นาที กันจดซ้ำทุกรอบ monitor)
  if (Array.isArray(alerts) && alerts.length) {
    const last = await db.botActivity.findFirst({ where: { kind: "usage-alert" }, orderBy: { createdAt: "desc" } }).catch(() => null);
    if (!last || now - new Date(last.createdAt).getTime() > 55 * 60 * 1000) {
      await logActivity({ source: "usage", kind: "usage-alert", severity: "warn", outcome: alerts.join(" | ").slice(0, 120), summary: `เตือนการใช้งาน AI ใกล้เต็ม: ${alerts.join(" · ")}` });
    }
  }

  const target = await findRoleTopic("monitor"); // ห้อง monitor (ถ้าตั้งไว้)
  const ownerChatId = await getAllowedChatId();

  return NextResponse.json({
    imageBase64, // การ์ดภาพ (base64 PNG) | null
    text, // ข้อความสำรอง
    alerts,
    target, // { chatId, threadId } | null
    ownerChatId: ownerChatId || null,
  });
}
