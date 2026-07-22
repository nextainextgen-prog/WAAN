import fs from "node:fs";
import path from "node:path";
import { bahtText } from "./baht-text";

export { bahtText };

// ===== เอกสารบันทึกภายใน "ขอคืนเงินลูกค้า" (ยึดแบบฟอร์มใหม่ Thunder / EasySlip) =====
export interface MemoAttachment {
  label: string;
  imagePath: string;
}

export type Brand = "thunder" | "easyslip";
export type DocType = "general" | "wht";

export interface RefundMemoData {
  brand?: Brand; // ค่าเริ่มต้น thunder — เลือกตามที่แอดมินระบุบนหัวเรื่อง (Thunder/EasySlip)
  docType?: DocType; // ชนิดเอกสาร: general = คืนเงินทั่วไป (ยกเลิก/ใช้ไม่ได้) · wht = ขอหักภาษี ณ ที่จ่ายย้อนหลัง
  docNo: string; // เลขที่ (รูปแบบ ปีเดือนลำดับ เช่น 20260701)
  date: string; // วันที่ออกเอกสาร (ปัจจุบัน)

  // ---- ย่อหน้าเปิดเรื่อง (ช่องว่างในความเรียง) ----
  serviceLabel?: string; // ชื่อบริการ/ลูกค้า ที่เปิดเรื่อง (ลูกค้าบริการ ___ / ไม่ใช้งานบริการ ___ ต่อ)
  reason?: string; // เนื่องจาก ___

  // ---- ตารางรายละเอียด 1-8 ----
  user: string; // 1. ยูสเซอร์
  userId?: string; // 1. ไอดียูสเซอร์
  companyName?: string; // 2. ลูกค้าบริษัท : บริษัท/ห้างหุ้นส่วน ___ จำกัด
  topupDate: string; // 3. เติมเงินเข้ามาวันที่
  amount: number; // 3. จำนวนเงินที่เติมเครดิตเข้ามา
  purchaseDate?: string; // 4. วันที่ (ซื้อบริการ)
  packageName: string; // 4. แพ็คเกจ
  months: number; // 4. จำนวนเดือน
  netPrice: number; // 5. จำนวนเงินที่ซื้อบริการ
  remainingCredit?: number; // 6. เครดิตในระบบก่อนขอคืนคงเหลือ
  whtDate?: string; // (เคส wht) วันที่หักภาษี ณ ที่จ่าย ตามเอกสารฉบับจริง — (whtAmount ใช้ field legacy ด้านล่าง)
  refund: number; // 7. จำนวนเงินที่ต้องโอนคืนลูกค้าทั้งสิ้น
  refundText?: string; // 7. จำนวนเงินแบบตัวอักษร (เติมอัตโนมัติจาก refund)
  bank: string; // 8. บัญชีธนาคาร
  accountNo: string; // 8. เลขที่บัญชี
  accountName: string; // 8. ชื่อบัญชี

  // ---- เอกสารแนบ ----
  attachChecks?: boolean[]; // ติ๊กเอกสารแนบ (general 4 · wht 5) — ค่าเริ่มต้น = ติ๊กทุกช่อง
  attachNote?: string; // ข้อ 4 รายละเอียดเอกสารแนบอื่นๆ (วานวิเคราะห์จากไฟล์/ภาพที่แนบ)
  attachments: MemoAttachment[];

  // ---- ผู้ลงนาม ----
  signed?: boolean; // ใส่ลายเซ็นผู้จัดทำ (กด "เซ็นเลย")

  // ---- legacy (ใช้ใน caption/validate/ตั้งชื่อไฟล์) ----
  serviceName: string; // ชื่อลูกค้า/บริษัท (ตั้งชื่อไฟล์)
  serviceType?: string;
  subject?: string;
  topupTime?: string;
  whtRate?: number;
  whtAmount?: number;
  discount?: number;
  overpay?: number;
}

const BRANDS: Record<Brand, { logo: string; nameTh: string; nameEn: string; address: string }> = {
  thunder: {
    logo: "public/brand/memo-thunder-logo.png",
    nameTh: "บริษัท ธันเดอร์ โซลูชั่น จำกัด",
    nameEn: "THUNDER SOLUTION CO., LTD.",
    address: "เลขที่ 629 หมู่ที่ 6 ตำบลบ้านเป็ด อำเภอเมืองขอนแก่น จังหวัดขอนแก่น 40000",
  },
  easyslip: {
    logo: "public/brand/memo-easyslip-logo.png",
    nameTh: "บริษัท อีซี่สลิป จำกัด",
    nameEn: "Easy Slip CO., LTD.",
    address: "เลขที่ 629 หมู่ที่ 6 ตำบลบ้านเป็ด อำเภอเมืองขอนแก่น จังหวัดขอนแก่น 40000",
  },
};

// ผู้ลงนามทั้ง 3 ระดับ (ล็อกชื่อ) — เว้นช่องว่างเหนือ "ลงชื่อ" ไว้เซ็นจริง
const MAKER = { name: "นาย จิรภัทร์ ภูครองหิน", position: "หัวหน้าฝ่ายบริการลูกค้า" };
const REVIEWER = { name: "นางสาวศิริลักษณ์ ชอบธรรม", position: "ผู้จัดการฝ่ายบริการลูกค้า" };
const APPROVER = { name: "นาย สมพร เสริฐศรี", position: "ประธานเจ้าหน้าที่ฝ่ายปฏิบัติการ" };

function baht(n: number): string {
  return (n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dataUri(filePath: string, mime: string): string {
  try {
    return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
  } catch {
    return "";
  }
}
function assetPath(...p: string[]): string {
  return path.join(process.cwd(), ...p);
}
function fontFace(): string {
  const reg = dataUri(assetPath("src/assets/fonts/Sarabun-Regular.ttf"), "font/ttf");
  const semi = dataUri(assetPath("src/assets/fonts/Sarabun-SemiBold.ttf"), "font/ttf");
  const bold = dataUri(assetPath("src/assets/fonts/Sarabun-Bold.ttf"), "font/ttf");
  return `@font-face{font-family:'Sarabun';font-weight:400;src:url('${reg}') format('truetype')}
  @font-face{font-family:'Sarabun';font-weight:600;src:url('${semi}') format('truetype')}
  @font-face{font-family:'Sarabun';font-weight:700;src:url('${bold}') format('truetype')}`;
}
function brandLogoUri(brand: Brand): string {
  return dataUri(assetPath(BRANDS[brand].logo), "image/png");
}
function signatureUri(): string {
  return dataUri(assetPath("public/signature.png"), "image/png");
}
function guessMime(p: string): string {
  const e = path.extname(p).toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}
function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const C = { navy: "#16345E", blue: "#1C7FC4", red: "#C0392B", ink: "#1c1c1c", line: "#000", gray: "#5a6472" };

// ช่องกรอก: มีค่า = ข้อความขีดเส้นใต้จุด · ไม่มีค่า = เส้นจุดว่าง
function fv(value: string | number | undefined | null, minWidth = "90px"): string {
  const v = value == null ? "" : String(value).trim();
  return v
    ? `<span class="fv">${escapeHtml(v)}</span>`
    : `<span class="fv blank" style="min-width:${minWidth}"></span>`;
}
// ช่องเงิน: >0 จึงเติม, ไม่งั้นเว้นว่าง
function fbaht(n: number | undefined, minWidth = "90px"): string {
  return n && n > 0 ? fv(baht(n), minWidth) : fv("", minWidth);
}
function chk(on: boolean): string {
  return `<span class="chk${on ? " on" : ""}"></span>`;
}

export function buildRefundMemoHtml(d: RefundMemoData): string {
  const brand = d.brand || "thunder";
  const B = BRANDS[brand];
  const logo = brandLogoUri(brand);
  const sig = signatureUri();
  const totalPages = 2 + d.attachments.length;
  const refundText = d.refundText || bahtText(d.refund);
  const isWht = (d.docType || "general") === "wht";
  const subject = isWht
    ? "ขอคืนเงินลูกค้า (กรณี ขอหักภาษี ณ ที่จ่าย ย้อนหลัง)"
    : "ขอคืนเงินลูกค้า (กรณีที่ลูกค้าลูกค้าใช้งานไม่ได้และต้องการขอคืนเงิน หรือ กรณีลูกค้ายกเลิกการใช้งาน )";

  const header = (page: number) => `
    <div class="head">
      ${logo ? `<img class="logo" src="${logo}" alt="${escapeHtml(B.nameEn)}"/>` : `<div class="logo-tx">${escapeHtml(B.nameEn)}</div>`}
      <div class="head-tx">
        <div class="co-th">${escapeHtml(B.nameTh)}</div>
        <div class="co-en">${escapeHtml(B.nameEn)}</div>
        <div class="conf"><span class="conf-en">CONFIDENTIAL INFORMATION</span> เอกสารควบคุมใช้เฉพาะภายในบริษัทฯ ห้ามเผยแพร่</div>
      </div>
    </div>`;

  const foot = (page: number) => `<div class="pg">หน้า <b>${page}</b> จาก <b>${totalPages}</b></div>`;

  // ---- ย่อหน้าเปิดเรื่อง (ต่างตาม docType) ----
  const intro = isWht
    ? `<p class="intro">&emsp;&emsp;ลูกค้าบริการ${fv(d.serviceLabel, "180px")} ได้มีการชำระเงิน ค่าบริการเข้าเต็มจำนวน โดยไม่มีการหักภาษี ณ ที่จ่ายไว้ก่อน ที่จะมีการจ่ายชำระค่าบริการ เมื่อ ลูกค้าชำระค่าบริการเข้ามาเสร็จสิ้นแล้ว จึงมีการแจ้ง ขอหัก ณ ที่จ่าย และลูกค้าได้มีการออกเอกสาร หนังสือรับรองการหักภาษี ณ ที่จ่าย (50ทวิ) ย้อนหลัง ลูกค้าได้มีการส่งเอกสารหนังสือรับการหัก ภาษี ณ ที่จ่าย ฉบับจริงมายัง ${escapeHtml(B.nameTh)} ที่อยู่ : ${escapeHtml(B.address)} พร้อมขอคืนเงิน ตามจำนวน ที่มีการหักภาษี ณ ที่จ่าย รายละเอียดดังนี้</p>`
    : `<p class="intro">&emsp;&emsp;ลูกค้าบริการ${fv(d.serviceLabel, "180px")} ได้มีการชำระเงิน ค่าบริการเข้ามาเต็มจำนวน เมื่อลูกค้าชำระค่าบริการเข้ามาเสร็จสิ้นแล้ว จึงมีความประสงค์ที่จะไม่ใช้งานบริการ${fv(d.serviceLabel, "150px")}ต่อ เนื่องจาก${fv(d.reason, "180px")} จึงทำการขอคืนเงินค่าบริการที่ได้มีการชำระเข้ามาไว้ โดยส่งเอกสารการขอเงินคืนมายัง ${escapeHtml(B.nameTh)} ที่อยู่ : ${escapeHtml(B.address)} พร้อมรายละเอียด ขอคืนเงิน ดังนี้</p>`;

  // ---- รายการ: general = 8 ข้อ · wht = 10 ข้อ (แทรก ยอดหักภาษี + วันที่หักภาษี ก่อนยอดโอนคืน) ----
  const rows: string[] = [
    `ยูสเซอร์: ${fv(d.user, "200px")}&emsp;ไอดียูสเซอร์: ${fv(d.userId, "150px")}`,
    `ลูกค้าบริษัท : บริษัท/ห้างหุ้นส่วน ${fv(d.companyName, "300px")} จำกัด`,
    `เติมเงินเข้ามาวันที่ : ${fv(d.topupDate, "150px")}&emsp;จำนวนเงินที่เติมเครดิตเข้ามา : ${fbaht(d.amount, "120px")} บาท`,
    `รายละเอียดบริการที่ลูกค้าซื้อ : วันที่ ${fv(d.purchaseDate, "120px")} แพ็คเกจ ${fv(d.packageName, "160px")} จำนวน ${fv(d.months ? String(d.months) : "", "40px")} เดือน`,
    `จำนวนเงินที่ซื้อบริการ : ${fbaht(d.netPrice, "150px")} บาท`,
    `เครดิตในระบบก่อนขอคืนคงเหลือจำนวน : ${fbaht(d.remainingCredit, "150px")} บาท`,
  ];
  if (isWht) {
    rows.push(`ลูกค้าต้องการหักภาษี ณ ที่จ่าย จำนวน : ${fbaht(d.whtAmount, "150px")} บาท`);
    rows.push(`วันที่ลูกค้าหักภาษี ณ ที่จ่าย (ตามเอกสารฉบับจริง) : ${fv(d.whtDate, "220px")}`);
  }
  rows.push(`จำนวนเงินที่ต้องโอนคืนลูกค้าทั้งสิ้น จำนวน : ${fbaht(d.refund, "120px")} บาท ( ${fv(refundText, "220px")} )`);
  rows.push(`ช่องทางโอนกลับ : บัญชีธนาคาร ${fv(d.bank, "160px")} เลขที่บัญชี ${fv(d.accountNo, "180px")}`);
  const list =
    rows.map((r, i) => `<div class="row"><span class="no">${i + 1}.</span> ${r}</div>`).join("") +
    `<div class="row indent">ชื่อบัญชี ${fv(d.accountName, "300px")}</div>`;

  // ---- บล็อกลงนาม ----
  const makerBlock = `
    <div class="sig">
      <div class="sig-title">ผู้จัดทำ</div>
      <div class="sig-line">ลงชื่อ <span class="sig-slot">${d.signed && sig ? `<img class="sig-img" src="${sig}" alt="ลายเซ็น"/>` : ""}<span class="dots"></span></span></div>
      <div class="sig-paren">( ${fv(MAKER.name, "220px")} )</div>
      <div class="sig-line">ตำแหน่ง ${fv(MAKER.position, "230px")}</div>
      <div class="sig-line">วันที่ ${fv(d.date, "180px")}</div>
    </div>`;

  const reviewerBlock = `
    <div class="sig">
      <div class="sig-title">ผู้ตรวจสอบ</div>
      <div class="sig-line sign-gap">ลงชื่อ <span class="sig-slot"><span class="dots"></span></span></div>
      <div class="sig-paren">( ${fv(REVIEWER.name, "220px")} )</div>
      <div class="sig-line">ตำแหน่ง ${fv(REVIEWER.position, "230px")}</div>
      <div class="sig-line">วันที่ ${fv(d.date, "180px")}</div>
    </div>`;

  const approverBlock = `
    <div class="sig">
      <div class="sig-title">ผู้อนุมัติ</div>
      <div class="approve-opts">${chk(false)} อนุมัติ&emsp;${chk(false)} ไม่อนุมัติ&emsp;${chk(false)} อื่น ๆ ${fv("", "160px")}</div>
      <div class="sig-line sign-gap">ลงชื่อ <span class="sig-slot"><span class="dots"></span></span></div>
      <div class="sig-paren">( ${fv(APPROVER.name, "220px")} )</div>
      <div class="sig-line">ตำแหน่ง ${fv(APPROVER.position, "230px")}</div>
      <div class="sig-line">วันที่ ${fv(d.date, "180px")}</div>
    </div>`;

  // เอกสารแนบ: general = 4 ข้อ · wht = 5 ข้อ (เพิ่ม 50ทวิ เป็นข้อ 1) · ติ๊กทุกช่องเสมอ
  const attachItems = isWht
    ? [
        "สำเนาเอกสารการหักภาษี ณ ที่จ่าย (50ทวิ)",
        "สำเนาสมุดบัญชีธนาคาร บริษัท ที่ต้องการให้โอนเงินคืน",
        "หลักฐานการชำระหรือสลิปที่ลูกค้ามีการโอนชำระค่าบริการเข้ามา",
        "ภาพประกอบหรือหลักฐาน ที่แสดงว่าลูกค้ามีการขอ หัก ณ ที่จ่าย",
        "รายละเอียดเอกสารแนบอื่นๆ",
      ]
    : [
        "สำเนาสมุดบัญชีธนาคาร บริษัท ที่ต้องการให้โอนเงินคืน",
        "หลักฐานการชำระหรือสลิปที่ลูกค้ามีการโอนชำระค่าบริการเข้ามา",
        "ภาพประกอบหรือหลักฐาน ที่แสดงว่าลูกค้ามีการขอคืนเงินค่าบริการ",
        "รายละเอียดเอกสารแนบอื่นๆ",
      ];
  const attachSection = `
    <div class="attach-list">
      <div class="al-title">เอกสารแนบ :</div>
      ${attachItems.map((t, i) => `<div class="al-item">${chk(d.attachChecks?.[i] ?? true)} ${i + 1}. ${escapeHtml(t)}</div>`).join("")}
      <div class="al-note">${d.attachNote ? escapeHtml(d.attachNote) : "<span class='dotline'></span><span class='dotline short'></span>"}</div>
    </div>`;

  // ---- หน้าเอกสารแนบ (คงเดิม) ----
  const attachmentPages = d.attachments
    .map(
      (a, i) => `
    <section class="page attach-page">
      ${header(i + 3)}
      <div class="attach-head"><div class="tag">เอกสารแนบ</div><h2>${escapeHtml(a.label)}</h2></div>
      <div class="attach-img"><img src="${dataUri(a.imagePath, guessMime(a.imagePath))}" alt="${escapeHtml(a.label)}"/></div>
      ${foot(i + 3)}
    </section>`,
    )
    .join("");

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><style>
  ${fontFace()}
  @page{size:A4;margin:0}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Sarabun',sans-serif;color:${C.ink};font-size:10pt;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{width:210mm;min-height:297mm;padding:12mm 16mm 14mm;position:relative;page-break-after:always;background:#fff}
  .page:last-child{page-break-after:auto}

  /* header */
  .head{display:flex;align-items:flex-start;gap:12px;padding-bottom:6px}
  .head .logo{height:46px;flex:0 0 auto}
  .head .logo-tx{font-weight:700;color:${C.navy};font-size:15pt}
  .head-tx{flex:1;text-align:center;padding-right:58px}
  .co-th{color:${C.navy};font-weight:700;font-size:13pt;line-height:1.2}
  .co-en{color:${C.gray};font-size:8.5pt;letter-spacing:.02em}
  .conf{font-size:8.5pt;margin-top:2px}
  .conf-en{color:${C.red};font-weight:600}
  .memo-title{text-align:center;font-size:11pt;margin:2px 0 8px}

  /* date/docno */
  .dateno{text-align:right;margin:2px 0 4px;line-height:1.9}
  .dateno .lbl{display:inline-block}

  /* subject */
  .subj{margin:2px 0}
  .subj b{font-weight:700}
  .subj .u{border-bottom:1px dotted #333;padding:0 3px}

  /* purpose table */
  table.purpose{width:100%;border-collapse:collapse;margin:8px 0 6px;font-size:10pt}
  table.purpose td{border:1.1px solid ${C.line};padding:5px 9px}

  .intro{text-indent:0;margin:8px 0 4px;text-align:justify;line-height:1.7}
  .row{margin:3px 0;line-height:1.7}
  .row .no{display:inline-block;min-width:16px}
  .row.indent{padding-left:18px}

  /* fill-in */
  .fv{border-bottom:1px dotted #333;padding:0 5px;white-space:nowrap}
  .fv.blank{display:inline-block}
  .chk{display:inline-block;width:12px;height:12px;border:1.2px solid ${C.line};position:relative;vertical-align:-1px;margin-right:5px}
  .chk.on::after{content:"";position:absolute;left:3px;top:0;width:4px;height:8px;border:solid ${C.line};border-width:0 1.7px 1.7px 0;transform:rotate(45deg)}

  /* page2 */
  .rule{border:0;border-top:1px solid #9aa4b0;margin:12px 0}
  .attach-list{margin-bottom:4px}
  .al-title{font-weight:700;margin-bottom:8px}
  .al-item{margin:6px 0;line-height:1.6}
  .al-note{margin-top:6px;min-height:34px}
  .dotline{display:block;border-bottom:1px dotted #333;height:16px}
  .dotline.short{width:36%}

  .sig{margin-top:2px}
  .sig-title{font-weight:700;margin-bottom:6px}
  .sig-line{margin:5px 0;line-height:1.6}
  .sig-line.sign-gap{margin-top:30px}
  .sig-paren{margin:3px 0 3px 42px}
  .sig-slot{position:relative;display:inline-block}
  .sig-slot .dots{display:inline-block;width:280px;border-bottom:1px dotted #333;vertical-align:middle}
  .sig-slot .sig-img{position:absolute;left:24px;bottom:-2px;height:38px}
  .approve-opts{margin:4px 0 8px}

  /* attachment pages (คงเดิม) */
  .attach-page{padding:12mm 14mm 14mm}
  .attach-head{border-bottom:2px solid ${C.navy};padding-bottom:7px;margin:8px 0 10px}
  .attach-head .tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.14em;color:${C.blue};text-transform:uppercase}
  .attach-head h2{font-weight:700;font-size:16px;color:${C.navy};margin-top:2px}
  /* ไม่ fix height (กันรูปถูก page-break ดันตกหน้า) · จำกัดสูงรูปให้พอดีหน้า A4 หลังหัก header+หัวข้อ */
  .attach-img{display:flex;align-items:flex-start;justify-content:center}
  .attach-img img{max-width:100%;max-height:205mm;object-fit:contain;border:1px solid #d9e2ee;border-radius:4px;box-shadow:0 2px 10px rgba(22,52,94,.08)}

  .pg{position:absolute;right:16mm;bottom:8mm;font-size:9pt;color:#333}
  </style></head><body>

  <section class="page">
    ${header(1)}
    <div class="memo-title">บันทึกภายใน (Internal Memo)</div>
    <div class="dateno">
      <div>วันที่ ${fv(d.date, "220px")}</div>
      <div>เลขที่ ${fv(d.docNo, "220px")}</div>
    </div>
    <div class="subj"><b>เรื่อง</b> <span class="u">${escapeHtml(subject)}</span></div>
    <div class="subj"><b>เรียน</b> <span class="u">ผู้จัดการทั่วไป พร้อมทั้ง ฝ่ายบัญชีและการเงิน</span></div>
    <table class="purpose">
      <tr>
        <td>${chk(false)} เพื่อทราบ</td>
        <td>${chk(false)} เพื่อพิจารณาอนุมัติ</td>
        <td>${chk(true)} เพื่อดำเนินการ</td>
        <td>${chk(false)} อื่นๆ ${fv("", "80px")}</td>
      </tr>
      <tr>
        <td colspan="2">แผนกที่ส่งเอกสาร : บริการลูกค้า</td>
        <td colspan="2">แผนกที่รับเอกสาร : บัญชี /การเงิน</td>
      </tr>
    </table>
    ${intro}
    ${list}
    ${foot(1)}
  </section>

  <section class="page">
    ${header(2)}
    <hr class="rule"/>
    ${attachSection}
    <hr class="rule"/>
    ${makerBlock}
    <hr class="rule"/>
    ${reviewerBlock}
    <hr class="rule"/>
    ${approverBlock}
    <hr class="rule"/>
    ${foot(2)}
  </section>

  ${attachmentPages}
  </body></html>`;
}
