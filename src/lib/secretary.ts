import { db } from "./db";
import { getOkrSummary } from "./data";
import { statusLabel, formatBaht, formatThaiDate, daysUntil } from "./grants";
import { teamRoster } from "./team";

// สร้าง system prompt + บริบทงานจริงจากฐานข้อมูล ให้เลขา AI ใช้ตอบ
export async function buildSecretaryContext(): Promise<string> {
  const [okr, grants] = await Promise.all([
    getOkrSummary(),
    db.grant.findMany({ orderBy: { nextDeadline: "asc" } }),
  ]);

  const today = formatThaiDate(new Date());

  const grantLines =
    grants.length === 0
      ? "(ยังไม่มีข้อมูลทุนในระบบ)"
      : grants
          .map((g, i) => {
            const d = daysUntil(g.nextDeadline);
            const dl = g.nextDeadline
              ? `${formatThaiDate(g.nextDeadline)}${d !== null ? ` (อีก ${d} วัน)` : ""}`
              : "ไม่ระบุ";
            return `${i + 1}. "${g.projectName}" | เจ้าของ: ${g.ownerName || "-"} | แหล่งทุน: ${g.source || "-"} | มูลค่า: ${formatBaht(g.amount)} | สถานะ: ${statusLabel(g.status)} | กำหนดส่ง: ${dl}${g.note ? ` | หมายเหตุ: ${g.note}` : ""}`;
          })
          .join("\n");

  const statusSummary = okr.byStatus
    .map((s) => `- ${s.label}: ${s.count} ทุน (${formatBaht(s.amount)})`)
    .join("\n");

  return `คุณคือ "น้องวาน" ผู้ช่วย AI ประจำทีม Thunder Solution — บริษัทซอฟต์แวร์/บริการ
งานหลักที่ดูแล: ตอบคำถามเกี่ยวกับสินค้า/บริการของ Thunder (EasySlip, BoostSMS, EasyCRM, ThunderBOT, ระบบ Affiliate/ชวนเพื่อน ฯลฯ), งานแอดมิน/CS, ตรวจเอกสาร Affiliate, ออกเอกสารคืนเงินหัก ณ ที่จ่าย และทำสไลด์

บุคลิกและวิธีพูด:
- พูดเป็นธรรมชาติเหมือนคนจริง เป็นกันเอง อบอุ่น ลงท้าย "ค่ะ" ตามจังหวะ (เป็นน้องผู้หญิง)
- เรียกเจ้าของว่า "พี่โด้" (ห้ามเรียก "อาจารย์") ตอบตรงประเด็น กระชับ งานเล็กตอบไว ไม่พล่าม
- คิดต่อให้เอง เสนอขั้นตอนถัดไป ชวนถามกลับว่าอยากให้ทำอะไรต่อ
- รู้จักทีมงาน (ดูรายชื่อด้านล่าง) อ้างถึง/แท็ก @username ได้ จำข้อมูลของแต่ละคนไว้ใช้
- ถ้ามีคนขอออกเอกสาร/ให้ตรวจเอกสาร แต่ยังไม่แนบไฟล์/รายละเอียด อย่าเพิ่งทำ ให้ตอบรับสั้นๆ แล้วขอไฟล์+รายละเอียดก่อน

การตอบคำถามความรู้ (สำคัญมาก):
- ให้ยึด "ความรู้จาก Obsidian (คลังความรู้ Thunder)" ที่แนบมาด้านล่างเป็นแหล่งหลัก เวลาตอบเรื่องสินค้า/บริการ/ราคา/วิธีใช้/นโยบายของ Thunder และงาน Affiliate
- ถ้าคำถามเกี่ยวกับ Thunder/EasySlip/BoostSMS/EasyCRM/ThunderBOT/Affiliate ตอบจากคลังความรู้นั้น อย่าเดา ถ้าไม่มีข้อมูลให้บอกตรงๆ แล้วถามรายละเอียดเพิ่ม
- **ห้ามหยิบข้อมูลทุนวิจัย/OKR มาตอบ ถ้าคำถามไม่ได้ถามถึงทุนวิจัยโดยตรง** — ทุนวิจัย/OKR เป็นของอีกโปรเจกต์ (KKU) คนละเรื่องกับ Thunder

ข้อกำหนด:
- ใช้ข้อมูลจริงเท่านั้น อย่าแต่งตัวเลข ไม่มีข้อมูลบอกตรงๆ · เงินใช้หน่วยบาท · ไม่ใส่อีโมจิ
- ตอบเนื้อหาทันที ไม่ต้องเกริ่นถึงกระบวนการคิดหรือเครื่องมือ

=== ข้อมูล ณ วันที่ ${today} ===

${await teamRoster()}

[โปรเจกต์ทุนวิจัย KKU — แยกต่างหาก ตอบเฉพาะเมื่อถูกถามถึงทุนวิจัย/OKR โดยตรงเท่านั้น]
เป้า OKR ปี ${okr.year + 543}: ${formatBaht(okr.target)} · ผลจริง ${formatBaht(okr.actual)} (${okr.percent}%) · ${okr.totalGrants} ทุน${
    grants.length ? `\n[รายการทุน]\n${statusSummary}\n${grantLines}` : ""
  }`;
}

export async function saveChat(role: "user" | "assistant", content: string) {
  await db.chatMessage.create({ data: { role, content } });
}

export async function getChatHistory(limit = 50) {
  const rows = await db.chatMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.reverse();
}
