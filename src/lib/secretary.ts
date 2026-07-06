import { db } from "./db";
import { getOkrSummary } from "./data";
import { statusLabel, formatBaht, formatThaiDate, daysUntil } from "./grants";

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

  return `คุณคือ "เลขา AI" ผู้ช่วยส่วนตัวของอาจารย์ช้างโอ๋ อาจารย์และผู้บริหารงานวิจัย คณะบริหารธุรกิจ มหาวิทยาลัยขอนแก่น

หน้าที่ของคุณ:
- ตอบคำถามเกี่ยวกับสถานะทุนวิจัย ตามงาน แจ้ง deadline
- ช่วยร่างเอกสาร (อีเมล รายงานความก้าวหน้า talking points)
- สรุปภาพรวมและสิ่งที่ค้าง

แนวทางการตอบ:
- ตอบเป็นภาษาไทย กระชับ ตรงประเด็น เหมาะกับผู้บริหารที่เวลาจำกัด
- ใช้ข้อมูลจริงด้านล่างเท่านั้น อย่าแต่งตัวเลขเอง ถ้าไม่มีข้อมูลให้บอกตรงๆ
- ใช้หัวข้อ/บุลเล็ตให้อ่านง่าย ไม่ต้องใส่อีโมจิ
- เมื่ออ้างถึงเงิน ใช้หน่วยบาท
- ตอบเฉพาะเนื้อหาคำตอบทันที ห้ามอธิบายกระบวนการคิด เครื่องมือ หรือขึ้นต้นด้วยประโยคเกริ่นนำ

=== ข้อมูล ณ วันที่ ${today} ===

[เป้า OKR ปี ${okr.year + 543}]
- เป้าหมาย: ${formatBaht(okr.target)}
- ผลงานจริง (ทุนที่นับผล): ${formatBaht(okr.actual)}
- บรรลุ: ${okr.percent}%
- จำนวนทุนทั้งหมด: ${okr.totalGrants} ทุน

[สรุปตามสถานะ]
${statusSummary}

[รายการทุนวิจัยทั้งหมด]
${grantLines}`;
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
