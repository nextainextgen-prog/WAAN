import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findProfile, saveProfile, attachmentPath, type AffProfile } from "./aff-profile";
import { findAffByUsername } from "./sheets";
import { buildReceiptPdf } from "./aff-receipt";
import { fetchSystemWithdraw, thunderSessionReady, type SystemFetchResult } from "./thunder-admin";
import { runAffCheck } from "./aff-check";
import { parseDateLoose, type AffNoti, type DateYMD } from "./aff-notify";
import { pdfFileToPngs } from "./pdf-to-images";

/**
 * วานสร้างใบสำคัญรับเงิน Affiliate เอง แล้วตรวจเอง
 *  noti (ยูสเซอร์/วันที่/ยอดสุทธิ) → หาโปรไฟล์ Obsidian → ดึงยอดโบนัสก่อนหน้าจากระบบ
 *  → คิดยอด (gross − 3% = สุทธิ = ยอดระบบ) → สร้าง PDF (แนบหน้า 2) → ตรวจเอง (runAffCheck)
 *  → คืนไฟล์ + รายงาน + แคปชันสรุป (แบบ Image#42)
 */

export type AffMakeStatus = "ok" | "new_customer" | "no_session" | "not_found" | "amount_mismatch" | "error";

export interface AffMakeResult {
  status: AffMakeStatus;
  username: string;
  profile: AffProfile | null;
  pdfPath?: string;
  reportText?: string; // รายงานตรวจเอง (จาก runAffCheck)
  summaryCaption?: string; // ข้อความสรุปแบบ Image#42 (ไว้ต่อท้ายตอนส่งกลุ่ม)
  images?: { path: string; caption: string }[]; // พรีวิวเอกสาร + ตารางเทียบ + ภาพระบบ
  allOk?: boolean;
  note?: string;
}

const WHT_RATE = 3;
const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtBaht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoney = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : fmtBaht(n));

function dateFields(d: DateYMD) {
  return { day: String(d.d), month: String(d.m).padStart(2, "0"), yearBE: String(d.y + 543) };
}

// ===== override จากคำสั่ง "แก้ไข" ของเจ้าของ =====
export interface EditOverrides {
  day?: string; month?: string; yearBE?: string; // วันที่
  gross?: number; // ยอดตั้ง (แก้ยอดเอง)
  prefix?: string; name?: string; taxId?: string;
  houseNo?: string; moo?: string; road?: string; tambon?: string; amphoe?: string; changwat?: string;
  bank?: string; account?: string; // เก็บเข้าโปรไฟล์ (ใบเสร็จไม่มีช่องนี้)
}

const PREFIXES = ["นางสาว", "นาย", "นาง", "น.ส."];
function splitPrefix(full: string): { prefix: string; name: string } {
  const t = full.trim();
  for (const p of PREFIXES) if (t.startsWith(p)) return { prefix: p, name: t.slice(p.length).trim() };
  return { prefix: "", name: t };
}
function toBE(y: number): string {
  if (y < 100) return String(2500 + y); // 69 → 2569
  return String(y > 2400 ? y : y + 543);
}

// แปลงข้อความสั่งแก้ → overrides (เดเทอร์มินิสติก)
export function parseEdit(text: string): EditOverrides {
  const o: EditOverrides = {};
  const g = (re: RegExp) => text.match(re)?.[1]?.trim();
  const dm = text.match(/วันที่(?:ทำการถอน)?\s*:?\s*(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (dm) { o.day = String(+dm[1]); o.month = String(+dm[2]).padStart(2, "0"); o.yearBE = toBE(+dm[3]); }
  const gm = text.match(/(?:ยอดตั้ง|ยอดเงินที่ถอน|จำนวนเงินที่ถอน|ยอดเงิน|ยอด)\s*:?\s*([\d,]+(?:\.\d+)?)\s*(?:บาท)?/);
  if (gm) o.gross = Number(gm[1].replace(/,/g, ""));
  const tx = g(/เลข(?:ประจำตัว)?(?:ผู้เสีย)?ภาษี\s*:?\s*(\d{10,13})/);
  if (tx) o.taxId = tx;
  const bk = g(/ธนาคาร\s*:?\s*([^\n]+?)(?:\s{2,}|\s*(?:เลขบัญชี|ชื่อบัญชี)|$)/);
  if (bk) o.bank = bk.trim();
  const ac = g(/เลขบัญชี\s*:?\s*([\d\- ]{6,})/);
  if (ac) o.account = ac.replace(/\D/g, "");
  // ชื่อผู้รับ (ไม่ใช่ "ชื่อบัญชี")
  const nm = text.match(/(?:^|\n)\s*(?:ชื่อ-สกุล|ชื่อผู้รับ|ชื่อ)(?!บัญชี)\s*:?\s*([^\n]+)/);
  if (nm && !/บัญชี/.test(nm[0])) Object.assign(o, splitPrefix(nm[1].trim()));
  const house = g(/(?:บ้านเลขที่|เลขที่บ้าน)\s*:?\s*(\d+(?:\/\d+)?)/);
  if (house) o.houseNo = house;
  const moo = g(/หมู่(?:ที่)?\s*:?\s*(\d+)/); if (moo) o.moo = moo;
  const tb = g(/(?:ตำบล|ต\.)\s*([ก-๙]+)/); if (tb) o.tambon = tb;
  const am = g(/(?:อำเภอ|อ\.)\s*([ก-๙]+)/); if (am) o.amphoe = am;
  const cw = g(/(?:จังหวัด|จ\.)\s*([ก-๙]+)/); if (cw) o.changwat = cw;
  return o;
}

function addrLine(p: AffProfile): string {
  return `${p.houseNo}${p.moo ? ` หมู่ ${p.moo}` : ""}${p.road && p.road !== "-" ? ` ถนน ${p.road}` : ""} ต.${p.tambon} อ.${p.amphoe} จ.${p.changwat}`;
}

// แยกที่อยู่ (string เดียวจากชีต) → ส่วนประกอบสำหรับกรอกใบเสร็จ
function parseThaiAddress(s: string) {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return {
    house: t.match(/(\d+(?:\/\d+)?)/)?.[1] || "",
    moo: t.match(/หมู่(?:ที่)?\s*(\d+)/)?.[1] || "",
    road: t.match(/(?:ถนน|ถ\.)\s*(\S+)/)?.[1] || "-",
    tambon: t.match(/(?:ตำบล|ต\.|แขวง)\s*([ก-๙]+)/)?.[1] || "",
    amphoe: t.match(/(?:อำเภอ|อ\.|เขต)\s*([ก-๙]+)/)?.[1] || "",
    changwat: t.match(/(?:จังหวัด|จ\.)\s*([ก-๙]+)/)?.[1] || "",
  };
}

// แคปชันสรุป (Image#42/#53) — ยอด "จำนวนเงินที่ถอน" = ยอดตั้ง (gross),
// ข้อ 8 "ที่อยู่จัดส่งเอกสาร" = คอลัมน์ shipAddress ในชีต (อีเมล/ที่อยู่+เบอร์) ไม่มีก็ใช้ที่อยู่ลูกค้า
function buildSummary(o: { username: string; p: AffProfile; df: ReturnType<typeof dateFields>; gross: number; wht: number; shipAddr?: string; addr3?: string }): string {
  const yy = o.df.yearBE.slice(-2);
  const ship = (o.shipAddr || o.addr3 || addrLine(o.p)).replace(/\n/g, " ").trim();
  return [
    `1. ยูสเซอร์ : ${o.username}`,
    `2. ชื่อ : ${o.p.prefix}${o.p.name}`,
    `3. ที่อยู่ : ${o.addr3 || addrLine(o.p)}`,
    `4. เลขผู้เสียภาษี : ${o.p.taxId}`,
    `5. วันที่ทำการถอน : ${o.df.day}/${o.df.month}/${yy}`,
    `6. จำนวนเงินที่ถอน : ${fmtMoney(o.gross)} บาท`,
    `7. จำนวนเงินที่ถูกหัก (3%) : ${fmtBaht(o.wht)} บาท`,
    `8. ที่อยู่ในการจัดส่งเอกสาร : ${ship}`,
  ].join("\n");
}

export async function makeAffReceipt(input: {
  noti: AffNoti;
  chatId?: string;
  outDir?: string;
  overrides?: EditOverrides; // จากคำสั่ง "แก้ไข"
}): Promise<AffMakeResult> {
  const { noti } = input;
  const username = noti.username;
  const ov = input.overrides || {};
  const dir = input.outDir || fs.mkdtempSync(path.join(os.tmpdir(), "waan-affmake-"));
  fs.mkdirSync(dir, { recursive: true });

  // 1) โปรไฟล์ลูกค้า (Obsidian) + ผสาน override ที่แก้ + บันทึกกลับ (จำไว้ครั้งหน้า)
  const base = await findProfile(username, noti.accountName);
  if (!base) return { status: "new_customer", username, profile: null };
  const profile: AffProfile = { ...base };
  const PROFILE_KEYS: (keyof AffProfile)[] = ["prefix", "name", "taxId", "houseNo", "moo", "road", "tambon", "amphoe", "changwat", "bank", "account"];
  let changed = false;
  for (const k of PROFILE_KEYS) {
    const v = (ov as unknown as Record<string, unknown>)[k];
    if (v != null && v !== "") { (profile as unknown as Record<string, unknown>)[k] = v; changed = true; }
  }
  if (changed) await saveProfile({ ...profile, username, updatedAt: new Date().toISOString().slice(0, 10) }).catch(() => {});

  // 2) ระบบหลังบ้าน (ต้องมี session — ดึงยอดโบนัสก่อนหน้า)
  if (!thunderSessionReady())
    return { status: "no_session", username, profile, note: "ยังไม่ได้เชื่อมระบบหลังบ้าน — รัน npm run thunder:auth" };
  const sys: SystemFetchResult = await fetchSystemWithdraw(username, {
    expectedDate: noti.date,
    expectedAmount: noti.amount,
  });
  if (sys.error === "session_expired")
    return { status: "no_session", username, profile, note: "เซสชันระบบหมดอายุ — รัน npm run thunder:auth" };
  if (!sys.data) return { status: "not_found", username, profile, note: `ไม่พบรายการถอนของ ${username} ในระบบหลังบ้าน` };

  // 3) คิดยอด: net = "จำนวน"(ระบบ = ยอดจ่ายจริง/สุทธิ ยึดค่านี้)
  //    gross = "เลขกลม" (บาทเต็ม) ที่หัก 3% แล้วได้ = net → gross = ปัดเศษ(net / 0.97)
  //    ("ยอดโบนัสก่อนหน้า" ในระบบเป็นค่าตั้งต้นโดยประมาณ ไม่ใช่เลขกลมบนใบเสร็จ)
  const sysNet = sys.data.amount;
  if (sysNet == null && ov.gross == null) return { status: "amount_mismatch", username, profile, note: "อ่านยอด (จำนวน) จากระบบไม่ได้" };
  // ยอด: ปกติ gross = ปัดเศษ(net/0.97) · ถ้าเจ้าของแก้ยอดเอง (ov.gross) ให้ยึดค่านั้น แล้วคิดสุทธิใหม่
  let gross: number, net: number, amountMismatch: boolean;
  if (ov.gross != null) {
    gross = ov.gross;
    const w = round2(gross * (WHT_RATE / 100));
    net = round2(gross - w);
    amountMismatch = false; // แก้ยอดเอง = เชื่อเจ้าของ
  } else {
    net = sysNet as number;
    gross = Math.round(net / (1 - WHT_RATE / 100));
    amountMismatch = Math.abs(round2(gross - round2(gross * (WHT_RATE / 100))) - net) > 0.01;
  }
  const wht = round2(gross * (WHT_RATE / 100));

  // 4) วันที่ (override > noti > วันที่ในระบบ)
  const dymd = noti.date || parseDateLoose(sys.data.createdAt);
  const df = ov.day && ov.month && ov.yearBE
    ? { day: ov.day, month: ov.month, yearBE: ov.yearBE }
    : dymd ? dateFields(dymd) : null;
  if (!df) return { status: "error", username, profile, note: "อ่านวันที่รายการไม่ได้" };

  // 5) สร้าง PDF — ที่อยู่ยึด "ชีต" (override > ชีต > โปรไฟล์) · บัญชียึด "ระบบ"
  const record = await findAffByUsername(username).catch(() => null);
  const sa = record?.address ? parseThaiAddress(record.address) : null;
  const addr = {
    houseNo: ov.houseNo || sa?.house || base.houseNo,
    moo: ov.moo || sa?.moo || base.moo,
    road: ov.road || sa?.road || base.road,
    tambon: ov.tambon || sa?.tambon || base.tambon,
    amphoe: ov.amphoe || sa?.amphoe || base.amphoe,
    changwat: ov.changwat || sa?.changwat || base.changwat,
  };
  const attach = attachmentPath(username) || undefined;
  const pdf = await buildReceiptPdf({
    ...df,
    prefix: profile.prefix, name: profile.name, taxId: profile.taxId,
    ...addr,
    bank: ov.bank || sys.data.bank || profile.bank,
    account: ov.account || sys.data.account || profile.account,
    items: [{ desc: "ค่าคอมมิชชั่นจากการแนะนำผู้ใช้", amount: gross }],
    gross, whtRate: WHT_RATE, wht, net,
    idCardImagePath: attach,
  });
  // ชื่อไฟล์: วันที่ DD.MM.YY (พ.ศ. 2 หลักท้าย) + เว้นวรรค + username เท่านั้น เช่น "16.07.69 suwan.pdf"
  const dd = String(df.day).padStart(2, "0");
  const yy = String(df.yearBE).slice(-2);
  const filename = `${dd}.${df.month}.${yy} ${username}.pdf`.normalize("NFC");
  const pdfPath = path.join(dir, filename);
  fs.writeFileSync(pdfPath, pdf);

  // 6) ตรวจเอง (reuse runAffCheck กับ system ที่ fetch แล้ว — ไม่ scrape ซ้ำ)
  const adminText = [
    `1. ยูสเซอร์ : ${username}`,
    `2. ชื่อ : ${profile.prefix}${profile.name}`,
    `3. ที่อยู่ : ${addrLine(profile)}`,
    `4. เลขผู้เสียภาษี : ${profile.taxId}`,
    `5. วันที่ทำการถอน : ${df.day}/${df.month}/${df.yearBE}`,
  ].join("\n");
  const check = await runAffCheck(pdfPath, adminText, dir, input.chatId, "", sys);

  // 7) แคปชันสรุป + พรีวิวเอกสารที่ทำ (ข้อ 8 ดึงที่อยู่จัดส่งจากชีต ผ่าน record ที่ runAffCheck หามาแล้ว)
  const addr3 = `${addr.houseNo}${addr.moo ? ` หมู่ ${addr.moo}` : ""}${addr.road && addr.road !== "-" ? ` ถนน ${addr.road}` : ""} ต.${addr.tambon} อ.${addr.amphoe} จ.${addr.changwat}`;
  const summaryCaption = buildSummary({ username, p: profile, df, gross, wht, shipAddr: check.record?.shipAddress, addr3 });
  const previews: { path: string; caption: string }[] = [];
  try {
    const pgs = await pdfFileToPngs(pdfPath, dir, { maxPages: 2, scale: 2 });
    if (pgs[0]) previews.push({ path: pgs[0], caption: "เอกสารที่จัดทำ — หน้า 1 (ใบสำคัญรับเงิน)" });
    if (pgs[1]) previews.push({ path: pgs[1], caption: "เอกสารที่จัดทำ — หน้า 2 (เอกสารแนบ)" });
  } catch {
    /* ข้าม preview */
  }

  const allOk = check.allOk && !amountMismatch;
  const note = amountMismatch
    ? `ยอดไม่ลงตัว: ${fmtMoney(gross)} − ${fmtBaht(wht)} = ${fmtBaht(round2(gross - wht))} แต่ระบบ = ${fmtBaht(net)} — โปรดตรวจ`
    : check.systemNote;

  return {
    status: amountMismatch ? "amount_mismatch" : "ok",
    username, profile, pdfPath,
    reportText: check.reportText,
    summaryCaption,
    images: [...previews, ...check.images],
    allOk,
    note,
  };
}
