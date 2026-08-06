import fs from "node:fs";
import path from "node:path";

/**
 * Vex ตรวจสถานะตัวเองจาก "ของจริง" ไม่ใช่จากบันทึก (6 ส.ค. 2026)
 *
 * **บั๊กที่ทำให้ต้องมีไฟล์นี้**
 * `selfStatus()` เดิม grep คำว่า "ยังค้าง / ยังไม่ได้ทำ" จาก `docs/vex-roadmap-2026-08.md`
 * แล้วเอามาตอบว่าตัวเองขาดอะไร — ปัญหาคือบรรทัดเก่าไม่ได้หายไปไหนตอนงานเสร็จ
 * ผลจริงที่เจอ: มันตอบเจ้าของอย่างมั่นใจว่า *"แคปหน้าต่างข้าม Space ยังทำไม่ได้จริง
 * ที่แก้ไปได้แค่เลิกโกหก"* ทั้งที่ทำเสร็จและเทสผ่านไปแล้ววันก่อน (commit 8eec518)
 * จาก 10 บรรทัดที่หยิบไป **มี 3 อย่างที่ทำเสร็จแล้ว** และมีบรรทัดที่อธิบายตัวเองปนมาด้วย
 *
 * ความรู้เรื่องตัวเองที่มาจากไดอารี่ = ความจำที่ไม่มีวันอัปเดต
 * ตรงนี้จึงเปลี่ยนเป็น "ตรวจสด" ทุกครั้ง — แต่ละข้อมีวิธีพิสูจน์ของตัวเอง
 * ข้อไหนพิสูจน์ไม่ได้ ต้องตอบว่า "ไม่รู้" ห้ามเดาว่าเสร็จหรือไม่เสร็จ
 */

export type GapState = "missing" | "done" | "unknown";

export interface Gap {
  id: string;
  title: string;
  /** ถ้ายังขาด มันทำให้เจ้าของเสียอะไร — เอาไว้เรียงลำดับความสำคัญ */
  impact: string;
  check: () => Promise<{ state: GapState; detail: string }>;
}

const ROOT = () => process.env.CHANGOH_ROOT?.trim() || process.cwd();
const readSrc = (rel: string): string => {
  try { return fs.readFileSync(path.join(ROOT(), rel), "utf8"); } catch { return ""; }
};
const exists = (rel: string): boolean => fs.existsSync(path.join(ROOT(), rel));

/** มีข้อความนี้อยู่ในซอร์สไหม — ใช้พิสูจน์ว่า "ความสามารถนั้นมีอยู่จริงในโค้ด" */
const srcHas = (rel: string, needle: string | RegExp): boolean => {
  const s = readSrc(rel);
  if (!s) return false;
  return typeof needle === "string" ? s.includes(needle) : needle.test(s);
};

export const GAPS: Gap[] = [
  {
    id: "spreadsheet",
    title: "อ่านไฟล์ Excel / CSV / PowerPoint",
    impact: "เจ้าของส่งไฟล์งานมาแล้วอ่านไม่ออก ต้องแปลงเองก่อนทุกครั้ง",
    check: async () => {
      const s = readSrc("src/lib/extract.ts");
      const has = /\.xlsx|\.csv|\.pptx/.test(s);
      return { state: has ? "done" : "missing", detail: has ? "extract.ts รองรับแล้ว" : `extract.ts รองรับแค่ ${(s.match(/"\.[a-z]{2,5}"/g) || []).join(" ")}` };
    },
  },
  {
    id: "ocr",
    title: "อ่าน PDF ที่เป็นภาพสแกน (OCR)",
    impact: "เอกสารที่สแกนมาอ่านไม่ได้เลย ได้แต่หน้าเปล่า",
    check: async () => {
      // ห้ามเช็คด้วยคำว่า "OCR" เฉย ๆ — ในไฟล์มีข้อความเตือนว่า "แนะนำให้เปิด OCR"
      // ซึ่งแปลว่า *ไม่มี* OCR แต่ตัวตรวจรอบแรกอ่านแล้วสรุปว่ามีแล้ว (false positive
      // แบบเดียวกับบั๊กที่ทำให้ต้องมีไฟล์นี้) → ต้องเช็คว่ามี "โค้ดที่ทำงานจริง" เท่านั้น
      const has = srcHas("src/lib/extract.ts", /tesseract|inline_data|askVision|ocrImage|createWorker/);
      return { state: has ? "done" : "missing", detail: has ? "extract.ts มีโค้ดถอดข้อความจากภาพจริง" : "extract.ts บอกได้แค่ว่า 'น่าจะเป็นไฟล์สแกน' แต่ไม่มีโค้ดถอดข้อความจากภาพ" };
    },
  },
  {
    id: "eyes_watch",
    title: "เฝ้าข้อความเข้าจากแชทที่สำคัญ",
    impact: "คนใกล้ตัวทักมาแล้วไม่มีใครบอก กว่าจะรู้ก็ตอนเปิดแชทเอง",
    check: async () => {
      const { getSetting } = await import("./kiki");
      const v = (await getSetting("vex_eyes_watch")) || "[]";
      let n = 0;
      try { n = (JSON.parse(v) as unknown[]).length; } catch { n = 0; }
      return { state: n > 0 ? "done" : "missing", detail: n > 0 ? `เฝ้าอยู่ ${n} แชท` : "ยังไม่ได้เฝ้าแชทไหนเลย (ปิดเป็นค่าเริ่มต้น รอเจ้าของสั่งเปิด)" };
    },
  },
  {
    id: "tg_session",
    title: "เซสชัน Telegram ของเจ้าของ (ตาของ Vex)",
    impact: "ตาบอด — อ่านแชท สรุปแชท ส่งข้อความในนามเจ้าของ ทำไม่ได้ทั้งหมด",
    check: async () => {
      try {
        const { VEX_SESSIONS, checkSession, isBroken } = await import("./vex-ops");
        const s = VEX_SESSIONS.find((x) => x.key === "telegram");
        if (!s) return { state: "unknown", detail: "ไม่มีในทะเบียนเซสชัน" };
        const h = checkSession(s);
        return { state: isBroken(h) ? "missing" : "done", detail: h.detail };
      } catch {
        return { state: "unknown", detail: "ตรวจไม่ได้" };
      }
    },
  },
  {
    id: "finance_baseline",
    title: "ฐานการเงินหลัก 4 อย่าง",
    impact: "วิเคราะห์เงินจากยอดไม่กี่วันที่บันทึกไว้ = ตัวเลขที่เอาไปตัดสินใจจริงไม่ได้",
    check: async () => {
      try {
        const { getBaseline } = await import("./kiki-baseline");
        const b = await getBaseline();
        return b.missing.length
          ? { state: "missing", detail: `ยังขาด: ${b.missing.join(" · ")}` }
          : { state: "done", detail: "ครบทั้ง 4 อย่าง" };
      } catch {
        return { state: "unknown", detail: "ตรวจไม่ได้" };
      }
    },
  },
  {
    id: "cross_space_shot",
    title: "แคปหน้าต่างข้าม Space",
    impact: "ภาพหลักฐานที่ส่งให้ดูอาจเป็นของแอปอื่น เชื่อไม่ได้ ต้องเปิดเช็คเอง",
    check: async () => {
      const has = exists("src/lib/kiki-window.ts") && exists("scripts/mac/winlist.c") && srcHas("src/lib/kiki-gui.ts", "captureWindow");
      return { state: has ? "done" : "missing", detail: has ? "kiki-window.ts + winlist.c ต่อเข้ากับ snap() แล้ว" : "ยังไม่มีตัวแคปตามหน้าต่าง" };
    },
  },
  {
    id: "tts_provider",
    title: "ชั้นเสียงที่ถอดเปลี่ยนผู้ให้บริการได้",
    impact: "โควตาเสียงหมดเมื่อไหร่ = พูดไม่ได้เลย ไม่มีตัวสำรอง",
    check: async () => {
      const has = srcHas("src/lib/tts.ts", "kiki_tts_provider");
      const hasKey = Boolean(process.env.OPENAI_API_KEY?.trim());
      if (!has) return { state: "missing", detail: "tts.ts ยังไม่มีชั้นเลือกผู้ให้บริการ" };
      return hasKey
        ? { state: "done", detail: "มีชั้นเลือกผู้ให้บริการ และมีคีย์สำรองแล้ว" }
        : { state: "missing", detail: "มีชั้นเลือกผู้ให้บริการแล้ว แต่ยังไม่มี OPENAI_API_KEY เลยเหลือเจ้าเดียว" };
    },
  },
  {
    id: "social_send",
    title: "กดส่งโพสต์/คอมเมนต์โซเชียลจริง",
    impact: "ร่างได้อย่างเดียว ทุกอันต้องรอเจ้าของมากดเอง",
    check: async () => {
      try {
        const { getSetting } = await import("./kiki");
        const v = await getSetting("vex_social_sent_count");
        const n = Number(v || 0);
        return n > 0
          ? { state: "done", detail: `เคยกดส่งจริงแล้ว ${n} ครั้ง` }
          : { state: "missing", detail: "ระบบพร้อมแล้วแต่ยังไม่เคยกดส่งจริงสักครั้ง (รอเจ้าของสั่ง)" };
      } catch {
        return { state: "unknown", detail: "ตรวจไม่ได้" };
      }
    },
  },
  {
    id: "answer_review",
    title: "ตรวจคำตอบตัวเองก่อนส่ง",
    impact: "ตอบไม่ครบ/เคลมเกินหลักฐานแล้วไม่มีใครจับได้ก่อนถึงมือเจ้าของ",
    check: async () => {
      const has = exists("src/lib/kiki-review.ts") && srcHas("src/app/api/kiki/ingest/route.ts", "reviewAnswer");
      return { state: has ? "done" : "missing", detail: has ? "มีชั้นตรวจก่อนส่งแล้ว" : "ยังไม่มี — เขียนเสร็จส่งเลย ไม่เคยอ่านทวน" };
    },
  },
  {
    id: "act_tools",
    title: "ลูปที่ลงมือทำได้ ไม่ใช่อ่านอย่างเดียว",
    impact: "ทำวงจร ลอง → เห็นผล → แก้ → ลองใหม่ ไม่ได้ ตันตรงที่ต้องให้เจ้าของสั่งซ้ำ",
    check: async () => {
      const has = srcHas("src/lib/kiki-agent.ts", "ACT_TOOLS");
      return { state: has ? "done" : "missing", detail: has ? "ลูปมีเครื่องมือลงมือแล้ว" : "เครื่องมือในลูปอ่านได้อย่างเดียวทั้งหมด" };
    },
  },
  {
    id: "followup_dispatch",
    title: "ทำต่อให้ครบเมื่อคำสั่งเดียวมีหลายเรื่อง",
    impact: "สั่ง 3 อย่างได้คำตอบเรื่องเดียว ที่เหลือหายเงียบโดยไม่มีใครบอก",
    check: async () => {
      const has = srcHas("src/app/api/kiki/ingest/route.ts", "runFollowUp");
      return { state: has ? "done" : "missing", detail: has ? "มีรอบตามเก็บส่วนที่ยังไม่ได้ทำแล้ว" : "ยังไม่มี — ตัวจัดการตัวแรกตอบแล้วจบทันที" };
    },
  },
];

export interface GapReport {
  id: string;
  title: string;
  impact: string;
  state: GapState;
  detail: string;
}

/** ตรวจทุกข้อพร้อมกัน — ข้อไหนพังก็แค่ข้อนั้นเป็น unknown ไม่ล้มทั้งชุด */
export async function checkGaps(): Promise<GapReport[]> {
  return Promise.all(
    GAPS.map(async (g) => {
      const r = await g.check().catch(() => ({ state: "unknown" as GapState, detail: "ตรวจไม่ได้" }));
      return { id: g.id, title: g.title, impact: g.impact, state: r.state, detail: r.detail };
    }),
  );
}

/** ข้อความสรุปสถานะตัวเอง — ใช้ตอบเจ้าของเวลาถามว่ายังขาดอะไร */
export async function gapsText(): Promise<string> {
  const rows = await checkGaps();
  const miss = rows.filter((r) => r.state === "missing");
  const unk = rows.filter((r) => r.state === "unknown");
  const done = rows.filter((r) => r.state === "done");
  const out: string[] = [];
  if (miss.length) out.push(`[ยังขาดจริง — ตรวจสดแล้ว ${miss.length} ข้อ]\n${miss.map((r) => `- ${r.title} · ${r.detail}\n  ผลกระทบ: ${r.impact}`).join("\n")}`);
  if (unk.length) out.push(`[ตรวจไม่ได้ ${unk.length} ข้อ — ห้ามเดาว่าเสร็จหรือไม่เสร็จ]\n${unk.map((r) => `- ${r.title}`).join("\n")}`);
  if (done.length) out.push(`[ทำเสร็จแล้ว ${done.length} ข้อ — ห้ามพูดว่ายังไม่ได้ทำ]\n${done.map((r) => `- ${r.title} · ${r.detail}`).join("\n")}`);
  return out.join("\n\n");
}
