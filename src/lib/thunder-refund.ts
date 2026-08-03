import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

/**
 * อ่าน/จัดการ "คำขอคืนเครดิตบริการ" ในระบบหลังบ้าน Thunder
 *  - listPendingRefunds()  : หาแถวสถานะ "รออนุมัติ" ในหน้า /admin/refund  (เฟส 1)
 *  - fetchServiceLog()     : ยืนยันข้ามที่ /admin/logs/service?id=<historyId>  (เฟส 1)
 *  - shotRefundRow()       : แคปตารางตีกรอบแดงแถวเป้าหมาย (สัดส่วนตามที่โด้กำหนด)
 *  - approveRefund()       : กด badge รออนุมัติ → อนุมัติ (เฟส 2 — write path)
 *
 * บทเรียนจาก thunder-expiry ที่ยกมาใช้:
 *  - ห้ามใช้ .fill() กับช่องค้นหา SPA (ไม่ bind model) — แต่ไฟล์นี้ "ไม่ต้องค้นเลย"
 *    เพราะทั้ง 2 หน้ารับ query param: /admin/refund?id=2677 · /admin/logs/service?id=175979
 *    → แม่นกว่า/เร็วกว่า/ไม่โดนกับดัก controlled input (verify จริงแล้ว 2026-07-17)
 *  - session หมด: SPA เรนเดอร์ shell ได้แต่ตารางว่าง → ต้องแยก "ไม่มีข้อมูล" ออกจาก "session หมด"
 */

const BASE = (process.env.THUNDER_ADMIN_URL || "https://old.thunder.in.th").replace(/\/$/, "");

function sessionPath(): string {
  return process.env.THUNDER_SESSION_PATH || path.join(process.cwd(), ".thunder-session.json");
}
export function thunderSessionReady(): boolean {
  return fs.existsSync(sessionPath());
}

/**
 * อ่านวันหมดอายุ session จาก JWT `x-auth` ใน storageState (localStorage) — ไม่ต้องเปิด browser
 * token ของ Thunder อายุ 3 วันเป๊ะ (verify 2026-07-17: สร้าง 14 ก.ค. 17:14 → หมด 17 ก.ค. 17:14)
 * ใช้เตือนโด้ล่วงหน้าก่อนหมด แทนที่จะไปรู้ตอนมีคำขอเข้ามาแล้วทำงานไม่ได้
 */
export function thunderSessionExpiry(): Date | null {
  try {
    const s = JSON.parse(fs.readFileSync(sessionPath(), "utf8")) as {
      origins?: { origin: string; localStorage?: { name: string; value: string }[] }[];
    };
    for (const o of s.origins || []) {
      if (!/thunder/i.test(o.origin)) continue;
      const tok = (o.localStorage || []).find((x) => /auth/i.test(x.name))?.value;
      const payload = tok?.split(".")[1];
      if (!payload) continue;
      const p = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp?: number };
      if (p.exp) return new Date(p.exp * 1000);
    }
  } catch {
    /* อ่านไม่ได้ = ไม่รู้ ก็ปล่อยให้ flow ปกติเจอ session_expired เอง */
  }
  return null;
}

// session หมดแล้ว หรือใกล้หมดภายใน N ชั่วโมง
export function thunderSessionExpiringWithin(hours: number): { expired: boolean; soon: boolean; at: Date | null } {
  const at = thunderSessionExpiry();
  if (!at) return { expired: false, soon: false, at: null };
  const left = at.getTime() - Date.now();
  return { expired: left <= 0, soon: left > 0 && left < hours * 3600 * 1000, at };
}

// render_failed = เปิดหน้าไม่สำเร็จชั่วคราว (โหลดช้า/สะดุด) ทั้งที่ token ยังดี → ลองใหม่รอบหน้า อย่าไปปลุกให้ re-auth
export type RefundError = "no_session" | "session_expired" | "render_failed" | "not_found" | "multiple_rows" | string;

export interface RefundRow {
  refundId: string; // 2677
  username: string; // siwaul
  requestedBy: string; // kornalone1
  historyId: string; // 175979
  historyType: string; // renew | buy
  historyAmount: number | null; // 1599 (ยอดในลิงก์ประวัติบริการ)
  amount: number | null; // 1599 (คอลัมน์ จำนวน)
  reason: string; // ต่ออายุผิด
  createdAtText: string; // 16 ก.ค. 2026, 19:15
  status: string; // รออนุมัติ | อนุมัติแล้ว | ปฏิเสธ
  rowIndex: number; // index ใน tbody (ไว้ตีกรอบ/คลิก)
}

export interface ServiceLogRow {
  historyId: string; // 175979
  username: string; // siwaul
  firstName: string;
  lastName: string;
  shopName: string; // โรงงานลูกชิ้นยายทอง
  category: string; // เช็คสลิป
  type: string; // renew
  packageName: string; // Verify Slip Gold
  price: number | null; // 1599
  renewMonths: string; // 1 เดือน
  autoRenew: string; // ไม่
  boughtAt: string; // 16 ก.ค. 2026, 19:05
  expireAt: string;
  status: string;
}

const RED = "#e11d1d";

// "฿1,599.00" / "+฿1,599" / "1,599฿" → 1599
export function parseBaht(s: string): number | null {
  const m = String(s || "").replace(/[฿,\s+]/g, "").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// "#175979 | renew | ฿1,599.00" → { historyId, type, amount }
function parseHistoryCell(s: string): { historyId: string; type: string; amount: number | null } {
  const t = String(s || "");
  const id = t.match(/#?(\d{3,})/)?.[1] || "";
  const type = t.match(/\b(renew|buy|upgrade|change)\b/i)?.[1]?.toLowerCase() || "";
  const amount = parseBaht(t.split("|").pop() || "");
  return { historyId: id, type, amount };
}

function launch() {
  return chromium.launch({ args: ["--no-sandbox"] });
}

async function newPage() {
  const browser = await launch();
  const context = await browser.newContext({
    storageState: sessionPath(),
    viewport: { width: 1700, height: 1000 },
    deviceScaleFactor: 2,
    locale: "th-TH",
  });
  const page = await context.newPage();
  return { browser, page };
}

/**
 * เข้าหน้า + รอ SPA เรนเดอร์ตาราง — คืน error ถ้า session หมด
 * session หมดมี 2 อาการ: (1) เด้ง login (2) URL เดิมแต่ SPA เรนเดอร์ตารางไม่ได้เลย (body ว่างสนิท)
 *
 * 🔴 กับดักที่โดนมาแล้วจริง (17 ก.ค. เคส #2679 ถูกตีธงแดงผิด):
 *    หน้ากำลังโหลดจะขึ้น "มีข้อมูล 0 รายการ" ก่อน แล้ว backend ค่อยตอบ (ช้าได้หลายวินาที)
 *    → ถ้ารอแค่ "ข้อความ count โผล่" จะอ่านตอน 0 แถว แล้วสรุปผิดว่าไม่เจอ
 *    → เวลาค้นแบบเจาะจง (?id=) ต้องรอ "count ที่ไม่ใช่ 0" หรือมีแถวจริง + retry ก่อนยอมแพ้
 *    (เมโม thunder-expiry เคยเตือนบั๊กเดียวกันนี้ไว้แล้ว)
 *
 * expectRows=true → ค้นเจาะจงรายการเดียว (ต้องมีผล) · false → หน้ารายการรวม (0 แถวก็ถูกต้องได้)
 */
async function openTable(page: Page, url: string, opts: { expectRows?: boolean } = {}): Promise<RefundError | null> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  if (/\/(auth\/)?(sign-?in|login)/i.test(page.url())) return "session_expired";

  const waitShell = () =>
    page
      .waitForFunction(() => !!document.querySelector("table thead th") && /มีข้อมูล\s*[\d,]+\s*รายการ/.test(document.body.innerText), null, {
        timeout: 20000,
        polling: 500,
      })
      .then(() => true)
      .catch(() => false);

  let shellReady = await waitShell();
  if (!shellReady) {
    // โหลดช้า/เน็ตสะดุด ก็เรนเดอร์ไม่ทันได้ → ลองใหม่ 1 ครั้งก่อนสรุป (เคยแจ้ง "session หมด" ผิดมาแล้ว 17 ก.ค. 18:04)
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(2500);
    shellReady = await waitShell();
  }
  if (!shellReady) {
    // แยกให้ชัด: token ยังไม่หมด = ปัญหาชั่วคราว (อย่าไปปลุกโด้ให้ re-auth ฟรีๆ)
    const at = thunderSessionExpiry();
    if (at && at.getTime() > Date.now()) return "render_failed";
    return "session_expired";
  }

  if (opts.expectRows) {
    const gotRows = () =>
      page
        .waitForFunction(
          () => {
            const m = document.body.innerText.match(/มีข้อมูล\s*([\d,]+)\s*รายการ/);
            const nonZero = !!m && m[1].replace(/,/g, "") !== "0";
            return nonZero || document.querySelectorAll("table tbody tr").length > 0;
          },
          null,
          { timeout: 15000, polling: 500 },
        )
        .then(() => true)
        .catch(() => false);
    if (!(await gotRows())) {
      // ให้โอกาสอีกครั้ง (backend ช้า/ผลชั่วคราว) ก่อนสรุปว่าไม่เจอจริง
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(3000);
      await gotRows();
    }
  }

  await page.waitForTimeout(1200); // settle ให้แถวเรนเดอร์ครบ
  return null;
}

// header → index (ทนต่อการสลับ/เพิ่มคอลัมน์ในอนาคต)
async function refundCols(page: Page) {
  return page.evaluate(() => {
    const clean = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
    const heads = [...document.querySelectorAll("table thead th, table thead td")].map((h) => clean(h.textContent));
    const idx = (re: RegExp) => heads.findIndex((h) => re.test(h));
    return {
      id: idx(/^ID$/i),
      user: idx(/^ผู้ใช้$/),
      requestedBy: idx(/ร้องขอโดย/),
      history: idx(/ประวัติบริการ/),
      amount: idx(/^จำนวน$/),
      reason: idx(/หมายเหตุ/),
      createdAt: idx(/สร้างเมื่อ/),
      status: idx(/^สถานะ$/),
    };
  });
}

async function readRefundRows(page: Page): Promise<Omit<RefundRow, "historyType" | "historyAmount">[] & { historyCell: string }[]> {
  const cols = await refundCols(page);
  return page.evaluate((c) => {
    const clean = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
    const rows = [...document.querySelectorAll("table tbody tr")];
    return rows.map((r, i) => {
      const cells = [...r.querySelectorAll("td")].map((td) => clean(td.textContent));
      const at = (n: number) => (n >= 0 ? cells[n] || "" : "");
      return {
        refundId: at(c.id),
        username: at(c.user),
        requestedBy: at(c.requestedBy),
        historyCell: at(c.history),
        amountText: at(c.amount),
        reason: at(c.reason),
        createdAtText: at(c.createdAt),
        status: at(c.status),
        rowIndex: i,
      };
    });
  }, cols) as never;
}

// ===== 1) หาคำขอที่ "รออนุมัติ" (poller เรียกทุกรอบ) =====
export interface ListResult {
  ok: boolean;
  error?: RefundError;
  pending: RefundRow[];
  scanned: number; // อ่านไปกี่แถว (หน้าแรก)
}

export async function listPendingRefunds(): Promise<ListResult> {
  if (!thunderSessionReady()) return { ok: false, error: "no_session", pending: [], scanned: 0 };
  const { browser, page } = await newPage();
  try {
    const err = await openTable(page, `${BASE}/admin/refund`);
    if (err) return { ok: false, error: err, pending: [], scanned: 0 };
    const raw = (await readRefundRows(page)) as unknown as Array<Record<string, string | number>>;
    const pending: RefundRow[] = [];
    for (const r of raw) {
      if (!/รออนุมัติ/.test(String(r.status))) continue;
      const h = parseHistoryCell(String(r.historyCell));
      pending.push({
        refundId: String(r.refundId),
        username: String(r.username),
        requestedBy: String(r.requestedBy),
        historyId: h.historyId,
        historyType: h.type,
        historyAmount: h.amount,
        amount: parseBaht(String(r.amountText)),
        reason: String(r.reason),
        createdAtText: String(r.createdAtText),
        status: String(r.status),
        rowIndex: Number(r.rowIndex),
      });
    }
    return { ok: true, pending, scanned: raw.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), pending: [], scanned: 0 };
  } finally {
    await browser.close();
  }
}

// ===== 2) อ่านคำขอรายตัว (ตอนกดปุ่ม → re-verify ก่อนคืนจริง) =====
export interface FetchRefundResult {
  ok: boolean;
  error?: RefundError;
  row?: RefundRow;
  shotBase64?: string;
}

export async function fetchRefundRow(refundId: string, opts: { shot?: boolean } = {}): Promise<FetchRefundResult> {
  if (!thunderSessionReady()) return { ok: false, error: "no_session" };
  const { browser, page } = await newPage();
  try {
    // หน้า refund รับ ?id= (กรองด้วยไอดีคำขอ) — เจาะจงแถวเดียว ไม่ต้องไล่หาเอง
    const err = await openTable(page, `${BASE}/admin/refund?id=${encodeURIComponent(refundId)}`, { expectRows: true });
    if (err) return { ok: false, error: err };
    const raw = (await readRefundRows(page)) as unknown as Array<Record<string, string | number>>;
    const hit = raw.filter((r) => String(r.refundId) === String(refundId));
    if (!hit.length) return { ok: false, error: "not_found" };
    if (hit.length > 1) return { ok: false, error: "multiple_rows" };
    const r = hit[0];
    const h = parseHistoryCell(String(r.historyCell));
    const row: RefundRow = {
      refundId: String(r.refundId),
      username: String(r.username),
      requestedBy: String(r.requestedBy),
      historyId: h.historyId,
      historyType: h.type,
      historyAmount: h.amount,
      amount: parseBaht(String(r.amountText)),
      reason: String(r.reason),
      createdAtText: String(r.createdAtText),
      status: String(r.status),
      rowIndex: Number(r.rowIndex),
    };
    const shotBase64 = opts.shot ? await shotTable(page, [row.rowIndex]) : undefined;
    return { ok: true, row, shotBase64 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await browser.close();
  }
}

// ===== 3) ยืนยันข้ามที่หน้าประวัติบริการ =====
export interface FetchLogResult {
  ok: boolean;
  error?: RefundError;
  row?: ServiceLogRow;
  shotBase64?: string;
  rowCount?: number;
}

export async function fetchServiceLog(historyId: string, opts: { shot?: boolean } = {}): Promise<FetchLogResult> {
  if (!thunderSessionReady()) return { ok: false, error: "no_session" };
  const { browser, page } = await newPage();
  try {
    // ลิงก์ที่ระบบเองใช้ในคอลัมน์ "ประวัติบริการ" → กรอกช่อง "ไอดีประวัติ" ให้อัตโนมัติ (verify แล้ว: คืน 1 แถว)
    const err = await openTable(page, `${BASE}/admin/logs/service?id=${encodeURIComponent(historyId)}`, { expectRows: true });
    if (err) return { ok: false, error: err };
    const rows = await page.evaluate(() => {
      const clean = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
      const heads = [...document.querySelectorAll("table thead th, table thead td")].map((h) => clean(h.textContent));
      const idx = (re: RegExp) => heads.findIndex((h) => re.test(h));
      const c = {
        id: idx(/^ID$/i),
        user: idx(/^username$/i),
        first: idx(/ชื่อจริง/),
        last: idx(/นามสกุล/),
        shop: idx(/ชื่อร้านค้า/),
        cat: idx(/หมวดหมู่/),
        type: idx(/^ประเภท$/),
        pkg: idx(/แพ็กเกจ/),
        price: idx(/ราคา/),
        months: idx(/ระยะเวลาต่ออายุ/),
        auto: idx(/การต่ออายุอัตโนมัติ/),
        bought: idx(/วันที่ซื้อ/),
        expire: idx(/วันหมดอายุ/),
        status: idx(/^สถานะ$/),
      };
      return [...document.querySelectorAll("table tbody tr")].map((r) => {
        const cells = [...r.querySelectorAll("td")].map((td) => clean(td.textContent));
        const at = (n: number) => (n >= 0 ? cells[n] || "" : "");
        return {
          historyId: at(c.id),
          username: at(c.user),
          firstName: at(c.first),
          lastName: at(c.last),
          shopName: at(c.shop),
          category: at(c.cat),
          type: at(c.type),
          packageName: at(c.pkg),
          priceText: at(c.price),
          renewMonths: at(c.months),
          autoRenew: at(c.auto),
          boughtAt: at(c.bought),
          expireAt: at(c.expire),
          status: at(c.status),
        };
      });
    });
    if (!rows.length) return { ok: false, error: "not_found", rowCount: 0 };
    // ไอดีประวัติต้อง unique — ได้ >1 แถว = ผิดปกติร้ายแรง อย่าเดาเอาแถวแรก
    if (rows.length > 1) return { ok: false, error: "multiple_rows", rowCount: rows.length };
    const r = rows[0];
    const shotBase64 = opts.shot ? await shotTable(page, [0]) : undefined;
    return {
      ok: true,
      rowCount: 1,
      row: { ...r, price: parseBaht(r.priceText) },
      shotBase64,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await browser.close();
  }
}

// ===== 4) แคปตารางตีกรอบแดงแถวเป้าหมาย =====
// สัดส่วนตามที่โด้กำหนด: เห็น "มีข้อมูล N รายการ" + dropdown + ทั้งตาราง โดยแถวเป้าหมายตีกรอบแดง
async function shotTable(page: Page, rowIdxs: number[]): Promise<string | undefined> {
  const clip = await page.evaluate(
    ({ idxs, red }) => {
      const table = document.querySelector("table");
      if (!table) return null;
      const rows = [...document.querySelectorAll("table tbody tr")];
      for (const i of idxs) {
        const r = rows[i] as HTMLElement | undefined;
        if (!r) continue;
        const tds = [...r.querySelectorAll("td")] as HTMLElement[];
        tds.forEach((td, k) => {
          const parts = [`inset 0 3px 0 ${red}`, `inset 0 -3px 0 ${red}`];
          if (k === 0) parts.push(`inset 3px 0 0 ${red}`);
          if (k === tds.length - 1) parts.push(`inset -3px 0 0 ${red}`);
          td.style.boxShadow = parts.join(", ");
        });
      }
      // กรอบภาพ = กล่องที่ครอบ "มีข้อมูล N รายการ" + ตาราง (ไต่ขึ้นไปหา ancestor ที่มีทั้งคู่)
      let box: HTMLElement | null = table.parentElement;
      while (box && !/มีข้อมูล\s*[\d,]+\s*รายการ/.test(box.innerText || "") && box !== document.body) box = box.parentElement;
      const el = (box || table) as HTMLElement;
      el.scrollIntoView({ block: "start" });
      window.scrollBy(0, -12);
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(0, Math.floor(r.left) - 4),
        y: Math.max(0, Math.floor(r.top) - 4),
        width: Math.ceil(Math.min(r.width + 8, window.innerWidth - Math.max(0, r.left - 4))),
        height: Math.ceil(Math.min(r.height + 8, window.innerHeight - Math.max(0, r.top - 4))),
      };
    },
    { idxs: rowIdxs, red: RED },
  );
  await page.waitForTimeout(250);
  const buf = clip && clip.width > 40 && clip.height > 40
    ? await page.screenshot({ type: "png", clip }).catch(() => null)
    : await page.screenshot({ type: "png" }).catch(() => null);
  return buf?.toString("base64");
}

// ===== 5) อนุมัติคืนเครดิต (write path) =====
export interface ApproveExpect {
  username: string; // ต้องตรงกับตอนที่แจ้งแอดมิน
  amount: number | null;
  historyId: string;
}
export interface ApproveResult {
  ok: boolean;
  error?: RefundError | "stale" | "menu_not_found" | "wrong_row" | "approve_item_not_found" | "status_unchanged";
  statusBefore?: string;
  statusAfter?: string;
  shotBase64?: string;
}

/**
 * กด badge "รออนุมัติ" → เมนู "จัดการ #<id>" → กด "อนุมัติ"
 *
 * ⚠️ นี่คือจุดที่แตะเงินลูกค้าจริง — ป้องกัน 4 ชั้น ผิดนิดเดียวคือไม่กด:
 *   1. เปิดหน้าด้วย ?id=<refundId> เจาะจง (ไม่ไล่หาแถวเอง) + ต้องได้แถวเดียว
 *   2. re-verify สด: สถานะยัง "รออนุมัติ" + ยูสเซอร์/ยอด/ไอดีประวัติ ตรงกับตอนแจ้ง (กันข้อมูลเปลี่ยนระหว่างรอแอดมินกด)
 *   3. เมนูต้องมีข้อความ "จัดการ #<refundId>" ตรงเลขคำขอ (กันกดเมนูของแถวอื่น)
 *   4. คลิกเฉพาะปุ่มที่ข้อความ = "อนุมัติ" เป๊ะ (ตัด "ปฏิเสธ" ทิ้งชัดเจน) แล้วอ่านสถานะซ้ำ
 *      ต้องกลายเป็น "อนุมัติแล้ว" เท่านั้นถึงถือว่าสำเร็จ — คลิกติดไม่ใช่ข้อพิสูจน์ว่าระบบ save แล้ว
 */
export async function approveRefund(refundId: string, expect: ApproveExpect): Promise<ApproveResult> {
  if (!thunderSessionReady()) return { ok: false, error: "no_session" };
  const { browser, page } = await newPage();
  try {
    const err = await openTable(page, `${BASE}/admin/refund?id=${encodeURIComponent(refundId)}`, { expectRows: true });
    if (err) return { ok: false, error: err };

    // ---- ชั้น 1+2: แถวเดียว + ข้อมูลตรงกับตอนแจ้ง ----
    const raw = (await readRefundRows(page)) as unknown as Array<Record<string, string | number>>;
    const hits = raw.filter((r) => String(r.refundId) === String(refundId));
    if (hits.length !== 1) return { ok: false, error: hits.length ? "multiple_rows" : "not_found" };
    const r = hits[0];
    const statusBefore = String(r.status);
    if (!/รออนุมัติ/.test(statusBefore)) return { ok: false, error: "stale", statusBefore }; // มีคนจัดการไปแล้ว
    const h = parseHistoryCell(String(r.historyCell));
    const amount = parseBaht(String(r.amountText));
    const same =
      String(r.username).toLowerCase() === expect.username.toLowerCase() &&
      h.historyId === expect.historyId &&
      (expect.amount == null || (amount != null && Math.abs(amount - expect.amount) < 0.005));
    if (!same) return { ok: false, error: "wrong_row", statusBefore };

    const rowIdx = Number(r.rowIndex);
    const row = page.locator("table tbody tr").nth(rowIdx);
    const statusCell = row.locator("td").last();

    // ---- ชั้น 3: เปิดเมนู แล้วเช็คว่าเป็นเมนูของคำขอนี้จริง ----
    await statusCell.locator("[class*=Badge-root], [class*=Badge-inner]").first().click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const menu = page.locator("[class*=Menu-dropdown], [role=menu], [class*=Popover-dropdown], [class*=Dropdown]").filter({ hasText: /จัดการ\s*#\d+/ }).first();
    if ((await menu.count().catch(() => 0)) === 0) return { ok: false, error: "menu_not_found", statusBefore };
    const menuText = (await menu.textContent().catch(() => "")) || "";
    if (!new RegExp(`จัดการ\\s*#${refundId}\\b`).test(menuText.replace(/\s+/g, " "))) {
      await page.keyboard.press("Escape").catch(() => {});
      return { ok: false, error: "wrong_row", statusBefore }; // เมนูไม่ใช่ของคำขอนี้ → ห้ามกดเด็ดขาด
    }

    // ---- ชั้น 4: คลิกเฉพาะ "อนุมัติ" เป๊ะ (ไม่ใช่ "ปฏิเสธ") ----
    const items = menu.locator("button, [role=menuitem], a");
    const n = await items.count().catch(() => 0);
    let approve = null as null | ReturnType<typeof items.nth>;
    for (let i = 0; i < n; i++) {
      const it = items.nth(i);
      const t = ((await it.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      if (/ปฏิเสธ|ยกเลิก/.test(t)) continue; // กันพลาดชัดเจน
      if (/^อนุมัติ$/.test(t)) {
        approve = it;
        break;
      }
    }
    if (!approve) {
      await page.keyboard.press("Escape").catch(() => {});
      return { ok: false, error: "approve_item_not_found", statusBefore };
    }
    await approve.click({ timeout: 6000 });
    await page.waitForTimeout(3000); // รอ save (มี spinner/refetch)

    // ---- ยืนยันผลจากระบบเอง ----
    const after = await page
      .waitForFunction(
        (id: string) => {
          const rows = [...document.querySelectorAll("table tbody tr")];
          const hit = rows.find((tr) => (tr.querySelector("td")?.textContent || "").trim() === id);
          const txt = (hit?.lastElementChild?.textContent || "").replace(/\s+/g, " ").trim();
          return /อนุมัติแล้ว/.test(txt) ? txt : false;
        },
        refundId,
        { timeout: 15000, polling: 500 },
      )
      .then((h) => h.jsonValue() as Promise<string>)
      .catch(() => null);

    if (!after) {
      const cur = ((await statusCell.textContent().catch(() => "")) || "").trim();
      return { ok: false, error: "status_unchanged", statusBefore, statusAfter: cur };
    }
    return { ok: true, statusBefore, statusAfter: after };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await browser.close();
  }
}

/**
 * แคปแถวคำขอตีกรอบแดง — ใช้ยืนยันหลังคืนสำเร็จ
 * ดีฟอลต์ = หน้ารายการเต็ม (ไม่กรอง) แล้วตีกรอบแถวเป้าหมาย → สัดส่วนตามที่โด้กำหนด (เห็น "มีข้อมูล N รายการ" + ตาราง 10 แถว)
 * ถ้าแถวไม่อยู่ในหน้าแรก (คำขอเก่า) → fallback กรองด้วย ?id= (ได้แถวเดียว แต่ยังเห็นชัด)
 */
export async function shotRefundRow(refundId: string): Promise<{ ok: boolean; error?: RefundError; shotBase64?: string; status?: string }> {
  if (!thunderSessionReady()) return { ok: false, error: "no_session" };
  const { browser, page } = await newPage();
  try {
    const err = await openTable(page, `${BASE}/admin/refund`);
    if (err) return { ok: false, error: err };
    const raw = (await readRefundRows(page)) as unknown as Array<Record<string, string | number>>;
    const hit = raw.find((r) => String(r.refundId) === String(refundId));
    if (hit) {
      const shotBase64 = await shotTable(page, [Number(hit.rowIndex)]);
      return { ok: true, shotBase64, status: String(hit.status) };
    }
  } catch {
    // ตกไป fallback ข้างล่าง
  } finally {
    await browser.close();
  }
  const r = await fetchRefundRow(refundId, { shot: true });
  return { ok: r.ok, error: r.error, shotBase64: r.shotBase64, status: r.row?.status };
}
