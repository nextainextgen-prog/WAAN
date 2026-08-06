/**
 * ตัวจัดรูปแบบข้อความของ Vex (เจ้าของสั่ง 4 ส.ค. 2026: "แจ้งได้ห่วยมาก ไม่เป็นระเบียบ ตัวติดกัน อ่านยาก")
 *
 * กติกา:
 *  - หัวข้อเป็นตัวหนา HTML จริง (Telegram parse_mode=HTML) ไม่ใช่ ** ดิบ ๆ
 *  - รายการ = บรรทัดละรายการเสมอ ห้ามยัดคั่นด้วย · ต่อกันเป็นพืด
 *  - บล็อกที่มี parseMode จะไม่ถูกซอยบับเบิล (explodeTextSend ข้ามให้)
 */

export interface VexBlock {
  text: string;
  parseMode: "HTML";
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

export interface VexItem {
  main: string; // บรรทัดหลัก
  sub?: string; // บรรทัดรอง (เยื้อง)
  lead?: string; // ตัวนำหน้า เช่น "1." หรือ "•"
}

/** ลิสต์มาตรฐาน: หัวข้อ + รายการละบรรทัด + หมายเหตุท้าย */
export function vexList(opts: {
  title: string;
  items: (string | VexItem)[];
  note?: string;
  empty?: string;
  numbered?: boolean;
}): VexBlock {
  const items = opts.items.map((it, i) => {
    const o: VexItem = typeof it === "string" ? { main: it } : it;
    const lead = o.lead ?? (opts.numbered ? `${i + 1}.` : "·");
    const head = `${lead} ${esc(o.main)}`;
    return o.sub ? `${head}\n    (${esc(o.sub)})` : head;
  });
  const body = items.length ? items.join("\n") : `(${esc(opts.empty || "ไม่มีรายการ")})`;
  const parts = [`<b>${esc(opts.title)}</b>`, "", body];
  if (opts.note) parts.push("", esc(opts.note));
  return { text: parts.join("\n"), parseMode: "HTML" };
}

/**
 * หลายหัวข้อในข้อความเดียว (บรีฟเช้า/รายงาน)
 *
 * ออกแบบใหม่ 6 ส.ค. 2026 — เจ้าของบอกว่า "รายงานต่าง ๆ มันดูเฉย ๆ มาก
 * ให้เพิ่มองค์ประกอบหรือการจัดเรียงใหม่ เพิ่มอิโมจิให้มืออาชีพแนวนี้ 📤 🚀"
 *
 * ของเดิม: หัวข้อตัวหนาล้วน + ทุกบรรทัดขึ้นต้นด้วย "·" เหมือนกันหมด
 * → กวาดตาแล้วแยกไม่ออกว่าอันไหนสำคัญ อันไหนแค่รายการ
 *
 * ของใหม่
 *  - หัวข้อมีไอคอนนำ (สัญลักษณ์ล้วน ไม่ใช่หน้าคน — กติกาเดิมของเจ้าของ)
 *  - `sub` ต่อท้ายหัวข้อใส่ในวงเล็บ ใช้ใส่ยอดรวม/จำนวนรายการ แยกจากชื่อหัวข้อ
 *    (เจ้าของสั่ง 6 ส.ค. 2026: "เลิกใช้ <i> ใช้วงเล็บธรรมดาแทน" — ทำที่ต้นทางเลย
 *     ไม่พึ่ง applyStyleRules แปลงให้ทีหลัง เพราะมันทำบ้างไม่ทำบ้าง ผลไม่คงเส้นคงวา)
 *  - รายการที่มี "ค่า" (ราคา/เวลา) จัดให้ค่าอยู่ท้ายบรรทัดเสมอ อ่านไล่ลงมาได้
 *  - `accent` = บรรทัดที่ต้องสะดุดตา (เตือน/ตัวเลขติดลบ) ทำเป็นตัวหนา
 *  - เส้นคั่นบาง ๆ ก่อนบรรทัดสรุปปิดท้าย
 */
export interface VexSection {
  head: string;
  lines: (string | VexRow)[];
  icon?: string;   // ไอคอนนำหัวข้อ
  sub?: string;    // ข้อมูลประกอบหัวข้อ (ยอดรวม/จำนวน)
  accent?: boolean; // ทั้งหัวข้อนี้คือเรื่องที่ต้องสะดุดตา
}

export interface VexRow {
  main: string;
  value?: string;  // ค่าที่จะไปอยู่ท้ายบรรทัด (ราคา/เวลา/สถานะ)
  lead?: string;   // ตัวนำหน้าแทน "·"
  bold?: boolean;
  sub?: string;    // บรรทัดย่อยใต้รายการ (ข้อมูลที่ยังขาด/หมายเหตุ) — ย่อหน้าเข้าไป ใส่วงเล็บ
}

export function vexSections(opts: {
  title: string;
  titleIcon?: string;
  subtitle?: string;
  sections: VexSection[];
  footer?: string;
  footerIcon?: string;
}): VexBlock {
  const head = `${opts.titleIcon ? `${opts.titleIcon} ` : ""}<b>${esc(opts.title)}</b>`;
  const parts: string[] = [head];
  if (opts.subtitle) parts.push(`(${esc(opts.subtitle)})`);

  for (const s of opts.sections) {
    if (!s.lines.length) continue;
    const label = `${s.icon ? `${s.icon} ` : ""}<b>${esc(s.head)}</b>${s.sub ? ` (${esc(s.sub)})` : ""}`;
    parts.push("", label);
    for (const it of s.lines) {
      const r: VexRow = typeof it === "string" ? { main: it } : it;
      const lead = r.lead ?? "·";
      const body = r.bold || s.accent ? `<b>${esc(r.main)}</b>` : esc(r.main);
      parts.push(r.value ? `${lead} ${body} — ${esc(r.value)}` : `${lead} ${body}`);
      if (r.sub) parts.push(`   (${esc(r.sub)})`);
    }
  }

  if (opts.footer) parts.push("", "─────────", `${opts.footerIcon ? `${opts.footerIcon} ` : ""}${esc(opts.footer)}`);
  return { text: parts.join("\n"), parseMode: "HTML" };
}

/** ตัวเลขเงินแบบอ่านง่าย */
export function baht(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} ฿`;
}

/** "3 วันก่อน" / "เมื่อวาน" / "วันนี้" */
export function agoText(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86400_000);
  if (days <= 0) return "วันนี้";
  if (days === 1) return "เมื่อวาน";
  if (days < 7) return `${days} วันก่อน`;
  if (days < 30) return `${Math.floor(days / 7)} สัปดาห์ก่อน`;
  return d.toLocaleDateString("th-TH-u-ca-gregory", { day: "numeric", month: "short" });
}
