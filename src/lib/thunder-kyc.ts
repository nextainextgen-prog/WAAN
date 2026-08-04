import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { askGeminiImage } from "./gemini";

/**
 * ดึงข้อมูล "หน้ายืนยันตัวตน (KYC)" ของยูสเซอร์จากระบบหลังบ้าน Thunder
 * ใช้ตอนลูกค้าแจ้งถอน AFF แล้วยังไม่มีเอกสารยืนยันตัวตนในคลัง (ลูกค้าใหม่/เปลี่ยนคนรับเงิน)
 *
 * ขั้นตอนเหมือนที่แอดมินทำมือ: /admin/kyc → ค้นด้วย "ชื่อผู้ใช้" → เอา "รายการล่าสุด" (แถวบนสุด)
 * → กด "ดูข้อมูล" → อ่านค่าในป๊อปอัป + แคปหน้าป๊อปอัปไว้ทำเป็นหน้าเอกสารแนบ
 */

const BASE = (process.env.THUNDER_ADMIN_URL || "https://old.thunder.in.th").replace(/\/$/, "");
function sessionPath(): string {
  return process.env.THUNDER_SESSION_PATH || path.join(process.cwd(), ".thunder-session.json");
}

export interface KycRecord {
  username: string;
  firstName: string;
  lastName: string;
  bank: string;
  account: string;
  address: string;
  rowId?: string; // ID รายการ KYC
  rowDate?: string; // วันที่ยื่นรายการ (แถวล่าสุด)
  modalShot: Buffer; // ภาพป๊อปอัปทั้งใบ → เอาไปวางเป็นหน้าเอกสารยืนยันตัวตน
  photo?: Buffer; // รูปถ่ายถือบัตร (ไว้อ่านเลขบัตร)
}

export type KycError = "no_session" | "session_expired" | "not_found" | "no_modal" | string;

export async function fetchKyc(username: string): Promise<{ ok: boolean; record?: KycRecord; error?: KycError }> {
  if (!fs.existsSync(sessionPath())) return { ok: false, error: "no_session" };
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({
      storageState: sessionPath(),
      viewport: { width: 1440, height: 1200 },
      deviceScaleFactor: 2, // ภาพคมพอสำหรับเอกสารแนบ
      locale: "th-TH",
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin/kyc`, { waitUntil: "networkidle", timeout: 40000 });
    if (/\/auth\/(sign-in|login)/i.test(page.url())) return { ok: false, error: "session_expired" };
    await page.waitForTimeout(1500);
    const uiOk = await page
      .evaluate(() => /KYC|ชื่อผู้ใช้|ค้นหา|ยืนยันตัวตน/i.test(document.body.innerText || ""))
      .catch(() => false);
    if (!uiOk) return { ok: false, error: "session_expired" };

    // ช่องที่ 2 = "ชื่อผู้ใช้" (ช่องแรกคือไอดียูสเซอร์)
    await page.locator("input").nth(1).fill(username);
    await page.getByRole("button", { name: /ค้นหา/ }).first().click().catch(() => {});
    await page.waitForTimeout(2500);

    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll("tbody tr")).map((r) => (r as HTMLElement).innerText.replace(/\s*\n\s*/g, " | ").trim()),
    );
    const dataRows = rows.filter((r) => r && /ดูข้อมูล/.test(r));
    if (!dataRows.length) return { ok: false, error: "not_found" };
    const first = dataRows[0]; // แถวบนสุด = รายการล่าสุด (ตามที่เจ้าของกำหนด)
    const rowId = first.match(/^(\d+)/)?.[1];
    const rowDate = first.match(/(\d{1,2}\s*[ก-๙.]+\s*\d{4},?\s*\d{1,2}:\d{2})/)?.[1];

    await page.getByRole("button", { name: /ดูข้อมูล/ }).first().click();
    await page.waitForTimeout(2500);
    const dlg = page.locator('[role="dialog"], [class*="Modal-content"]').first();
    if (!(await dlg.count())) return { ok: false, error: "no_modal" };

    // รอรูปโหลดจริงก่อนแคป (ไม่งั้นได้กรอบเปล่า)
    await page
      .waitForFunction(() => {
        const im = document.querySelector('[role="dialog"] img, [class*="Modal-content"] img') as HTMLImageElement | null;
        return !!im && im.complete && im.naturalWidth > 0;
      }, undefined, { timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(600);

    const fields = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"], [class*="Modal-content"]');
      const out: Record<string, string> = {};
      d?.querySelectorAll("input,textarea").forEach((i) => {
        const el = i as HTMLInputElement | HTMLTextAreaElement;
        const wrap = el.closest("div");
        const label = (wrap?.parentElement?.querySelector("label")?.textContent || "").trim();
        if (label) out[label] = el.value || "";
      });
      const img = d?.querySelector("img") as HTMLImageElement | null;
      if (img) out.__photo = img.src;
      return out;
    });

    const modalShot = Buffer.from(await dlg.screenshot({ type: "png" }));
    let photo: Buffer | undefined;
    if (fields.__photo) {
      try {
        const r = await page.request.get(fields.__photo, { timeout: 30000 });
        if (r.ok()) photo = Buffer.from(await r.body());
      } catch {
        /* ไม่มีรูปก็ยังทำเอกสารได้ แค่ไม่มีเลขบัตร */
      }
    }

    return {
      ok: true,
      record: {
        username,
        firstName: (fields["ชื่อจริง"] || "").trim(),
        lastName: (fields["นามสกุล"] || "").trim(),
        bank: (fields["ธนาคาร"] || "").trim(),
        account: (fields["เลขบัญชี"] || "").replace(/\D/g, ""),
        address: (fields["ที่อยู่"] || "").replace(/\s+/g, " ").trim(),
        rowId,
        rowDate,
        modalShot,
        photo,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ===== อ่านบัตรประชาชนในรูป KYC → เลข 13 หลัก + คำนำหน้า (ระบบต้องใช้เติมใบสำคัญรับเงิน) =====
export interface IdCardRead {
  taxId: string; // "" ถ้าอ่านไม่ได้/ไม่ผ่านการตรวจ
  prefix: string; // นาย/นาง/นางสาว ("" ถ้าไม่แน่ใจ)
  raw?: string;
}

// ตรวจเลขบัตรประชาชนไทยด้วยสูตร checksum (กันอ่านเลขเพี้ยนแล้วเอาไปใส่เอกสาร)
export function validThaiId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return ((11 - (sum % 11)) % 10) === Number(id[12]);
}

export async function readIdCard(photo: Buffer): Promise<IdCardRead> {
  const prompt =
    `รูปนี้คือภาพลูกค้าถือบัตรประจำตัวประชาชนไทย อ่านข้อมูลจาก "บัตร" ในรูป แล้วตอบเป็น JSON เท่านั้น:\n` +
    `{"taxId":"เลขประจำตัวประชาชน 13 หลัก ตัวเลขล้วนไม่มีเว้นวรรค","prefix":"คำนำหน้าบนบัตร: นาย หรือ นาง หรือ นางสาว","name":"ชื่อ-สกุลภาษาไทยบนบัตร"}\n` +
    `ถ้าอ่านช่องไหนไม่ชัดให้ใส่ "" ห้ามเดา ตอบ JSON ล้วนไม่มีข้อความอื่น`;
  try {
    // maxOutputTokens ต้องเผื่อ "โควตาคิด" ของโมเดลด้วย (ตั้ง 300 แล้วคำตอบถูกตัดทิ้ง = อ่านไม่ได้ทั้งที่อ่านออก)
    const raw = await askGeminiImage(prompt, photo, { timeoutMs: 90_000, temperature: 0, maxOutputTokens: 2048 });
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { taxId: "", prefix: "", raw };
    const j = JSON.parse(m[0]) as { taxId?: string; prefix?: string; name?: string };
    const digits = String(j.taxId || "").replace(/\D/g, "");
    const prefix = ["นาย", "นาง", "นางสาว"].includes(String(j.prefix || "").trim()) ? String(j.prefix).trim() : "";
    return { taxId: validThaiId(digits) ? digits : "", prefix, raw };
  } catch {
    return { taxId: "", prefix: "" };
  }
}

// แยกที่อยู่ไทยจาก KYC (string เดียว) → ส่วนประกอบสำหรับกรอกใบสำคัญรับเงิน
export function splitKycAddress(s: string) {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return {
    houseNo: t.match(/^(\d+(?:\/\d+)?)/)?.[1] || "",
    moo: t.match(/(?:หมู่ที่|หมู่|ม\.)\s*(\d+)/)?.[1] || "-",
    road: t.match(/(?:ถนน|ถ\.)\s*([^\s]+)/)?.[1] || t.match(/(?:ซอย|ซ\.)\s*([^\s]+)/)?.[1] || "-",
    tambon: t.match(/(?:ตำบล|ต\.|แขวง)\s*([ก-๙]+)/)?.[1] || "",
    amphoe: t.match(/(?:อำเภอ|อ\.|เขต)\s*([ก-๙]+)/)?.[1] || "",
    changwat: t.match(/(?:จังหวัด|จ\.)\s*([ก-๙]+)/)?.[1] || "",
  };
}
