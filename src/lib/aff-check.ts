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

// แถวเปรียบเทียบ 3 แหล่ง: เอกสาร / ชีต / ระบบ
interface CmpRow {
  label: string;
  doc: string;
  sheet: string;
  system: string;
  sheetMatch: boolean | null; // ชีตตรงเอกสารไหม (null = ไม่มีข้อมูลในชีต)
  systemMatch: boolean | null; // ระบบตรงเอกสารไหม
  ok: boolean; // ผ่านตามแหล่งชี้ขาด
  auth: "sheet" | "system"; // แหล่งชี้ขาด
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

  const { gross, wht, net } = fields;
  const mathOk = gross != null && wht != null && net != null && Math.abs(gross - wht - net) < 0.01;
  const whtOk = gross != null && wht != null && Math.abs(wht - gross * 0.03) < 0.5;

  // ===== เฟส 2: ระบบหลังบ้าน (ถ้ามี session) =====
  let system: SystemWithdraw | null = null;
  let systemNote: string | undefined;
  let systemShot: { path: string; caption: string } | null = null;
  if (fields.username && thunderSessionReady()) {
    const res = await fetchSystemWithdraw(fields.username);
    if (res.error === "session_expired") systemNote = "เซสชันระบบหลังบ้านหมดอายุ — รัน npm run thunder:auth ใหม่";
    else if (res.error === "not_found") systemNote = `ไม่พบยูสเซอร์ "${fields.username}" ในระบบหลังบ้าน`;
    else if (res.error && res.error !== "no_session") systemNote = `อ่านระบบหลังบ้านไม่สำเร็จ: ${res.error}`;
    system = res.data;
    if (res.screenshot) {
      const p = path.join(dir, "system-confirm.png");
      fs.writeFileSync(p, res.screenshot);
      systemShot = { path: p, caption: "ยืนยันจากระบบหลังบ้าน (จัดการถอน)" };
    }
  }
  const amountMatchesSystem: boolean | null =
    system && system.amount != null && net != null ? Math.abs(system.amount - net) < 0.01 : null;

  // ===== เทียบ 3 แหล่ง =====
  const sheetName = record ? `${record.firstName} ${record.lastName}`.trim() : "";
  const eqName = (a: string, b: string) => !!a && !!b && normName(a) === normName(b);
  const eqAddr = (a: string, b: string) => !!a && !!b && normAddr(a) === normAddr(b);
  const eqBank = (a: string, b: string) => !!a && !!b && normBank(a) === normBank(b);
  const eqNum = (a: string, b: string) => !!digits(a) && digits(a) === digits(b);

  const rows: CmpRow[] = [];
  const add = (
    label: string,
    doc: string,
    sheet: string,
    sys: string,
    cmp: (a: string, b: string) => boolean,
    auth: "sheet" | "system",
  ) => {
    const sheetMatch = sheet !== "" ? cmp(doc, sheet) : null;
    const systemMatch = sys !== "" ? cmp(doc, sys) : null;
    const authMatch = auth === "system" ? systemMatch : sheetMatch;
    rows.push({ label, doc, sheet, system: sys, sheetMatch, systemMatch, ok: authMatch === true, auth });
  };
  if (record || system) {
    add("ชื่อ-สกุล", fields.name, sheetName, system?.accountName ?? "", eqName, "sheet");
    add("เลขผู้เสียภาษี", fields.taxId, record?.idCard ?? "", "", eqNum, "sheet");
    add("ที่อยู่", fields.address, record?.address ?? "", "", eqAddr, "sheet");
    add("ธนาคาร", fields.bank, record?.bank ?? "", system?.bank ?? "", eqBank, system ? "system" : "sheet");
    add("เลขบัญชี", fields.account, record?.account ?? "", system?.account ?? "", eqNum, system ? "system" : "sheet");
  }
  const amountRow: CmpRow = {
    label: "ยอดจ่ายจริง",
    doc: fmt(net),
    sheet: "",
    system: system ? fmt(system.amount) : "",
    sheetMatch: null,
    systemMatch: amountMatchesSystem,
    ok: system ? amountMatchesSystem === true : mathOk && whtOk,
    auth: "system",
  };

  // backward-compat checks (identity+บัญชี vs แหล่งชี้ขาด)
  const checks: FieldCheck[] = rows.map((r) => ({
    label: r.label,
    docValue: r.doc,
    refValue: r.auth === "system" ? r.system : r.sheet,
    refSource: r.auth === "system" ? "ระบบ" : "ชีต",
    ok: r.ok,
  }));

  const allOk = !!record && rows.every((r) => r.ok) && amountRow.ok && mathOk && whtOk;

  // ===== รายงานข้อความ (จัดกลุ่ม อ่านง่าย) =====
  const L: string[] = [];
  L.push(`ตรวจเอกสาร Affiliate`);
  L.push(`ยูสเซอร์ ${fields.username || "-"} · ${fields.name || "-"}`);
  if (!record) {
    L.push("");
    L.push(`${NO} ไม่พบยูสเซอร์นี้ในชีตลูกค้า AFF — โปรดตรวจสอบชื่อผู้ใช้อีกครั้ง`);
  }

  const idRows = rows.filter((r) => ["ชื่อ-สกุล", "เลขผู้เสียภาษี", "ที่อยู่"].includes(r.label));
  if (idRows.length) {
    L.push("");
    L.push("▎ ตัวตน (เทียบชีตลูกค้า)");
    for (const r of idRows) {
      L.push(`${r.ok ? OK : NO} ${r.label}: ${r.doc || "-"}${r.ok ? "" : `  ≠ ชีต "${r.sheet || "-"}"`}`);
    }
  }

  const bankRows = rows.filter((r) => ["ธนาคาร", "เลขบัญชี"].includes(r.label));
  if (bankRows.length) {
    L.push("");
    L.push(system ? "▎ บัญชีรับเงิน (ยึดระบบหลังบ้าน)" : "▎ บัญชีรับเงิน (เทียบชีต)");
    for (const r of bankRows) {
      L.push(`${r.ok ? OK : NO} ${r.label}: ${r.doc || "-"}`);
      const notes: string[] = [];
      if (r.systemMatch !== null) notes.push(r.systemMatch ? "ระบบตรง" : `ระบบต่าง (${r.system || "-"})`);
      if (r.sheetMatch !== null) notes.push(r.sheetMatch ? "ชีตตรง" : `ชีตต่าง (${r.sheet || "-"} — อาจเก่า)`);
      if (notes.length) L.push(`     └ ${notes.join("  ·  ")}`);
    }
  }

  L.push("");
  L.push("▎ ยอดเงิน");
  if (system && amountMatchesSystem !== null) {
    L.push(`${amountRow.ok ? OK : NO} ยอดจ่ายจริง: เอกสาร ${fmt(net)} ${amountRow.ok ? "=" : "≠"} ระบบ ${fmt(system.amount)}`);
  } else {
    L.push(`${mathOk && whtOk ? OK : NO} ยอดจ่ายจริง (สุทธิ): ${fmt(net)}`);
  }
  L.push(`${mathOk ? OK : NO} คำนวณ: ${fmt(gross)} − ${fmt(wht)} (หัก 3%) = ${fmt(net)}`);
  L.push(`วันที่เอกสาร ${fields.date || "-"}${system?.status ? `  ·  สถานะระบบ: ${system.status}` : ""}`);

  if (!system) {
    L.push("");
    L.push(systemNote ? `(ระบบหลังบ้าน: ${systemNote})` : "(ยังไม่เชื่อมระบบหลังบ้าน — รัน npm run thunder:auth)");
  }

  L.push("");
  L.push("━━━━━━━━━━━━━━━");
  L.push(allOk ? `${OK} สรุป: ข้อมูลถูกต้อง พร้อมอนุมัติ` : `${NO} สรุป: พบจุดที่ต้องตรวจทาน (ดู ❌ ด้านบน)`);
  const reportText = L.join("\n");

  // ===== ภาพประกอบ =====
  const images: { path: string; caption: string }[] = [];

  // 1) ตารางเปรียบเทียบ เอกสาร/ชีต/ระบบ (เรนเดอร์เอง ธีมน้ำเงิน + โลโก้ Thunder)
  if (rows.length) {
    const png = await renderHtmlToPng(
      comparisonHtml({ fields, rows, amountRow, system, allOk, dateStr: fields.date }),
      { width: 1120 },
    );
    const p = path.join(dir, "compare.png");
    fs.writeFileSync(p, png);
    images.push({ path: p, caption: "สรุปเปรียบเทียบ เอกสาร / ชีต / ระบบ" });
  }

  // 2) ภาพจากระบบหลังบ้าน
  if (systemShot) images.push(systemShot);

  // 3) หน้า 2 ของเอกสาร (บัตรตัวตน)
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

function fileDataUri(rel: string): string {
  try {
    return `data:image/png;base64,${fs.readFileSync(path.join(process.cwd(), rel)).toString("base64")}`;
  } catch {
    return "";
  }
}

// ตารางเปรียบเทียบ 4 คอลัมน์ (ข้อมูล / เอกสาร / ชีต / ระบบ) — ธีมน้ำเงินอ่อน มืออาชีพ + โลโก้ Thunder
function comparisonHtml(o: {
  fields: AffDocFields;
  rows: CmpRow[];
  amountRow: CmpRow;
  system: SystemWithdraw | null;
  allOk: boolean;
  dateStr: string;
}): string {
  const logo = fileDataUri("public/brand/thunder-logo.png");
  const hasSys = !!o.system;

  const chip = (m: boolean | null) =>
    m === true
      ? '<span class="chip ok">ตรง</span>'
      : m === false
        ? '<span class="chip no">ต่าง</span>'
        : "";
  const srcCell = (val: string, m: boolean | null) =>
    val === ""
      ? '<td class="src na">—</td>'
      : `<td class="src ${m === false ? "bad" : m === true ? "good" : ""}">${esc(val)}${chip(m)}</td>`;

  const rowHtml = (r: CmpRow) => `
    <tr class="${r.ok ? "ok" : "bad"}">
      <td class="lbl">${esc(r.label)}${r.auth === "system" && hasSys ? '<span class="auth">ยึดระบบ</span>' : ""}</td>
      <td class="doc">${esc(r.doc || "-")}</td>
      ${srcCell(r.sheet, r.sheetMatch)}
      ${srcCell(r.system, r.systemMatch)}
    </tr>`;

  const amt = o.amountRow;
  const amountHtml = `
    <tr class="amount ${amt.ok ? "ok" : "bad"}">
      <td class="lbl">ยอดจ่ายจริง${hasSys ? '<span class="auth">ยึดระบบ</span>' : ""}</td>
      <td class="doc">฿${esc(amt.doc)}</td>
      <td class="src na">—</td>
      ${amt.system === "" ? '<td class="src na">—</td>' : `<td class="src ${amt.systemMatch === false ? "bad" : "good"}">฿${esc(amt.system)}${chip(amt.systemMatch)}</td>`}
    </tr>`;

  const verdict = o.allOk
    ? '<span class="verdict ok">พร้อมอนุมัติ</span>'
    : '<span class="verdict no">ต้องตรวจทาน</span>';
  const note = hasSys
    ? "ธนาคาร/เลขบัญชี ยึดตามระบบหลังบ้าน (บัญชีที่ลูกค้ากดถอนจริง) — ถ้าไม่ตรงชีต แปลว่าชีตอาจเป็นข้อมูลเก่า"
    : "ยังไม่เชื่อมระบบหลังบ้าน — เทียบกับชีตก่อน (รัน npm run thunder:auth เพื่อเทียบระบบ)";

  return `<!doctype html><html lang="th"><head><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700;800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Noto Sans Thai',sans-serif;background:#eaf1fb;color:#0f2547;padding:30px}
  .card{background:#fff;border:1px solid #d6e4f7;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(30,64,140,.10)}
  .head{display:flex;align-items:center;justify-content:space-between;padding:20px 26px;background:linear-gradient(120deg,#eff5ff,#dbe8fc);border-bottom:2px solid #c7dbf5}
  .head .l{display:flex;align-items:center;gap:14px}
  .head img{height:34px}
  .head .t h1{font-size:19px;font-weight:800;color:#123a73}
  .head .t p{font-size:13px;color:#4a6ea3;margin-top:2px;font-weight:500}
  .verdict{font-size:14px;font-weight:800;padding:8px 16px;border-radius:999px}
  .verdict.ok{background:#dcfce7;color:#15803d}
  .verdict.no{background:#fee2e2;color:#b91c1c}
  table{width:100%;border-collapse:collapse}
  thead th{background:#123a73;color:#fff;font-size:13px;font-weight:600;padding:12px 18px;text-align:left}
  thead th:not(:first-child){border-left:1px solid #2b5aa0}
  thead th.h-doc{background:#1e50a0}
  tbody td{padding:14px 18px;font-size:15px;border-top:1px solid #eef3fb;border-left:1px solid #eef3fb;vertical-align:middle}
  tbody td:first-child{border-left:none}
  tbody tr:nth-child(even){background:#f7faff}
  td.lbl{color:#4a6ea3;font-weight:600;width:22%}
  td.lbl .auth{display:inline-block;margin-left:8px;font-size:11px;font-weight:700;color:#1e50a0;background:#dbe8fc;padding:1px 8px;border-radius:999px}
  td.doc{color:#0f2547;font-weight:700;background:#fbfdff}
  td.src{color:#334e78;font-weight:600}
  td.src.good{color:#15803d}
  td.src.bad{color:#b91c1c;background:#fff5f5}
  td.src.na{color:#b6c4da;text-align:center}
  .chip{display:inline-block;margin-left:8px;font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px;vertical-align:middle}
  .chip.ok{background:#dcfce7;color:#15803d}
  .chip.no{background:#fee2e2;color:#b91c1c}
  tr.ok td:first-child{box-shadow:inset 4px 0 0 #22c55e}
  tr.bad td:first-child{box-shadow:inset 4px 0 0 #ef4444}
  tr.amount td{background:#eef5ff;font-size:16px}
  tr.amount td.doc,tr.amount td.src{font-weight:800}
  .foot{padding:14px 26px;background:#f4f8ff;border-top:1px solid #e0eaf9;font-size:13px;color:#4a6ea3}
</style></head><body>
  <div class="card">
    <div class="head">
      <div class="l">
        ${logo ? `<img src="${logo}" alt="Thunder"/>` : ""}
        <div class="t"><h1>สรุปเปรียบเทียบข้อมูล Affiliate</h1>
        <p>ยูสเซอร์ ${esc(o.fields.username || "-")} · ${esc(o.fields.name || "-")} · วันที่ ${esc(o.dateStr || "-")}</p></div>
      </div>
      ${verdict}
    </div>
    <table>
      <thead><tr><th>ข้อมูล</th><th class="h-doc">ในเอกสาร</th><th>ในชีตลูกค้า</th><th>ในระบบหลังบ้าน</th></tr></thead>
      <tbody>
        ${o.rows.map(rowHtml).join("")}
        ${amountHtml}
      </tbody>
    </table>
    <div class="foot">${esc(note)}</div>
  </div>
</body></html>`;
}
