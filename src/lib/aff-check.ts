import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findAffByUsername, type AffRecord } from "./sheets";
import { extractAffDoc, type AffDocFields } from "./aff-extract";
import { getNoti, parseDateLoose, parseSystemNoti } from "./aff-notify";
import { renderHtmlToPng } from "./html-pdf";
import { pdfFileToPngs } from "./pdf-to-images";
import { fetchSystemWithdraw, thunderSessionReady, type SystemWithdraw, type SystemFetchResult } from "./thunder-admin";

// ===== normalize สำหรับเทียบภาษาไทย =====
function normName(s: string): string {
  return s.replace(/นางสาว|นาย|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\./g, "").replace(/\s+/g, "");
}
// ระยะแก้ไข (Levenshtein) — ไว้ยอมสะกดต่างเล็กน้อย เช่น อุตรดิตถ์ / อุตรดิษถ์
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}
// คำไทยใกล้กันพอ (ตรง หรือสะกดต่างไม่เกิน ~2 ตัว)
function thaiClose(a: string, b: string): boolean {
  const na = (a || "").replace(/[\s.]/g, ""), nb = (b || "").replace(/[\s.]/g, "");
  if (!na || !nb) return false;
  if (na === nb) return true;
  const tol = Math.min(na.length, nb.length) <= 4 ? 1 : 2;
  return editDistance(na, nb) <= tol;
}
// ดึงส่วนสำคัญของที่อยู่: เลขที่บ้าน / อำเภอ(หรือเขต) / จังหวัด
function addrParts(s: string): { house: string; district: string; province: string } {
  const t = (s || "").replace(/\s+/g, " ").trim();
  const house = (t.match(/(\d+(?:\/\d+)?)/)?.[1] || "").replace(/\s/g, "");
  // จับ อำเภอ/จังหวัด ให้กินข้ามช่องว่าง (เช่น "เมือง กาฬสินธุ์") จนถึง label ถัดไป แล้วตัดช่องว่างออก
  const district = (t.match(/(?:อำเภอ|อ\.|เขต)\s*([ก-๙][ก-๙\s]*?)\s*(?:จังหวัด|จ\.|$)/)?.[1] || "").replace(/\s/g, "");
  let province = (t.match(/(?:จังหวัด|จ\.)\s*([ก-๙][ก-๙\s]*?)\s*$/)?.[1] || "").replace(/\s/g, "");
  if (!province && /กรุงเทพ/.test(t)) province = "กรุงเทพมหานคร";
  return { house, district, province };
}
// ที่อยู่ตรงกันไหม — โฟกัสแค่ เลขที่บ้าน + อำเภอ + จังหวัด (ตำบล/หมู่/สะกดปลีกย่อยไม่นับ)
function addrMatch(doc: string, sheet: string): boolean {
  const A = addrParts(doc), B = addrParts(sheet);
  const houseOk = !A.house || !B.house || A.house === B.house;
  const districtOk = !A.district || !B.district || thaiClose(A.district, B.district);
  const provinceOk = !A.province || !B.province || thaiClose(A.province, B.province);
  return houseOk && districtOk && provinceOk;
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
  chatId?: string,
  replyText?: string,
  preSystem?: SystemFetchResult, // ส่ง system ที่ fetch มาแล้ว (เลี่ยง scrape ซ้ำ ตอนวานสร้าง+ตรวจเอง)
): Promise<AffCheckResult> {
  const dir = outDir || fs.mkdtempSync(path.join(os.tmpdir(), "waan-aff-"));
  const fields = await extractAffDoc(pdfPath, adminText);
  const record = fields.username ? await findAffByUsername(fields.username) : null;

  // noti ที่แอดมิน "Reply ถึง" (ข้อความบอทระบบที่ถูกตอบกลับ) — ใช้ยืนยันว่าเอกสารตรงรายการนั้น
  const repliedNoti = replyText ? parseSystemNoti(replyText) : null;
  const cachedNoti = chatId && fields.username ? await getNoti(chatId, fields.username) : null;
  const sameUser = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

  // เอ๊ะใจ: เอกสารที่แนบ "ไม่ตรง" กับรายการ noti ที่ Reply ถึงไหม — ดูแค่ "คนละคน / คนละยอด"
  // (วันที่ไม่เอามาตัดสินตรงนี้ วันที่ใช้แค่เลือกแถวหลังบ้านให้ตรงรายการเท่านั้น)
  let notiMismatch: string | null = null;
  if (repliedNoti) {
    if (!sameUser(repliedNoti.username, fields.username)) {
      notiMismatch = `Reply ไปที่รายการของ "${repliedNoti.username}"${repliedNoti.amount != null ? ` ยอด ${fmt(repliedNoti.amount)}` : ""}${repliedNoti.dateText ? ` (${repliedNoti.dateText})` : ""} แต่เอกสารที่แนบเป็นของ "${fields.username}" — ส่งเอกสารผิดรายการ`;
    } else if (repliedNoti.amount != null && fields.net != null && Math.abs(repliedNoti.amount - fields.net) > 0.01) {
      notiMismatch = `Reply ไปที่รายการยอด ${fmt(repliedNoti.amount)} แต่เอกสารยอดสุทธิ ${fmt(fields.net)} — ไม่ตรงรายการ`;
    }
  }

  // noti ที่ยึดเลือกแถวหลังบ้าน: ถ้า Reply ถึง noti ของคนเดียวกัน ใช้ตัวนั้น ไม่งั้นใช้ที่ cache ไว้
  const noti = repliedNoti && sameUser(repliedNoti.username, fields.username) ? repliedNoti : cachedNoti;

  const { gross, wht, net } = fields;
  const mathOk = gross != null && wht != null && net != null && Math.abs(gross - wht - net) < 0.01;
  const whtOk = gross != null && wht != null && Math.abs(wht - gross * 0.03) < 0.5;

  // ===== เฟส 2: ระบบหลังบ้าน (ถ้ามี session) =====
  let system: SystemWithdraw | null = null;
  let systemNote: string | undefined;
  let systemShot: { path: string; caption: string } | null = null;
  if (fields.username && (preSystem || thunderSessionReady())) {
    const res = preSystem ?? await fetchSystemWithdraw(fields.username, {
      expectedDate: noti?.date ?? parseDateLoose(fields.date),
      expectedAmount: noti?.amount ?? null,
    });
    if (res.error === "session_expired") systemNote = "เซสชันระบบหลังบ้านหมดอายุ — รัน npm run thunder:auth ใหม่";
    else if (res.error === "not_found") systemNote = `ไม่พบยูสเซอร์ "${fields.username}" ในระบบหลังบ้าน`;
    else if (res.error && res.error !== "no_session") systemNote = `อ่านระบบหลังบ้านไม่สำเร็จ: ${res.error}`;
    // มีหลายรายการแต่เลือกไม่ตรงวันที่ noti → เตือนว่าอาจหยิบผิดแถว
    if (res.data && res.rowCount && res.rowCount > 1 && !res.matchedByNoti)
      systemNote = `ยูสเซอร์นี้มี ${res.rowCount} รายการในระบบ และเลือกวันที่ให้ตรงอัตโนมัติไม่ได้ — โปรดตรวจว่าตรงรายการวันที่ ${noti?.dateText || fields.date || "ในเอกสาร"} ไหม`;
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
  const eqAddr = (a: string, b: string) => !!a && !!b && addrMatch(a, b);
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
    const has = (v: string) => v != null && v !== "";
    // เทียบทุกคู่ที่มีข้อมูลครบ (เอกสาร↔ชีต, เอกสาร↔ระบบ, ชีต↔ระบบ)
    const dS = has(doc) && has(sheet) ? cmp(doc, sheet) : null;
    const dSys = has(doc) && has(sys) ? cmp(doc, sys) : null;
    const sSys = has(sheet) && has(sys) ? cmp(sheet, sys) : null;
    // ผ่านถ้ามีอย่างน้อย "2 แหล่งตรงกัน" (คู่ใดก็ได้) — ไม่งั้นถ้าเทียบไม่ได้เลย (มีแหล่งเดียว) ก็ผ่าน (ยึดระบบ)
    const anyPair = dS !== null || dSys !== null || sSys !== null;
    const ok = dS === true || dSys === true || sSys === true || !anyPair;
    // chip: คอลัมน์ชีตเทียบกับแหล่งชี้ขาด (ระบบก่อน ไม่มีค่อยเอกสาร) · คอลัมน์ระบบเทียบกับเอกสาร (ไม่มีค่อยชีต)
    const sheetMatch = has(sheet) ? (has(sys) ? sSys : dS) : null;
    const systemMatch = has(sys) ? (has(doc) ? dSys : sSys) : null;
    rows.push({ label, doc, sheet, system: sys, sheetMatch, systemMatch, ok, auth });
  };
  if (record || system) {
    add("ชื่อ-สกุล", fields.name, sheetName, system?.accountName ?? "", eqName, "sheet");
    add("เลขผู้เสียภาษี", fields.taxId, record?.idCard ?? "", "", eqNum, "sheet");
    add("ที่อยู่", fields.address, record?.address ?? "", "", eqAddr, "sheet");
    // ธนาคาร/เลขบัญชี: เอกสารที่วานสร้างเองไม่มีช่องนี้ → เทียบ "ชีต ↔ ระบบ" ให้ตรงกัน (ยึดระบบ = บัญชีที่กดถอนจริง)
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

  const allOk = !notiMismatch && !!record && rows.every((r) => r.ok) && amountRow.ok && mathOk && whtOk;

  // ===== รายงานข้อความ (จัดกลุ่ม อ่านง่าย) =====
  // ส่งเป็น HTML (parse_mode=HTML) + ครอบ <tg-spoiler> เฉพาะ "ค่าข้อมูล" อ่อนไหว
  // (ชื่อ/เลขภาษี/ที่อยู่/เลขบัญชี/ยอดเงิน) เพื่อเซ็นเซอร์เวลาส่ง/ฟอร์เวิร์ด — แตะเพื่อเปิดดูได้
  // ป้ายกำกับ/หัวข้อ/เครื่องหมายถูก-ผิด ยังเห็นปกติ
  const sp = (v: unknown) => `<tg-spoiler>${esc(String(v ?? "-"))}</tg-spoiler>`;
  const L: string[] = [];
  L.push(`ตรวจเอกสาร Affiliate`);
  L.push(`ยูสเซอร์ ${esc(fields.username || "-")} · ${sp(fields.name || "-")}`);
  if (notiMismatch) {
    L.push("");
    L.push(`⛔ เอกสารไม่ตรงกับรายการที่ Reply`);
    L.push(`${NO} ${esc(notiMismatch)}`);
    L.push(`โปรดตรวจสอบว่าแนบเอกสารถูกรายการ แล้วส่งใหม่ค่ะ`);
  }
  if (!record) {
    L.push("");
    L.push(`${NO} ไม่พบยูสเซอร์นี้ในชีตลูกค้า AFF — โปรดตรวจสอบชื่อผู้ใช้อีกครั้ง`);
  }

  const idRows = rows.filter((r) => ["ชื่อ-สกุล", "เลขผู้เสียภาษี", "ที่อยู่"].includes(r.label));
  if (idRows.length) {
    L.push("");
    L.push("▎ ตัวตน (เทียบชีตลูกค้า)");
    for (const r of idRows) {
      L.push(`${r.ok ? OK : NO} ${r.label}: ${sp(r.doc || "-")}${r.ok ? "" : `  ≠ ชีต "${sp(r.sheet || "-")}"`}`);
    }
  }

  const bankRows = rows.filter((r) => ["ธนาคาร", "เลขบัญชี"].includes(r.label));
  if (bankRows.length) {
    L.push("");
    L.push(system ? "▎ บัญชีรับเงิน (ยึดระบบหลังบ้าน)" : "▎ บัญชีรับเงิน (เทียบชีต)");
    for (const r of bankRows) {
      // ยึดระบบหลังบ้าน → แสดง "ค่าจากระบบ" (บัญชีที่ลูกค้ากดถอนจริง) เพราะเอกสาร AFF ที่วานสร้างไม่มีช่องบัญชี
      const val = r.auth === "system" ? (r.system || r.doc || r.sheet || "-") : (r.doc || r.sheet || r.system || "-");
      L.push(`${r.ok ? OK : NO} ${r.label}: ${sp(val)}`);
      const notes: string[] = [];
      if (r.auth === "system" && r.system) notes.push("จากระบบหลังบ้าน");
      if (r.sheetMatch !== null) notes.push(r.sheetMatch ? "ชีตตรง" : `ชีตต่าง (${sp(r.sheet || "-")} — อาจเก่า)`);
      if (r.systemMatch === false && r.doc) notes.push(`ต่างจากเอกสาร (${sp(r.doc)})`);
      if (notes.length) L.push(`     └ ${notes.join("  ·  ")}`);
    }
  }

  L.push("");
  L.push("▎ ยอดเงิน");
  if (system && amountMatchesSystem !== null) {
    L.push(`${amountRow.ok ? OK : NO} ยอดจ่ายจริง: เอกสาร ${sp(fmt(net))} ${amountRow.ok ? "=" : "≠"} ระบบ ${sp(fmt(system.amount))}`);
  } else {
    L.push(`${mathOk && whtOk ? OK : NO} ยอดจ่ายจริง (สุทธิ): ${sp(fmt(net))}`);
  }
  L.push(`${mathOk ? OK : NO} คำนวณ: ${sp(fmt(gross))} − ${sp(fmt(wht))} (หัก 3%) = ${sp(fmt(net))}`);
  L.push(`วันที่เอกสาร ${esc(fields.date || "-")}${system?.status ? `  ·  สถานะระบบ: ${esc(system.status)}` : ""}`);

  if (!system) {
    L.push("");
    L.push(systemNote ? `(ระบบหลังบ้าน: ${esc(systemNote)})` : "(ยังไม่เชื่อมระบบหลังบ้าน — รัน npm run thunder:auth)");
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
  const logo = fileDataUri("public/brand/thunder-mark.png");
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
  .head img{height:48px;width:48px;border-radius:11px;box-shadow:0 3px 8px rgba(18,58,115,.28)}
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
