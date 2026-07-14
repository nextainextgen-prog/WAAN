import fs from "node:fs";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

/**
 * "ใบสำคัญรับเงิน" ค่าคอมมิชชั่น Affiliate — บริษัท ธันเดอร์ โซลูชั่น
 * ยึดต้นฉบับบริษัทเป๊ะ 100%: ใช้ไฟล์ต้นฉบับ public/templates/aff-receipt-blank.pdf เป็นฐาน
 * แล้ว "วางข้อมูลทับ" ลงบนช่องว่างด้วย pdf-lib (จุด/เส้น/ฟอนต์/ระยะ = ของบริษัทเดิมทั้งหมด)
 * เปลี่ยนเฉพาะ: วันที่ · ชื่อ/ที่อยู่/เลขภาษี · จำนวนเงิน · จำนวนเงินตัวหนังสือ · ลายเซ็นชื่อผู้รับเงิน
 * พิกัดทั้งหมดวัดจาก PDF ต้นฉบับจริง (A4 595.28×841.89pt, origin ล่างซ้าย, y=baseline)
 */

// ===== แปลงจำนวนเงิน → ตัวหนังสือภาษาไทย (รองรับสตางค์/ถ้วน) =====
const TH_DIGIT = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const TH_POS = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

function readInt(input: string): string {
  const n = input.replace(/^0+/, "") || "0";
  if (n === "0") return "ศูนย์";
  const len = n.length;
  if (len > 6) {
    const head = n.slice(0, len - 6);
    const tail = n.slice(len - 6);
    return readInt(head) + "ล้าน" + (/^0+$/.test(tail) ? "" : readInt(tail));
  }
  let out = "";
  for (let i = 0; i < len; i++) {
    const d = +n[i];
    const pos = len - i - 1;
    if (d === 0) continue;
    if (pos === 0 && d === 1 && len > 1) out += "เอ็ด";
    else if (pos === 1 && d === 2) out += "ยี่สิบ";
    else if (pos === 1 && d === 1) out += "สิบ";
    else out += TH_DIGIT[d] + TH_POS[pos];
  }
  return out;
}

// 1775.10 → "หนึ่งพันเจ็ดร้อยเจ็ดสิบห้าบาทสิบสตางค์" · 3686 → "สามพันหกร้อยแปดสิบหกบาทถ้วน"
export function bahtText(amount: number): string {
  const val = Math.round((amount || 0) * 100) / 100;
  const [b, s] = val.toFixed(2).split(".");
  const baht = parseInt(b, 10);
  const sat = parseInt(s, 10);
  if (baht === 0 && sat === 0) return "ศูนย์บาทถ้วน";
  let out = "";
  if (baht > 0) out += readInt(String(baht)) + "บาท";
  out += sat > 0 ? readInt(String(sat)) + "สตางค์" : "ถ้วน";
  return out;
}

// แยกจำนวนเงินเป็น บาท (มีคอมมา) | สตางค์ (2 หลัก)
function splitAmount(n: number): { baht: string; satang: string } {
  const val = Math.round((n || 0) * 100) / 100;
  const [b, s] = val.toFixed(2).split(".");
  return { baht: Number(b).toLocaleString("en-US"), satang: s };
}

// ===== ข้อมูลใบสำคัญรับเงิน =====
export interface ReceiptItem {
  desc: string; // (ต้นฉบับพิมพ์ "ค่าคอมมิชชั่นจากการแนะนำผู้ใช้" มาแล้ว — ปกติไม่ต้องวาดทับ)
  amount: number;
}

export interface ReceiptData {
  day: string; // วันที่ เช่น "1"
  month: string; // เลขเดือน เช่น "05"
  yearBE: string; // พ.ศ. เช่น "2569"
  prefix: string; // นาย / นาง / นางสาว
  name: string; // ชื่อ-สกุล ไม่รวมคำนำหน้า
  taxId: string;
  houseNo: string;
  moo: string;
  road: string; // ถนน (ไม่มีใส่ "-")
  tambon: string;
  amphoe: string;
  changwat: string;
  bank?: string; // ธนาคารรับเงิน (ยึดจากระบบ) → แสดง "รับเงินโดย ☑โอนเข้าบัญชี"
  account?: string; // เลขบัญชีรับเงิน (ยึดจากระบบ)
  items: ReceiptItem[]; // แถวรายการ (แถวแรกต้นฉบับมี desc อยู่แล้ว วาดเฉพาะยอด)
  gross: number; // รวมจำนวนเงิน (ก่อนหัก) = ยอดโบนัสก่อนหน้า
  whtRate: number; // อัตราหัก ณ ที่จ่าย (ปกติ 3)
  wht: number; // ยอดหัก
  net: number; // จำนวนเงินทั้งสิ้น (สุทธิ)
  idCardImagePath?: string; // หน้า 2 = สำเนาบัตร ปชช. ผู้รับเงิน
}

function assetPath(...p: string[]): string {
  return path.join(process.cwd(), ...p);
}
const TEMPLATE_PDF = assetPath("public/templates/aff-receipt-blank.pdf");
// ฟอนต์ที่วางทับ = TH SarabunPSK ตัวเดียวกับต้นฉบับเป๊ะ (นำมาจาก MS Office DFonts)
const SARABUN_TTF = assetPath("src/assets/fonts/THSarabun.ttf");
const COMPANY = { name: "บริษัท ธันเดอร์ โซลูชั่น จำกัด" };

// พิกัดช่อง (วัดจากต้นฉบับ) — cx = จุดกึ่งกลางช่อง, y = baseline
// baht/satang = ขอบขวาสำหรับชิดขวา (right-align)
const POS = {
  thi: { cx: 430.7, y: 734.5, size: 14, max: 185 }, // "ที่" = ชื่อบริษัท
  day: { cx: 371.2, y: 700.3 },
  month: { cx: 433.3, y: 700.3 },
  year: { cx: 500.5, y: 700.3 },
  name: { cx: 110.0, y: 679.3, max: 405 }, // ข้าพเจ้า — ชิดซ้ายหลัง label (ไม่ใช่กึ่งกลาง)
  taxId: { cx: 249.5, y: 658.4, max: 150 },
  houseNo: { cx: 419.5, y: 658.4, max: 64 },
  moo: { cx: 494.0, y: 658.4, max: 48 },
  road: { cx: 139.0, y: 637.4, max: 90 },
  tambon: { cx: 252.7, y: 637.4, max: 80 },
  amphoe: { cx: 358.5, y: 637.4, max: 62 },
  changwat: { cx: 471.0, y: 637.4, max: 95 },
  bahtRight: 536.0,
  satRight: 557.0,
  rowItem: 548.2,
  rowSum: 427.9,
  rowWht: 403.7,
  rowNet: 367.7,
  netText: { cx: 321.0, y: 367.7, max: 232 },
  signName: { cx: 290.7, y: 268.2, max: 165 }, // ลงชื่อ ... ผู้รับเงิน
  signParen: { cx: 297.5, y: 231.1, max: 145 }, // ( ชื่อเต็ม )
};

export async function buildReceiptPdf(d: ReceiptData): Promise<Buffer> {
  const pdf = await PDFDocument.load(fs.readFileSync(TEMPLATE_PDF));
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fs.readFileSync(SARABUN_TTF), { subset: true });
  const page = pdf.getPage(0);
  const BODY = 14.5;

  const put = (
    text: string | number | null | undefined,
    cx: number,
    y: number,
    align: "center" | "right" | "left" = "center",
    size = BODY,
    maxWidth?: number,
  ) => {
    if (text == null || text === "") return;
    const t = String(text);
    let s = size;
    if (maxWidth) while (s > 7 && font.widthOfTextAtSize(t, s) > maxWidth) s -= 0.5;
    const w = font.widthOfTextAtSize(t, s);
    const x = align === "center" ? cx - w / 2 : align === "right" ? cx - w : cx;
    page.drawText(t, { x, y, size: s, font, color: rgb(0, 0, 0) });
  };

  // ---- หัวเอกสาร ----
  put(COMPANY.name, POS.thi.cx, POS.thi.y, "center", POS.thi.size, POS.thi.max);
  put(d.day, POS.day.cx, POS.day.y);
  put(d.month, POS.month.cx, POS.month.y);
  put(d.yearBE, POS.year.cx, POS.year.y);

  // ---- ผู้รับเงิน + ที่อยู่ ----
  put(`${d.prefix}${d.name}`, POS.name.cx, POS.name.y, "left", BODY, POS.name.max);
  put(d.taxId, POS.taxId.cx, POS.taxId.y, "center", BODY, POS.taxId.max);
  put(d.houseNo, POS.houseNo.cx, POS.houseNo.y, "center", BODY, POS.houseNo.max);
  put(d.moo, POS.moo.cx, POS.moo.y, "center", BODY, POS.moo.max);
  put(d.road || "-", POS.road.cx, POS.road.y, "center", BODY, POS.road.max);
  put(d.tambon, POS.tambon.cx, POS.tambon.y, "center", BODY, POS.tambon.max);
  put(d.amphoe, POS.amphoe.cx, POS.amphoe.y, "center", BODY, POS.amphoe.max);
  put(d.changwat, POS.changwat.cx, POS.changwat.y, "center", BODY, POS.changwat.max);

  // ---- ตารางยอด (ชิดขวาในคอลัมน์ บาท/สตางค์) ----
  const g = splitAmount(d.gross);
  const wtax = splitAmount(d.wht);
  const nnet = splitAmount(d.net);
  const item0 = d.items[0] ? splitAmount(d.items[0].amount) : g;
  put(item0.baht, POS.bahtRight, POS.rowItem, "right");
  put(item0.satang, POS.satRight, POS.rowItem, "right");
  put(g.baht, POS.bahtRight, POS.rowSum, "right");
  put(g.satang, POS.satRight, POS.rowSum, "right");
  put(wtax.baht, POS.bahtRight, POS.rowWht, "right");
  put(wtax.satang, POS.satRight, POS.rowWht, "right");
  put(nnet.baht, POS.bahtRight, POS.rowNet, "right");
  put(nnet.satang, POS.satRight, POS.rowNet, "right");

  // ---- รับเงินโดย ☑ โอนเข้าบัญชี [ธนาคาร เลขบัญชี] — ต่อท้ายบรรทัด "ดังรายการต่อไปนี้ :-" (ยึดบัญชีจากระบบ) ----
  // auto-fit: ใช้ขนาดใหญ่สุด (≤ BODY ให้เท่าตัวอื่น) ที่ยังพอดีในช่องว่างขวาของบรรทัด
  if (d.bank || d.account) {
    const y = 595.5, startX = 172, rightLimit = 556;
    const acct = `${d.bank || ""} ${d.account || ""}`.replace(/\s+/g, " ").trim();
    const parts = ["รับเงินโดย", "เงินสด", "โอนเข้าบัญชี", acct];
    const gap = 4;
    const widthAt = (sz: number) => {
      const box = sz * 0.62 + gap; // กล่องเช็ก 2 อัน
      return parts.reduce((w, t) => w + font.widthOfTextAtSize(t, sz) + gap, 0) + box * 2;
    };
    let size = BODY;
    while (size > 9 && startX + widthAt(size) > rightLimit) size -= 0.5;
    const bs = size * 0.62; // ขนาดกล่องสัมพันธ์ฟอนต์
    let x = startX;
    const seg = (t: string) => { page.drawText(t, { x, y, size, font, color: rgb(0, 0, 0) }); x += font.widthOfTextAtSize(t, size) + gap; };
    const chk = (checked: boolean) => {
      page.drawRectangle({ x, y: y - 0.5, width: bs, height: bs, borderWidth: 0.9, borderColor: rgb(0, 0, 0) });
      if (checked) {
        page.drawLine({ start: { x: x + bs * 0.18, y: y + bs * 0.5 }, end: { x: x + bs * 0.42, y: y + bs * 0.15 }, thickness: 1, color: rgb(0, 0, 0) });
        page.drawLine({ start: { x: x + bs * 0.42, y: y + bs * 0.15 }, end: { x: x + bs * 0.9, y: y + bs * 0.92 }, thickness: 1, color: rgb(0, 0, 0) });
      }
      x += bs + gap;
    };
    seg("รับเงินโดย"); chk(false); seg("เงินสด"); chk(true); seg("โอนเข้าบัญชี"); seg(acct);
  }

  // ---- จำนวนเงินตัวหนังสือ (ในวงเล็บ) ----
  put(bahtText(d.net), POS.netText.cx, POS.netText.y, "center", BODY, POS.netText.max);

  // ---- ลายเซ็นผู้รับเงิน ----
  put(d.name, POS.signName.cx, POS.signName.y, "center", BODY, POS.signName.max);
  // ต้นฉบับมี "(...)" อยู่แล้ว → วาดเฉพาะชื่อกึ่งกลางในวงเล็บ (ไม่ใส่วงเล็บซ้ำ)
  put(`${d.prefix}${d.name}`, POS.signParen.cx, POS.signParen.y, "center", BODY, POS.signParen.max);

  // ---- หน้า 2: สำเนาบัตร ปชช. ผู้รับเงิน (แนบท้าย) ----
  if (d.idCardImagePath && fs.existsSync(d.idCardImagePath)) {
    const bytes = fs.readFileSync(d.idCardImagePath);
    const ext = path.extname(d.idCardImagePath).toLowerCase();
    const img = ext === ".png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const p2 = pdf.addPage([595.28, 841.89]);
    p2.drawText("เอกสารแนบ — สำเนาบัตรประจำตัวประชาชนผู้รับเงิน", {
      x: 72, y: 790, size: 15, font, color: rgb(0.086, 0.204, 0.369),
    });
    const maxW = 451, maxH = 660;
    const sc = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * sc, h = img.height * sc;
    p2.drawImage(img, { x: (595.28 - w) / 2, y: 770 - h, width: w, height: h });
  }

  return Buffer.from(await pdf.save());
}
