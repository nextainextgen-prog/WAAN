import fs from "node:fs";
import path from "node:path";

// ===== ข้อมูลเอกสารคืนเงินหัก ณ ที่จ่าย (รูปแบบตรงต้นฉบับ) =====
export interface MemoAttachment {
  label: string;
  imagePath: string;
}

export interface RefundMemoData {
  docNo: string;
  date: string; // วันที่ออกเอกสาร (พ.ศ.)
  subject: string; // เรื่อง เช่น "คืนเงินลูกค้าหัก ณ ที่จ่าย"
  topupDate: string; // วันที่โอน/เติมเครดิต (พ.ศ. เต็ม)
  topupTime: string; // เวลาตัดเครดิต เช่น "13.16"
  user: string; // ชื่อผู้ใช้งาน (User)
  serviceName: string; // ชื่อบริการ
  packageName: string; // แพ็กเกจ
  months: number;
  amount: number; // จำนวนเงินที่โอน/เติมเข้าระบบ
  whtRate: number; // อัตราหัก ณ ที่จ่าย (ร้อยละ)
  whtAmount: number; // จำนวนเงินหัก ณ ที่จ่าย
  overpay: number; // ยอดส่วนเกิน (0 ถ้าไม่มี)
  refund: number; // ยอดรวมที่คืน
  bank: string;
  accountNo: string;
  accountName: string;
  attachments: MemoAttachment[];
  signed?: boolean; // ดราฟแรก = false (ยังไม่ใส่ลายเซ็น) · กด "เซ็นเลย" = true
}

const COMPANY = {
  name: "บริษัท ธันเดอร์ โซลูชั่น จำกัด",
  address: "เลขที่ 629 หมู่ 6 ตำบลบ้านเป็ด อำเภอเมืองขอนแก่น จังหวัดขอนแก่น 40000",
  taxId: "เลขประจำตัวผู้เสียภาษี 0465566000017",
  tel: "โทร. 02-114-8423",
};

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
function logoUri(): string {
  return dataUri(assetPath("public/brand/thunder-logo.png"), "image/png");
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

const C = { navy: "#16345E", blue: "#1C7FC4", ink: "#1c1c1c", line: "#000", gray: "#8a97a6" };

export function buildRefundMemoHtml(d: RefundMemoData): string {
  const logo = logoUri();
  const sig = signatureUri();
  const dot = "(...................................)";
  const totalPages = 1 + d.attachments.length;

  // ข้อความ prose ตรงต้นฉบับ (เติมเฉพาะช่องว่างจากข้อมูลจริง)
  const overpayLine =
    d.overpay > 0
      ? ` และมียอดชำระเกินจากการโอนอีกจำนวน ${baht(d.overpay)} บาท`
      : "";

  const attachmentPages = d.attachments
    .map(
      (a, i) => `
    <section class="page attach">
      <div class="attach-head"><div class="tag">เอกสารแนบ</div><h2>${escapeHtml(a.label)}</h2></div>
      <div class="attach-img"><img src="${dataUri(a.imagePath, guessMime(a.imagePath))}" alt="${escapeHtml(a.label)}"/></div>
      ${companyFoot(d.docNo, i + 2, totalPages)}
    </section>`,
    )
    .join("");

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><style>
  ${fontFace()}
  @page{size:A4;margin:0}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Sarabun',sans-serif;color:${C.ink};font-size:10pt;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{width:210mm;height:297mm;padding:14mm 15mm 10mm;position:relative;page-break-after:always;background:#fff}
  .page:last-child{page-break-after:auto}
  .logo{height:40px;margin-bottom:6px}
  .memo-h{text-align:center;font-weight:700;font-size:13pt;margin:2px 0 8px;letter-spacing:.03em}
  /* frame */
  .frame{border:1.2px solid ${C.line}}
  .hrow{display:flex;border-bottom:1.2px solid ${C.line}}
  .hcell{padding:6px 12px;font-size:10pt}
  .hcell.l{flex:0 0 63%;border-right:1.2px solid ${C.line}}
  .hcell.r{flex:1}
  .brow{display:flex;min-height:216mm}
  .bleft{flex:0 0 63%;border-right:1.2px solid ${C.line};padding:14px 16px;display:flex;flex-direction:column}
  .bright{flex:1;padding:16px 12px;text-align:center}
  .bleft p{margin-bottom:11px;text-align:left}
  .bank{margin:8px 0 4px;line-height:1.7}
  .center{text-align:center}
  .sigblock{text-align:center;margin-top:14px}
  .sigblock .sigimg{height:40px;margin-bottom:-8px;position:relative;z-index:2}
  .sigblock .dots{margin-top:6px}
  .sigblock .nm{margin-top:2px}
  .approver .dots{margin-bottom:2px}
  /* company footer */
  .cfoot{position:absolute;left:15mm;right:15mm;bottom:8mm;font-size:8pt;color:#3a3a3a;line-height:1.4}
  .cfoot .pg{position:absolute;right:0;bottom:0;color:#666}
  /* attachment */
  .attach{padding:14mm 14mm 10mm}
  .attach-head{border-bottom:2px solid ${C.navy};padding-bottom:7px;margin-bottom:10px}
  .attach-head .tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.14em;color:${C.blue};text-transform:uppercase}
  .attach-head h2{font-weight:700;font-size:17px;color:${C.navy};margin-top:2px}
  .attach-img{display:flex;align-items:flex-start;justify-content:center;height:250mm}
  .attach-img img{max-width:100%;max-height:250mm;object-fit:contain;border:1px solid #d9e2ee;border-radius:4px;box-shadow:0 2px 10px rgba(22,52,94,.08)}
  </style></head><body>

  <section class="page">
    ${logo ? `<img class="logo" src="${logo}" alt="Thunder Solution"/>` : `<div style="font-weight:700;color:${C.navy};font-size:18px">THUNDER SOLUTION</div>`}
    <div class="memo-h">บันทึก</div>
    <div class="frame">
      <div class="hrow">
        <div class="hcell l">เรื่อง ${escapeHtml(d.subject)}</div>
        <div class="hcell r">วันที่ ${escapeHtml(d.date)}</div>
      </div>
      <div class="hrow">
        <div class="hcell l">เรียน ผู้จัดการทั่วไปและฝ่ายบัญชี</div>
        <div class="hcell r">จาก ฝ่ายงานบริการลูกค้า</div>
      </div>
      <div class="brow">
        <div class="bleft">
          <p>เมื่อวันที่ ${escapeHtml(d.topupDate)} ลูกค้าชื่อผู้ใช้งาน (User) ${escapeHtml(d.user)} ชื่อบริการ ${escapeHtml(d.serviceName)} ได้ดำเนินการโอนเงินเพื่อเติมเครดิตเข้าสู่ระบบ เพื่อชำระค่าบริการแพ็กเกจ ${escapeHtml(d.packageName)} ระยะเวลาใช้งาน ${d.months} เดือน เป็นจำนวนเงิน ${baht(d.amount)} บาท</p>
          <p>ทั้งนี้ ระบบได้ทำการตัดเครดิตเพื่อต่ออายุใช้งานเมื่อวันที่ ${escapeHtml(d.topupDate)} เวลา ${escapeHtml(d.topupTime)} น.</p>
          <p>ต่อมา ลูกค้าได้มีการขอหัก ณ ที่จ่ายในอัตราร้อยละ ${d.whtRate} เป็นจำนวนเงิน ${baht(d.whtAmount)} บาท หลังจากโอนยอดเงินเต็มจำนวน และระบบต่ออายุเรียบร้อยแล้ว${overpayLine}</p>
          <p>ลูกค้าได้จัดส่งใบหักภาษี ณ ที่จ่าย ให้ทางบริษัทเรียบร้อย</p>
          <p>จึงขอให้บริษัทดำเนินการโอนเงินคืนตามจำนวนดังกล่าว (จำนวน ${baht(d.refund)} บาท) ไปยังบัญชีที่ระบุดังนี้</p>
          <div class="bank">
            บัญชีธนาคาร ${escapeHtml(d.bank)}<br>
            หมายเลขบัญชี ${escapeHtml(d.accountNo)}<br>
            ชื่อบัญชี ${escapeHtml(d.accountName)}<br>
            (จำนวนเงิน ${baht(d.refund)} บาท)
          </div>
          <div class="center" style="margin-top:14px">จึงเรียนมาเพื่อดำเนินการ</div>
          <div class="sigblock">
            ${d.signed && sig ? `<img class="sigimg" src="${sig}" alt="ลายเซ็น"/>` : ""}
            <div class="dots">${dot}</div>
            <div class="nm">นาย จิรภัทร์ ภูครองหิน</div>
            <div>ตำแหน่ง หัวหน้าฝ่ายบริการลูกค้า</div>
            <div>วันที่ ${escapeHtml(d.date)}</div>
          </div>
          <div class="sigblock" style="margin-top:22px">
            <div class="dots">${dot}</div>
            <div class="nm">นางสาวศิริลักษณ์ ชอบธรรม</div>
            <div>ผู้จัดการฝ่ายบริการลูกค้า</div>
            <div>วันที่ ${escapeHtml(d.date)}</div>
          </div>
        </div>
        <div class="bright">
          <div class="sigblock approver" style="margin-top:36px">
            <div class="dots">${dot}</div>
            <div>ผู้ตรวจสอบ / อนุมัติ</div>
            <div class="nm" style="margin-top:10px">นาย สมพร เสริฐศรี</div>
            <div>ประธานเจ้าหน้าที่ฝ่ายปฏิบัติการ</div>
            <div>วันที่ ${escapeHtml(d.date)}</div>
          </div>
        </div>
      </div>
    </div>
    ${companyFoot(d.docNo, 1, totalPages)}
  </section>

  ${attachmentPages}
  </body></html>`;
}

function companyFoot(docNo: string, page: number, total: number): string {
  return `<div class="cfoot">
    ${escapeHtml(COMPANY.name)}<br>
    ${escapeHtml(COMPANY.address)}<br>
    ${escapeHtml(COMPANY.taxId)}<br>
    ${escapeHtml(COMPANY.tel)}
    <span class="pg">หน้า ${page}/${total}</span>
  </div>`;
}
