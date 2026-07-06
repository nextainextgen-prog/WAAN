import fs from "node:fs";
import path from "node:path";

// ===== ข้อมูลเอกสารคืนเงินส่วนต่างหัก ณ ที่จ่าย =====
export interface MemoAttachment {
  label: string; // เช่น "หนังสือรับรองการหักภาษี ณ ที่จ่าย"
  imagePath: string; // path ไฟล์ภาพในเครื่อง
}

export interface RefundMemoData {
  docNo: string; // เลขที่เอกสาร
  date: string; // วันที่ (พ.ศ.)
  customerName: string; // ชื่อลูกค้า
  serviceUser: string; // ยูส/บริการ
  packageName: string; // แพ็กเกจ
  months: number; // จำนวนเดือน
  topupDate: string; // รอบเติมเครดิต
  priceNet: number; // ค่าบริการสุทธิที่ต้องชำระจริง
  paid: number; // ยอดที่ลูกค้าชำระเข้ามา
  whtRefund: number; // ส่วนต่างหัก ณ ที่จ่ายที่คืน
  overpay: number; // ยอดส่วนเกินที่คืน
  totalRefund: number; // รวมยอดคืน
  bank: string;
  accountNo: string;
  accountName: string;
  attachments: MemoAttachment[];
}

const SIGNERS = [
  { name: "นายจิรภัทร์ ภูครองหิน", title: "หัวหน้าฝ่ายบริการลูกค้า", signed: true },
  { name: "นางสาวศิริลักษณ์ ชอบธรรม", title: "ผู้จัดการฝ่ายบริการลูกค้า", signed: false },
];
const APPROVER = { name: "นายสมพร เสริฐศรี", title: "ประธานเจ้าหน้าที่ฝ่ายปฏิบัติการ", role: "ผู้ตรวจสอบ / อนุมัติ" };

function baht(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// อ่านไฟล์เป็น data URI (ฝังในตัว HTML เพื่อให้ render แน่นอน)
function dataUri(filePath: string, mime: string): string {
  try {
    const b = fs.readFileSync(filePath);
    return `data:${mime};base64,${b.toString("base64")}`;
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
  return `
  @font-face{font-family:'Sarabun';font-weight:400;src:url('${reg}') format('truetype')}
  @font-face{font-family:'Sarabun';font-weight:600;src:url('${semi}') format('truetype')}
  @font-face{font-family:'Sarabun';font-weight:700;src:url('${bold}') format('truetype')}`;
}

function logoUri(): string {
  return dataUri(assetPath("public/brand/thunder-logo.png"), "image/png");
}
function signatureUri(): string {
  return dataUri(assetPath("public/signature.png"), "image/png");
}

const C = {
  navy: "#16345E",
  blue: "#1C7FC4",
  ink: "#1a2432",
  muted: "#5a6b80",
  line: "#dbe4ef",
  soft: "#f4f8fc",
  gray: "#8a97a6",
};

export function buildRefundMemoHtml(d: RefundMemoData): string {
  const logo = logoUri();
  const sig = signatureUri();

  const attachmentPages = d.attachments
    .map(
      (a) => `
    <section class="page attach">
      <div class="attach-head">
        <div class="tag">เอกสารแนบ</div>
        <h2>${escapeHtml(a.label)}</h2>
      </div>
      <div class="attach-img"><img src="${dataUri(a.imagePath, guessMime(a.imagePath))}" alt="${escapeHtml(a.label)}"/></div>
      <div class="foot"><span>${escapeHtml(d.docNo)}</span><span>บริษัท ธันเดอร์ โซลูชั่น จำกัด</span></div>
    </section>`,
    )
    .join("");

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><style>
  ${fontFace()}
  @page{size:A4;margin:0}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Sarabun',sans-serif;color:${C.ink};font-size:13.5px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{width:210mm;height:297mm;padding:14mm 16mm 12mm;position:relative;page-break-after:always;background:#fff;overflow:hidden}
  .page:last-child{page-break-after:auto}
  /* header */
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid ${C.navy};padding-bottom:12px;margin-bottom:6px}
  .top .logo{height:42px}
  .top .doctag{text-align:right;font-size:11px;color:${C.muted}}
  .top .doctag b{color:${C.navy};font-size:12px;letter-spacing:.02em}
  .memo-title{text-align:center;margin:8px 0 2px}
  .memo-title h1{font-weight:700;font-size:22px;color:${C.navy};letter-spacing:.04em}
  .memo-title .en{font-size:11px;color:${C.gray};letter-spacing:.28em;text-transform:uppercase}
  /* info table */
  .info{width:100%;border-collapse:collapse;margin:10px 0 2px;border:1px solid ${C.line}}
  .info td{padding:6px 12px;border:1px solid ${C.line};font-size:13px;vertical-align:top}
  .info .k{color:${C.muted};width:16%;white-space:nowrap}
  .info .v{width:34%;font-weight:600;color:${C.ink}}
  /* body */
  .body{margin-top:11px;text-indent:0}
  .body p{margin-bottom:6px;text-align:justify}
  .lead{text-indent:2.5em}
  .items{margin:3px 0 7px;padding-left:0;list-style:none}
  .items li{position:relative;padding:2px 0 2px 22px;font-size:13.5px}
  .items li::before{content:"";position:absolute;left:6px;top:11px;width:5px;height:5px;border-radius:50%;background:${C.blue}}
  /* amount box */
  .calc{border:1px solid ${C.line};border-radius:10px;overflow:hidden;margin:8px 0 10px}
  .calc .row{display:flex;justify-content:space-between;padding:6.5px 16px;font-size:13.5px;border-bottom:1px solid ${C.line}}
  .calc .row:last-child{border-bottom:none}
  .calc .row .lab{color:${C.muted}}
  .calc .row .val{font-weight:600;font-variant-numeric:tabular-nums}
  .calc .row.head{background:${C.soft};color:${C.navy};font-weight:700}
  .calc .row.total{background:${C.navy};color:#fff}
  .calc .row.total .lab{color:#cfe0f2}.calc .row.total .val{color:#fff;font-size:16px}
  /* bank */
  .bank{border-left:4px solid ${C.blue};background:${C.soft};padding:10px 16px;border-radius:0 8px 8px 0;margin:4px 0 0}
  .bank .bt{font-weight:700;color:${C.navy};margin-bottom:3px;font-size:12.5px}
  .bank .brow{display:flex;gap:8px;font-size:13.5px}.bank .brow .bk{color:${C.muted};width:110px}
  /* signatures */
  .signs{display:flex;justify-content:space-between;gap:24px;margin-top:20px}
  .sign{flex:1;text-align:center}
  .sign .sigimg{height:42px;margin-bottom:-4px}
  .sign .line{border-bottom:1px dotted ${C.muted};width:78%;margin:8px auto 5px;height:32px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:2px}
  .sign .nm{font-weight:600;font-size:13px}
  .sign .tt{font-size:11.5px;color:${C.muted}}
  .sign .dt{font-size:11px;color:${C.gray};margin-top:2px}
  .approver{margin-top:16px;display:flex;justify-content:center}
  .approver .box{text-align:center;width:46%}
  .approver .role{font-size:11px;color:${C.blue};font-weight:700;letter-spacing:.02em;margin-bottom:4px}
  /* footer */
  .foot{position:absolute;left:18mm;right:18mm;bottom:10mm;display:flex;justify-content:space-between;font-size:10px;color:${C.gray};border-top:1px solid ${C.line};padding-top:6px}
  /* attachment page */
  .attach{padding:14mm 14mm 12mm}
  .attach-head{border-bottom:2px solid ${C.navy};padding-bottom:7px;margin-bottom:10px}
  .attach-head .tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.14em;color:${C.blue};text-transform:uppercase}
  .attach-head h2{font-weight:700;font-size:17px;color:${C.navy};margin-top:2px}
  .attach-img{display:flex;align-items:flex-start;justify-content:center;height:250mm}
  .attach-img img{max-width:100%;max-height:250mm;width:auto;height:auto;object-fit:contain;border:1px solid ${C.line};border-radius:6px;box-shadow:0 2px 12px rgba(22,52,94,.08)}
  .cornermark{position:absolute;top:0;right:0;border-width:0 64px 64px 0;border-style:solid;border-color:transparent ${C.navy} transparent transparent}
  </style></head><body>

  <section class="page">
    <div class="top">
      ${logo ? `<img class="logo" src="${logo}" alt="Thunder Solution"/>` : `<div style="font-weight:700;color:${C.navy};font-size:20px">THUNDER<span style="color:${C.gray}"> SOLUTION</span></div>`}
      <div class="doctag"><b>เลขที่ ${escapeHtml(d.docNo)}</b><br>วันที่ ${escapeHtml(d.date)}</div>
    </div>
    <div class="memo-title"><div class="en">Internal Memo</div><h1>บันทึกข้อความ</h1></div>

    <table class="info">
      <tr><td class="k">เรื่อง</td><td class="v" colspan="3">คืนเงินส่วนต่างหัก ณ ที่จ่าย และยอดส่วนเกิน</td></tr>
      <tr><td class="k">เรียน</td><td class="v">ผู้จัดการทั่วไป และฝ่ายบัญชี</td><td class="k">จาก</td><td class="v">ฝ่ายงานบริการลูกค้า</td></tr>
    </table>

    <div class="body">
      <p class="lead">ตามที่ลูกค้าผู้ใช้งาน <b>${escapeHtml(d.customerName)}</b> (บริการ ${escapeHtml(d.serviceUser)}) ได้ดำเนินการชำระเงินเพื่อต่ออายุแพ็กเกจ รอบเติมเครดิตวันที่ ${escapeHtml(d.topupDate)} โดยมีรายละเอียดดังนี้</p>
      <ul class="items">
        <li>เติมเงินเพื่อชำระค่าแพ็กเกจ <b>${escapeHtml(d.packageName)}</b> จำนวน ${d.months} เดือน</li>
        <li>ราคาค่าบริการที่ต้องชำระจริง (สุทธิ) ${baht(d.priceNet)} บาท</li>
        <li>ลูกค้าดำเนินการชำระเงินเข้ามาแล้ว จำนวน ${baht(d.paid)} บาท</li>
      </ul>
      <p>ภายหลังการทำรายการ เมื่อตรวจสอบยอดชำระจริงเทียบกับยอดเงินที่ลูกค้าชำระเข้ามา พบว่ามีส่วนต่างที่ต้องคืนให้แก่ลูกค้า ตามรายละเอียดการคำนวณดังนี้</p>

      <div class="calc">
        <div class="row head"><span class="lab">รายการ</span><span class="val">จำนวน (บาท)</span></div>
        <div class="row"><span class="lab">ยอดค่าบริการสุทธิที่ต้องชำระจริง</span><span class="val">${baht(d.priceNet)}</span></div>
        <div class="row"><span class="lab">ยอดเงินที่ลูกค้าชำระเข้ามา</span><span class="val">${baht(d.paid)}</span></div>
        <div class="row"><span class="lab">ส่วนต่างหัก ณ ที่จ่าย ที่ต้องคืน</span><span class="val">${baht(d.whtRefund)}</span></div>
        <div class="row"><span class="lab">ยอดส่วนเกินที่ต้องคืน</span><span class="val">${baht(d.overpay)}</span></div>
        <div class="row total"><span class="lab">รวมยอดเงินที่ต้องคืนลูกค้า</span><span class="val">${baht(d.totalRefund)} บาท</span></div>
      </div>

      <p>ดังนั้น เพื่อให้ยอดรายรับสอดคล้องกับค่าบริการตามแพ็กเกจ และถูกต้องตามระบบบัญชี จึงขออนุมัติดำเนินการคืนเงินจำนวน <b>${baht(d.totalRefund)} บาท</b> โดยโอนเข้าบัญชีธนาคารของลูกค้าตามรายละเอียดดังนี้</p>
      <div class="bank">
        <div class="bt">รายละเอียดบัญชีรับเงินคืน</div>
        <div class="brow"><span class="bk">ธนาคาร</span><span>${escapeHtml(d.bank)}</span></div>
        <div class="brow"><span class="bk">เลขที่บัญชี</span><span>${escapeHtml(d.accountNo)}</span></div>
        <div class="brow"><span class="bk">ชื่อบัญชี</span><span>${escapeHtml(d.accountName)}</span></div>
      </div>
    </div>

    <div class="signs">
      ${SIGNERS.map(
        (s) => `<div class="sign">
        <div class="line">${s.signed && sig ? `<img class="sigimg" src="${sig}" alt="ลายเซ็น"/>` : ""}</div>
        <div class="nm">(${escapeHtml(s.name)})</div>
        <div class="tt">${escapeHtml(s.title)}</div>
        <div class="dt">วันที่ ................................</div>
      </div>`,
      ).join("")}
    </div>

    <div class="approver"><div class="box">
      <div class="role">${escapeHtml(APPROVER.role)}</div>
      <div class="line" style="margin:8px auto 6px;width:70%"></div>
      <div class="nm">(${escapeHtml(APPROVER.name)})</div>
      <div class="tt">${escapeHtml(APPROVER.title)}</div>
      <div class="dt">วันที่ ................................</div>
    </div></div>

    <div class="foot"><span>${escapeHtml(d.docNo)}</span><span>บริษัท ธันเดอร์ โซลูชั่น จำกัด · ฝ่ายบริการลูกค้า</span></div>
  </section>

  ${attachmentPages}
  </body></html>`;
}

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
function guessMime(p: string): string {
  const e = path.extname(p).toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".pdf") return "application/pdf";
  return "application/octet-stream";
}
