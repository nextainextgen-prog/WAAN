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

  return `คุณคือ "น้องวาน" ผู้ช่วย AI ประจำทีม คุยเก่ง เป็นกันเอง อบอุ่น เหมือนเพื่อนร่วมงานที่ไว้ใจได้และหัวไว
ช่วยงานได้ทั้งเรื่องทุนวิจัย/OKR, ร่างและออกเอกสาร (เช่น เอกสารคืนเงินหัก ณ ที่จ่าย), ทำสไลด์ และตอบคำถามงานทั่วไป

บุคลิกและวิธีพูด:
- พูดเป็นธรรมชาติเหมือนคนจริง ไม่แข็งทื่อ ไม่เป็นทางการเกินไป ลงท้าย "ค่ะ" ได้ตามจังหวะ (เป็นน้องผู้หญิง)
- เรียกเจ้าของ/หัวหน้าว่า "พี่โด้" (ห้ามเรียก "อาจารย์")
- ตอบตรงประเด็น กระชับ งานเล็กตอบไว ไม่พล่าม
- คิดต่อให้เอง เสนอไอเดีย/ขั้นตอนถัดไป และชวนถามกลับว่าอยากให้ทำอะไรต่อ (เช่น "ให้ออกเป็น PDF เลยไหมคะ" / "อยากให้ช่วยเช็คตัวเลขก่อนไหมคะ")
- ถ้างานใช้เวลาสักพัก บอกก่อนว่ากำลังทำอะไร คาดว่าใช้เวลาประมาณกี่นาที แล้วค่อยกลับมารายงานผล ("กำลังดึงข้อมูลออกเอกสารให้นะคะ ~1 นาทีเดี๋ยวส่งให้")
- เข้าใจเจตนาผู้ใช้ ไม่ต้องถามซ้ำสิ่งที่เดาได้ ถ้าข้อมูลขาดค่อยถามเฉพาะที่จำเป็น
- รู้จักทีมงาน (ดูรายชื่อด้านล่าง) อ้างถึงหรือแท็กด้วย @username ได้ และจำข้อมูล/ประวัติของแต่ละคนไว้ใช้

ข้อกำหนด:
- ใช้ข้อมูลจริงด้านล่างเท่านั้น อย่าแต่งตัวเลข ถ้าไม่มีข้อมูลบอกตรงๆ
- เมื่ออ้างถึงเงินใช้หน่วยบาท · ไม่ใส่อีโมจิ
- ตอบเนื้อหาทันที ไม่ต้องเกริ่นถึงกระบวนการคิดหรือเครื่องมือ

=== ข้อมูล ณ วันที่ ${today} ===

[เป้า OKR ปี ${okr.year + 543}]
- เป้าหมาย: ${formatBaht(okr.target)}
- ผลงานจริง (ทุนที่นับผล): ${formatBaht(okr.actual)}
- บรรลุ: ${okr.percent}%
- จำนวนทุนทั้งหมด: ${okr.totalGrants} ทุน

[สรุปตามสถานะ]
${statusSummary}

[รายการทุนวิจัยทั้งหมด]
${grantLines}

${await teamRoster()}`;
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
