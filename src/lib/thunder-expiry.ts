import fs from "node:fs";
import path from "node:path";
import { chromium, type Page, type Locator } from "playwright";

/**
 * ปรับ "วันที่บอทหมดอายุ" ในระบบหลังบ้าน Thunder (old.thunder.in.th/admin/service)
 * 2 เฟส: previewExpiry (ค้นหา+อ่าน+แคป → ให้ยืนยัน) แล้ว executeExpiry (ตั้งวัน/เวลาปัจจุบัน+บันทึก)
 * selector verify แล้วกับ session จริง 2026-07-13 (Mantine DatePicker, ช่องค้นหา pressSequentially)
 */

const BASE = (process.env.THUNDER_ADMIN_URL || "https://old.thunder.in.th").replace(/\/$/, "");
const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

function sessionPath(): string {
  return process.env.THUNDER_SESSION_PATH || path.join(process.cwd(), ".thunder-session.json");
}
export function thunderSessionReady(): boolean {
  return fs.existsSync(sessionPath());
}

export interface ExpiryRow {
  serviceId: string;
  username: string;
  shopName: string;
  branchType: string;
  currentExpiry: string;
}
export interface PreviewResult {
  ok: boolean;
  error?: "no_session" | "session_expired" | "not_found" | "no_main_branch" | string;
  username: string;
  mainRows: ExpiryRow[];
  otherCount: number;
  screenshotBase64?: string;
}
export interface ExecuteResult {
  ok: boolean;
  error?: "no_session" | "session_expired" | "not_found" | "no_main_branch" | "expiry_col_not_found" | "no_row_updated" | string;
  updated: number;
  updatedRows: { shopName: string; serviceId: string; oldExpiry: string }[];
  otherCount: number;
  screenshotBase64?: string;
}

// สกัด username จากข้อความแอดมิน เช่น "preechapanit101 ปรับวันหมดอายุให้หน่อย"
export function extractUsername(text: string): string | null {
  const cleaned = String(text || "").replace(/@\S+/g, " ");
  const tokens = cleaned.match(/[A-Za-z0-9][A-Za-z0-9._-]{2,}/g) || [];
  const stop = /^(ปรับ|ขยาย|วัน|หมดอายุ|หน่อย|ครับ|ค่ะ|ให้|ตัว)$/i;
  const cand = tokens.find((t) => !stop.test(t) && /[A-Za-z]/.test(t));
  return cand || null;
}

function launch() {
  return chromium.launch({ args: ["--no-sandbox"] });
}

// เปิดหน้า service + ตรวจ session + ค้นหา username (พิมพ์จริงด้วย pressSequentially เพราะ SPA controlled input)
async function openAndSearch(username: string) {
  const browser = await launch();
  const context = await browser.newContext({ storageState: sessionPath(), viewport: { width: 1700, height: 1000 }, locale: "th-TH" });
  const page = await context.newPage();
  await page.goto(`${BASE}/admin/service`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000); // รอ SPA เรนเดอร์ฟอร์มค้นหาให้พร้อม (สำคัญ — 3s บางทีไม่ทันแล้วค้นไม่ติด)
  if (/\/(auth\/)?(sign-?in|login)/i.test(page.url())) { await browser.close(); return { browser: null as never, page: null as never, error: "session_expired" as const }; }
  const box = page.getByPlaceholder(/9bomeiei/i).first();
  // session หมด: SPA เรนเดอร์ไม่ได้ (ไม่มีช่องค้นหา) แม้ URL ไม่เด้ง login
  if ((await box.count().catch(() => 0)) === 0) {
    await page.waitForTimeout(5000);
    if ((await box.count().catch(() => 0)) === 0) { await browser.close(); return { browser: null as never, page: null as never, error: "session_expired" as const }; }
  }
  // พิมพ์ username แล้วกดค้นหา — เรียบง่ายตามที่ทดสอบว่าเวิร์ก
  // (ห้าม box.fill("") เด็ดขาด เพราะ fill ไม่ bind SPA model → พิมพ์ทับ → ค่าใน model เพี้ยน → ค้นไม่เจอ)
  await box.click();
  await box.pressSequentially(username, { delay: 60 });
  await page.waitForTimeout(400);
  const searchBtn = page.getByRole("button", { name: /ค้นหา/ }).first();
  // ระบบหลังบ้านโหลดช้าได้ → รอผลลัพธ์ (ขึ้น "มีข้อมูล N รายการ" หรือมีแถว) สูงสุด 15 วิ ก่อนค่อยสรุปว่าไม่เจอ
  const waitResults = () =>
    page
      .waitForFunction(
        () => /มีข้อมูล\s*[\d,]+\s*รายการ/.test(document.body.innerText) || document.querySelectorAll("table tbody tr").length > 0,
        null,
        { timeout: 15000, polling: 800 },
      )
      .catch(() => {});
  await searchBtn.click().catch(() => {});
  await waitResults();
  await page.waitForTimeout(1200); // settle ให้แถวเรนเดอร์ครบ
  // ถ้าได้ 0 แถว → ค้นซ้ำ 1 ครั้ง (เผื่อผลชั่วคราว/โหลดไม่ครบ) ก่อนสรุปว่าไม่เจอ
  if ((await page.locator("table tbody tr").count().catch(() => 0)) === 0) {
    await page.waitForTimeout(3000);
    await searchBtn.click().catch(() => {});
    await waitResults();
    await page.waitForTimeout(1200);
  }
  return { browser, page, error: undefined };
}

// header → index (Username / ประเภทสาขา / วันที่บอทหมดอายุ)
async function columnIndexes(page: Page) {
  return page.evaluate(() => {
    const clean = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
    const heads = [...document.querySelectorAll("table thead th, table thead td")].map((h) => clean(h.textContent));
    const idx = (re: RegExp) => heads.findIndex((h) => re.test(h));
    return { user: idx(/^username$|ชื่อผู้ใช้/i), branch: idx(/ประเภทสาขา/), expiry: idx(/วันที่บอทหมดอายุ/), shop: idx(/ชื่อร้านค้า(?!.*ภายใน)/), id: idx(/ไอดีร้านค้า/) };
  });
}

async function readRows(page: Page, username: string, cols: { user: number; branch: number; expiry: number; shop: number; id: number }) {
  return page.evaluate(
    ({ uname, c }) => {
      const clean = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
      const rows = [...document.querySelectorAll("table tbody tr")];
      const main: ExpiryRow[] = [];
      let other = 0;
      for (const r of rows) {
        const cells = [...r.querySelectorAll("td")].map((td) => clean(td.textContent));
        const u = c.user >= 0 ? cells[c.user] : "";
        const branch = c.branch >= 0 ? cells[c.branch] : "";
        if (u.toLowerCase() !== uname.toLowerCase()) { other++; continue; }
        if (!/สาขาหลัก/.test(branch)) { other++; continue; }
        main.push({ serviceId: c.id >= 0 ? cells[c.id] : "", username: u, shopName: c.shop >= 0 ? cells[c.shop] : "", branchType: branch, currentExpiry: c.expiry >= 0 ? cells[c.expiry] : "" });
      }
      return { mainRows: main, otherCount: other };
    },
    { uname: username, c: cols },
  ) as Promise<{ mainRows: ExpiryRow[]; otherCount: number }>;
}

// แคปเฉพาะช่อง "วันที่บอทหมดอายุ" ของแถวสาขาหลักแรกที่ username ตรง (fallback ทั้งหน้า)
async function shotExpiryCell(page: Page, username: string, cols: { user: number; branch: number; expiry: number }): Promise<string | undefined> {
  const rowCount = await page.locator("table tbody tr").count().catch(() => 0);
  for (let i = 0; i < rowCount; i++) {
    const row = page.locator("table tbody tr").nth(i);
    const u = (await row.locator("td").nth(cols.user).textContent().catch(() => ""))?.trim() || "";
    const br = (await row.locator("td").nth(cols.branch).textContent().catch(() => ""))?.trim() || "";
    if (u.toLowerCase() === username.toLowerCase() && /สาขาหลัก/.test(br)) {
      const cell = row.locator("td").nth(cols.expiry);
      await cell.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(250);
      const s = await cell.screenshot({ type: "png" }).catch(() => null);
      if (s) return s.toString("base64");
      break;
    }
  }
  const full = await page.screenshot({ type: "png" }).catch(() => null);
  return full?.toString("base64");
}

// ===== เฟส 1: พรีวิว (ค้นหา + อ่าน + แคปช่องวันหมดอายุปัจจุบัน ให้ยืนยัน) =====
export async function previewExpiry(username: string): Promise<PreviewResult> {
  if (!thunderSessionReady()) return { ok: false, error: "no_session", username, mainRows: [], otherCount: 0 };
  const { browser, page, error } = await openAndSearch(username);
  if (error) return { ok: false, error, username, mainRows: [], otherCount: 0 };
  try {
    const cols = await columnIndexes(page);
    const { mainRows, otherCount } = await readRows(page, username, cols);
    if (!mainRows.length) {
      // แยก "session หมด" ออกจาก "ไม่พบจริง": ถ้า header ไม่มีชื่อบัญชีที่ล็อกอิน = token หมด (SPA เรนเดอร์ shell ได้แต่ดึงข้อมูลไม่ได้ → คืน 0 ทุก user)
      const authed = await page.evaluate(() => /easycarwash|nining|ออกจากระบบ|logout|โปรไฟล์/i.test(document.body.innerText) && !!document.querySelector("table thead"));
      if (!authed) return { ok: false, error: "session_expired", username, mainRows: [], otherCount: 0 };
      const shot = await page.screenshot({ type: "png" }).catch(() => null);
      return { ok: false, error: otherCount ? "no_main_branch" : "not_found", username, mainRows: [], otherCount, screenshotBase64: shot?.toString("base64") };
    }
    const screenshotBase64 = await shotExpiryCell(page, username, cols);
    return { ok: true, username, mainRows, otherCount, screenshotBase64 };
  } finally {
    await browser.close();
  }
}

// เลือกวันปัจจุบันในปฏิทิน Mantine (คลิกช่อง readonly → รอปฏิทิน → เลื่อนเดือนให้ถึงเป้าหมาย → คลิกวัน)
// คืน true เฉพาะเมื่อ date input แสดงเดือน/ปีเป้าหมายจริง (ป้องกันบันทึกวันผิดเดือน)
async function pickToday(page: Page, dlg: Locator, now: Date): Promise<boolean> {
  await dlg.locator("input[readonly]").first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(800); // รอปฏิทินเรนเดอร์
  const target = `${TH_MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  const headerBtn = page.locator("button").filter({ hasText: new RegExp(`^(${TH_MONTHS.join("|")})\\s*\\d{4}$`) }).first();
  // bounded: อ่าน header → เลื่อน next/prev จนถึงเดือนเป้าหมาย (ตัดเร็วถ้าอ่านไม่ได้ กันค้าง)
  let cur = "";
  let emptyStreak = 0;
  for (let i = 0; i < 15; i++) {
    cur = (await headerBtn.textContent({ timeout: 2000 }).catch(() => ""))?.trim() || "";
    if (!cur) { if (++emptyStreak >= 3) break; await page.waitForTimeout(400); continue; }
    emptyStreak = 0;
    if (cur === target) break;
    const [mN, yS] = cur.split(/\s+/);
    const ci = TH_MONTHS.indexOf(mN) + (+yS) * 12;
    const ti = now.getMonth() + now.getFullYear() * 12;
    const dir = ci < ti ? "next" : "previous";
    // ปุ่มลูกศรของ Mantine calendar = sibling ของปุ่ม header (ไม่มี data-direction ในเวอร์ชันนี้)
    let nav = dir === "next" ? headerBtn.locator("xpath=following-sibling::button[1]") : headerBtn.locator("xpath=preceding-sibling::button[1]");
    if ((await nav.count().catch(() => 0)) === 0) {
      const arrows = page.locator('[class*=alendarHeader] button, [class*=CalendarHeader] button');
      nav = dir === "next" ? arrows.last() : arrows.first();
    }
    await nav.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  if (cur !== target) return false; // เลื่อนไปเดือนเป้าหมายไม่ได้ → ไม่คลิก/ไม่ save (กันวันผิด)
  await page
    .locator(`button[class*=DatePicker-day]:not([data-outside])`)
    .filter({ hasText: new RegExp(`^${now.getDate()}$`) })
    .first()
    .click({ timeout: 4000 })
    .catch(() => {});
  await page.waitForTimeout(500);
  // ตรวจค่าใน date input ว่าตรงเดือน/ปีเป้าหมายจริง
  const shown = (await dlg.locator("input[readonly]").first().inputValue().catch(() => "")) || "";
  return shown.includes(TH_MONTHS[now.getMonth()]) && shown.includes(String(now.getFullYear()));
}

async function setTime(dlg: Locator, hh: string, mm: string) {
  const editables = dlg.locator("input:not([readonly])");
  const hourF = editables.nth(0);
  const minF = editables.nth(1);
  await hourF.click({ clickCount: 3, timeout: 3000 }).catch(() => {});
  await hourF.pressSequentially(hh, { delay: 90 }).catch(() => {});
  await minF.click({ clickCount: 3, timeout: 3000 }).catch(() => {});
  await minF.pressSequentially(mm, { delay: 90 }).catch(() => {});
}

// ===== เฟส 2: ลงมือ (ตั้งวัน/เวลาปัจจุบัน + บันทึก ทุกแถวสาขาหลัก) =====
export async function executeExpiry(username: string): Promise<ExecuteResult> {
  if (!thunderSessionReady()) return { ok: false, error: "no_session", updated: 0, updatedRows: [], otherCount: 0 };
  const { browser, page, error } = await openAndSearch(username);
  if (error) return { ok: false, error, updated: 0, updatedRows: [], otherCount: 0 };
  try {
    const cols = await columnIndexes(page);
    if (cols.expiry < 0) return { ok: false, error: "expiry_col_not_found", updated: 0, updatedRows: [], otherCount: 0 };
    // อ่านก่อนว่ามีสาขาหลัก username ตรงเป๊ะไหม (แยก not_found / no_main_branch) + เก็บ oldExpiry/shop
    const { mainRows, otherCount } = await readRows(page, username, cols);
    if (!mainRows.length) return { ok: false, error: otherCount ? "no_main_branch" : "not_found", updated: 0, updatedRows: [], otherCount };
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    let updated = 0;
    let lastRowIdx = -1;
    const updatedRows: { shopName: string; serviceId: string; oldExpiry: string }[] = [];
    const rowCount = await page.locator("table tbody tr").count();
    for (let i = 0; i < rowCount; i++) {
      const row = page.locator("table tbody tr").nth(i);
      const uCell = (await row.locator("td").nth(cols.user).textContent().catch(() => ""))?.trim() || "";
      const bCell = (await row.locator("td").nth(cols.branch).textContent().catch(() => ""))?.trim() || "";
      if (uCell.toLowerCase() !== username.toLowerCase() || !/สาขาหลัก/.test(bCell)) continue;
      const oldExpiry = (await row.locator("td").nth(cols.expiry).textContent().catch(() => ""))?.trim() || "";
      const shopName = cols.shop >= 0 ? ((await row.locator("td").nth(cols.shop).textContent().catch(() => ""))?.trim() || "") : "";
      const serviceId = cols.id >= 0 ? ((await row.locator("td").nth(cols.id).textContent().catch(() => ""))?.trim() || "") : "";
      // กดดินสอในคอลัมน์วันหมดอายุ
      const cell = row.locator("td").nth(cols.expiry);
      await cell.scrollIntoViewIfNeeded().catch(() => {});
      await cell.locator("button").first().click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const dlg = page.locator("[class*=Modal],[role=dialog]").filter({ hasText: /แก้ไขวันหมดอายุ/ }).first();
      if ((await dlg.count().catch(() => 0)) === 0) continue;
      const dateOk = await pickToday(page, dlg, now);
      if (!dateOk) {
        // ตั้งวันไม่ถูก → ปิด popup ไม่บันทึก (กันเขียนวันผิดใส่ลูกค้า)
        await dlg.getByRole("button", { name: /^ยกเลิก$/ }).first().click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(500);
        continue;
      }
      await setTime(dlg, hh, mm);
      await page.waitForTimeout(300);
      await dlg.getByRole("button", { name: /บันทึกข้อมูล/ }).first().click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(2500); // รอ save เสร็จ (มี spinner)
      updated++;
      lastRowIdx = i;
      updatedRows.push({ shopName, serviceId, oldExpiry });
    }
    // แคปเฉพาะช่อง "วันที่บอทหมดอายุ" ของแถวที่ปรับ (โฟกัสเฉพาะส่วนที่เปลี่ยน) — ไม่ใช่ทั้งหน้า
    let shotB64: string | undefined;
    if (lastRowIdx >= 0) {
      const cell = page.locator("table tbody tr").nth(lastRowIdx).locator("td").nth(cols.expiry);
      await cell.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(300);
      const s = await cell.screenshot({ type: "png" }).catch(() => null);
      if (s) shotB64 = s.toString("base64");
    }
    if (!shotB64) {
      const full = await page.screenshot({ type: "png" }).catch(() => null);
      shotB64 = full?.toString("base64");
    }
    return { ok: updated > 0, updated, updatedRows, otherCount, error: updated ? undefined : "no_row_updated", screenshotBase64: shotB64 };
  } finally {
    await browser.close();
  }
}
