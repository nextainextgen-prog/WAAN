import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findAffByUsername, type AffRecord } from "./sheets";
import { extractAffDoc, type AffDocFields } from "./aff-extract";
import { renderHtmlToPng } from "./html-pdf";
import { pdfFileToPngs } from "./pdf-to-images";
import { fetchSystemWithdraw, thunderSessionReady, type SystemWithdraw } from "./thunder-admin";

// ===== normalize สำหรับเทียบภาษาไทย =====
function normName(s: string): string {
  return s.replace(/นางสาว|นาย|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\./g, "").replace(/\s+/g, "");
}
function normAddr(s: string): string {
  return s
    .replace(/ตำบล|ต\./g, "")
    .replace(/อำเภอ|อ\./g, "")
    .replace(/จังหวัด|จ\./g, "")
    .replace(/หมู่ที่|หมู่|ม\./g, "")
    .replace(/[\s./,-]/g, "");
}
function normBank(s: string): string {
  return s.replace(/ธนาคาร|จำกัด|\(มหาชน\)|bank/gi, "").replace(/\s+/g, "");
}
function digits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

export interface FieldCheck {
  label: string;
  docValue: string;
  refValue: string;
  refSource: string; // แหล่งอ้างอิง เช่น "ชีต"
  ok: boolean;
}

export interface AffCheckResult {
  fields: AffDocFields;
  record: AffRecord | null;
  checks: FieldCheck[];
  mathOk: boolean;
  whtOk: boolean;
  allOk: boolean;
  system: SystemWithdraw | null;
  systemNote?: string;
  amountMatchesSystem: boolean | null; // null = ยังไม่ได้เทียบ (ไม่มี session/ไม่พบ)
  reportText: string;
  images: { path: string; caption: string }[];
}

const OK = "✅"; // ✅
const NO = "❌"; // ❌

// เทียบเอกสาร ↔ ชีต + ตรวจคณิตในเอกสาร (เฟส 1 — ยังไม่แตะระบบหลังบ้าน)
export async function runAffCheck(
  pdfPath: string,
  adminText: string,
  outDir?: string,
): Promise<AffCheckResult> {
  const dir = outDir || fs.mkdtempSync(path.join(os.tmpdir(), "waan-aff-"));
  const fields = await extractAffDoc(pdfPath, adminText);
  const record = fields.username ? await findAffByUsername(fields.username) : null;

  const checks: FieldCheck[] = [];
  if (record) {
    const sheetName = `${record.firstName} ${record.lastName}`.trim();
    const rows: [string, string, string, (a: string, b: string) => boolean][] = [
      ["ชื่อ-สกุล", fields.name, sheetName, (a, b) => normName(a) === normName(b)],
      ["เลขผู้เสียภาษี/บัตรปชช.", fields.taxId, record.idCard, (a, b) => digits(a) === digits(b)],
      ["ที่อยู่", fields.address, record.address, (a, b) => normAddr(a) === normAddr(b)],
      ["ธนาคาร", fields.bank, record.bank, (a, b) => normBank(a) === normBank(b)],
      ["เลขบัญชี", fields.account, record.account, (a, b) => digits(a) === digits(b)],
    ];
    for (const [label, docValue, refValue, cmp] of rows) {
      checks.push({ label, docValue, refValue, refSource: "ชีต", ok: cmp(docValue, refValue) });
    }
  }

  // ตรวจคณิตในเอกสาร: รวม − หัก = สุทธิ, และ หัก ≈ 3% ของรวม
  const { gross, wht, net } = fields;
  const mathOk =
    gross != null && wht != null && net != null && Math.abs(gross - wht - net) < 0.01;
  const whtOk = gross != null && wht != null && Math.abs(wht - gross * 0.03) < 0.5;

  // ===== เฟส 2: เทียบกับระบบหลังบ้าน (ถ้ามี session) =====
  let system: SystemWithdraw | null = null;
  let systemNote: string | undefined;
  let amountMatchesSystem: boolean | null = null;
  let systemShot: { path: string; caption: string } | null = null;
  if (fields.username && thunderSessionReady()) {
    const res = await fetchSystemWithdraw(fields.username);
    if (res.error === "session_expired") {
      systemNote = "เซสชันระบบหลังบ้านหมดอายุ — รัน npm run thunder:auth ใหม่";
    } else if (res.error === "not_found") {
      systemNote = `ไม่พบยูสเซอร์ "${fields.username}" ในระบบหลังบ้าน`;
    } else if (res.error && res.error !== "no_session") {
      systemNote = `อ่านระบบหลังบ้านไม่สำเร็จ: ${res.error}`;
    }
    system = res.data;
    if (system && system.amount != null && net != null) {
      amountMatchesSystem = Math.abs(system.amount - net) < 0.01;
    }
    if (res.screenshot) {
      const p = path.join(dir, "system-confirm.png");
      fs.writeFileSync(p, res.screenshot);
      systemShot = { path: p, caption: "ยืนยันจากระบบหลังบ้าน (จัดการถอน)" };
    }
  }

  const identityOk = checks.length > 0 && checks.every((c) => c.ok);
  // ยอดถือว่าถูกเมื่อ: เทียบระบบแล้วตรง (ยึดระบบ) หรือยังไม่ได้เทียบระบบก็ใช้คณิตในเอกสาร
  const amountOk = amountMatchesSystem === false ? false : mathOk && whtOk;
  const allOk = identityOk && amountOk && amountMatchesSystem !== false;

  // ===== รายงานข้อความ =====
  const L: string[] = [];
  L.push(`รายงานตรวจเอกสาร Affiliate — ยูสเซอร์ ${fields.username || "-"} (${fields.name || "-"})`);
  L.push("");
  if (!record) {
    L.push(`${NO} ไม่พบยูสเซอร์ "${fields.username}" ในชีตลูกค้า AFF — โปรดตรวจสอบชื่อผู้ใช้อีกครั้ง`);
  } else {
    L.push("เทียบเอกสารกับชีตลูกค้า AFF:");
    for (const c of checks) {
      const mark = c.ok ? OK : NO;
      if (c.ok) {
        L.push(`${mark} ${c.label}: ${c.docValue || "-"}`);
      } else {
        L.push(`${mark} ${c.label}: เอกสาร "${c.docValue || "-"}" ≠ ชีต "${c.refValue || "-"}"`);
      }
    }
  }
  L.push("");
  L.push("ยอดเงินในเอกสาร:");
  L.push(
    `${mathOk ? OK : NO} รวม ${fmt(gross)} − หัก ณ ที่จ่าย ${fmt(wht)} = สุทธิ ${fmt(net)}${
      mathOk ? "" : "  (คำนวณไม่ตรง)"
    }`,
  );
  L.push(`${whtOk ? OK : NO} ภาษีหัก ณ ที่จ่าย ${fmt(wht)} = 3% ของ ${fmt(gross)}`);
  L.push(`วันที่ในเอกสาร: ${fields.date || "-"}`);

  // ระบบหลังบ้าน
  L.push("");
  if (system) {
    L.push("เทียบกับระบบหลังบ้าน (จัดการถอน):");
    if (amountMatchesSystem === true) {
      L.push(`${OK} ยอดจ่ายจริง: เอกสาร ${fmt(net)} = ระบบ ${fmt(system.amount)} (ยึดตามระบบ)`);
    } else if (amountMatchesSystem === false) {
      L.push(`${NO} ยอดจ่ายจริง: เอกสาร ${fmt(net)} ≠ ระบบ ${fmt(system.amount)} — ต้องแก้ให้ตรงระบบ`);
    }
    if (system.account && fields.account) {
      L.push(
        `${digits(system.account) === digits(fields.account) ? OK : NO} เลขบัญชีในระบบ: ${system.account || "-"}`,
      );
    }
    if (system.status) L.push(`สถานะในระบบ: ${system.status}`);
  } else if (systemNote) {
    L.push(`(ระบบหลังบ้าน: ${systemNote})`);
  } else {
    L.push("(ยังไม่ได้เชื่อมระบบหลังบ้าน — รัน npm run thunder:auth เพื่อเปิดการเทียบยอดจากระบบ)");
  }

  L.push("");
  L.push(
    allOk
      ? `สรุป: ข้อมูลถูกต้องครบถ้วน พร้อมอนุมัติ ${OK}`
      : `สรุป: พบจุดที่ต้องตรวจทาน โปรดดูรายการ ${NO} ด้านบน`,
  );
  const reportText = L.join("\n");

  // ===== ภาพประกอบ =====
  const images: { path: string; caption: string }[] = [];

  // 1) ภาพยืนยันจากชีต (เรนเดอร์ตารางเอง)
  if (record) {
    const sheetPng = path.join(dir, "sheet-confirm.png");
    const png = await renderHtmlToPng(sheetConfirmHtml(record, checks), { width: 900 });
    fs.writeFileSync(sheetPng, png);
    images.push({ path: sheetPng, caption: "ยืนยันข้อมูลจากชีตลูกค้า AFF (แท็บ ใช้จริง)" });
  }

  // 2) ภาพยืนยันจากระบบหลังบ้าน (ถ้ามี)
  if (systemShot) images.push(systemShot);

  // 3) หน้า 2 ของเอกสาร (ภาพยืนยันตัวตน/บัตร ปชช.)
  try {
    const pages = await pdfFileToPngs(pdfPath, dir, { maxPages: 2, scale: 2 });
    if (pages[1]) images.push({ path: pages[1], caption: "หน้า 2 ของเอกสาร (ยืนยันตัวตน)" });
  } catch {
    /* ไม่มีหน้า 2 ก็ข้าม */
  }

  return {
    fields,
    record,
    checks,
    mathOk,
    whtOk,
    allOk,
    system,
    systemNote,
    amountMatchesSystem,
    reportText,
    images,
  };
}

function fmt(n: number | null): string {
  return n == null ? "-" : n.toLocaleString("th-TH", { minimumFractionDigits: 2 });
}

function esc(s: string): string {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

// ตารางยืนยันจากชีต — ธีมสว่าง เรียบ มืออาชีพ ไม่มีอิโมจิ
function sheetConfirmHtml(r: AffRecord, checks: FieldCheck[]): string {
  const okMap = new Map(checks.map((c) => [c.label, c.ok]));
  const row = (label: string, value: string, key?: string) => {
    const state = key && okMap.has(key) ? (okMap.get(key) ? "ok" : "no") : "";
    const badge =
      state === "ok" ? '<span class="b ok">ตรงกับเอกสาร</span>' : state === "no" ? '<span class="b no">ไม่ตรง</span>' : "";
    return `<tr><td class="k">${esc(label)}</td><td class="v">${esc(value || "-")}${badge}</td></tr>`;
  };
  return `<!doctype html><html lang="th"><head><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Noto Sans Thai',sans-serif;background:#f1f5f9;color:#0f172a;padding:28px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .head{background:#1e293b;color:#fff;padding:16px 22px}
  .head h1{font-size:18px;font-weight:700}
  .head p{font-size:13px;color:#cbd5e1;margin-top:2px}
  table{width:100%;border-collapse:collapse}
  td{padding:12px 22px;border-top:1px solid #eef2f7;font-size:15px;vertical-align:top}
  td.k{color:#64748b;font-weight:500;width:34%}
  td.v{color:#0f172a;font-weight:600}
  .b{display:inline-block;margin-left:10px;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;vertical-align:middle}
  .b.ok{background:#dcfce7;color:#15803d}
  .b.no{background:#fee2e2;color:#b91c1c}
</style></head><body>
  <div class="card">
    <div class="head"><h1>ยืนยันข้อมูลจากชีตลูกค้า AFF</h1><p>แท็บ ใช้จริง · ยูสเซอร์ ${esc(r.username)}</p></div>
    <table>
      ${row("ชื่อผู้ใช้งาน", r.username)}
      ${row("ชื่อ-สกุล", `${r.firstName} ${r.lastName}`, "ชื่อ-สกุล")}
      ${row("เลขบัตร/ผู้เสียภาษี", r.idCard, "เลขผู้เสียภาษี/บัตรปชช.")}
      ${row("ที่อยู่", r.address, "ที่อยู่")}
      ${row("ธนาคาร", r.bank, "ธนาคาร")}
      ${row("เลขบัญชี", r.account, "เลขบัญชี")}
      ${r.shipAddress ? row("ที่อยู่จัดส่งเอกสาร", r.shipAddress) : ""}
    </table>
  </div>
</body></html>`;
}
