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
    return o.sub ? `${head}\n    <i>${esc(o.sub)}</i>` : head;
  });
  const body = items.length ? items.join("\n") : `<i>${esc(opts.empty || "ไม่มีรายการ")}</i>`;
  const parts = [`<b>${esc(opts.title)}</b>`, "", body];
  if (opts.note) parts.push("", esc(opts.note));
  return { text: parts.join("\n"), parseMode: "HTML" };
}

/** หลายหัวข้อในข้อความเดียว (บรีฟเช้า/รายงาน) — เว้นบรรทัดระหว่างหัวข้อเสมอ */
export function vexSections(opts: {
  title: string;
  subtitle?: string;
  sections: { head: string; lines: string[] }[];
  footer?: string;
}): VexBlock {
  const parts: string[] = [`<b>${esc(opts.title)}</b>`];
  if (opts.subtitle) parts.push(esc(opts.subtitle));
  for (const s of opts.sections) {
    if (!s.lines.length) continue;
    parts.push("", `<b>${esc(s.head)}</b>`, ...s.lines.map((l) => `· ${esc(l)}`));
  }
  if (opts.footer) parts.push("", esc(opts.footer));
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
