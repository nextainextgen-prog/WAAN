import { fetchUrlContent } from "./weblink";
import { askExtractor, isYoutubeUrl, summarizeYoutube } from "./kiki";

/**
 * ท่ออ่านเนื้อหาเดียวของ Vex (เจ้าของสั่ง 4 ส.ค. 2026: "เปิดอ่านไฟล์หรือลิงก์ได้อย่างละเอียด")
 *
 * เดิม: fetch อย่างเดียว → X/IG/FB ได้หน้าเปล่า แล้ว Vex เดาเนื้อหาเอา (เคสจริง โพสต์ @arceyul)
 * ใหม่: YouTube → ดูคลิปจริง · โซเชียล/หน้าที่ต้องล็อกอิน → เปิดใน Chrome ของเจ้าของ · ที่เหลือ → fetch
 *       อ่านไม่ได้จริง = บอกตรง ๆ ว่าอ่านไม่ได้ (ห้ามเดา)
 */

const NEEDS_BROWSER = /(^|\/\/)(www\.)?(x|twitter)\.com|instagram\.com|facebook\.com|fb\.com|threads\.net|tiktok\.com|linkedin\.com|medium\.com|pantip\.com/i;

export interface DeepRead {
  url: string;
  title: string;
  text: string;
  via: "youtube" | "browser" | "web";
  shotBase64?: string;
  ok: boolean;
  problem?: string;
}

export async function readAnyUrl(url: string, opts: { shot?: boolean; note?: string } = {}): Promise<DeepRead> {
  // 1) YouTube — ให้ Gemini ดู/ฟังคลิปจริง (fetch ได้แต่หน้าเว็บ ไม่ได้เนื้อคลิป)
  if (isYoutubeUrl(url)) {
    try {
      const yt = await summarizeYoutube(url, opts.note);
      return { url, title: yt.title, text: yt.summary, via: "youtube", ok: true };
    } catch (e) {
      return { url, title: "คลิป YouTube", text: "", via: "youtube", ok: false, problem: e instanceof Error ? e.message.slice(0, 160) : "ดูคลิปไม่ได้" };
    }
  }

  const viaBrowser = async (): Promise<DeepRead> => {
    const { readUrl, chromeAlive } = await import("./kiki-chrome");
    const alive = await chromeAlive();
    try {
      const r = await readUrl(url, { shot: opts.shot !== false });
      if (r.needLogin || r.text.length < 200) {
        return {
          url,
          title: r.title || url,
          text: r.text,
          via: "browser",
          shotBase64: r.shotBase64,
          ok: false,
          problem: r.needLogin
            ? `เว็บนี้บังคับล็อกอิน และโปรไฟล์ Chrome ของผมยังไม่ได้ล็อกอิน${alive ? "" : " (เพิ่งเปิด Chrome ให้ใหม่)"} — ล็อกอินในหน้าต่างที่เปิดไว้ให้แล้วสั่งใหม่อีกทีครับ`
            : "เปิดหน้าได้แต่ดูดเนื้อหาไม่ออก",
        };
      }
      return { url: r.url, title: r.title || url, text: r.text, via: "browser", shotBase64: r.shotBase64, ok: true };
    } catch (e) {
      return { url, title: url, text: "", via: "browser", ok: false, problem: e instanceof Error ? e.message.slice(0, 160) : "เปิดเบราว์เซอร์ไม่ได้" };
    }
  };

  // 2) เว็บที่รู้อยู่แล้วว่าต้องล็อกอิน → ไปเบราว์เซอร์เลย ไม่ต้องเสียเวลา fetch
  if (NEEDS_BROWSER.test(url)) return viaBrowser();

  // 3) เว็บทั่วไป → fetch ก่อน (เร็ว) ได้เนื้อบางค่อยตกไปเบราว์เซอร์
  try {
    const c = await fetchUrlContent(url);
    if (c.text.trim().length >= 400) return { url: c.url, title: c.title, text: c.text, via: "web", ok: true };
    const b = await viaBrowser();
    return b.ok ? b : { url: c.url, title: c.title, text: c.text, via: "web", ok: c.text.trim().length > 0, problem: b.problem };
  } catch {
    return viaBrowser();
  }
}

/**
 * สรุปข้อความยาวแบบไม่ตัดทิ้ง (เอกสาร 200 หน้าก็อ่านครบ)
 * เดิม saveDocToPersonal ตัดที่ 24,000 ตัวอักษรแล้วทิ้งส่วนที่เหลือเงียบ ๆ
 */
export async function summarizeLong(
  text: string,
  instruction: string,
  opts: { chunkChars?: number; maxChunks?: number; timeoutMs?: number } = {},
): Promise<string> {
  const body = text.trim();
  const chunkChars = opts.chunkChars ?? 16_000;
  const maxChunks = opts.maxChunks ?? 12;
  if (body.length <= chunkChars) {
    return askExtractor(`${instruction}\n\nเนื้อหา:\n${body}`, { timeoutMs: opts.timeoutMs ?? 150_000 });
  }
  const chunks: string[] = [];
  for (let i = 0; i < body.length && chunks.length < maxChunks; i += chunkChars) chunks.push(body.slice(i, i + chunkChars));
  const partials: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const p = await askExtractor(
      `นี่คือ "ส่วนที่ ${i + 1} จาก ${chunks.length}" ของเอกสารยาว สรุปเฉพาะส่วนนี้ให้ครบถ้วน เก็บตัวเลข/ชื่อ/ข้อสรุปสำคัญไว้ทั้งหมด ไม่ต้องเกริ่น:\n\n${chunks[i]}`,
      { timeoutMs: opts.timeoutMs ?? 120_000 },
    ).catch(() => "");
    if (p.trim()) partials.push(`[ส่วนที่ ${i + 1}]\n${p.trim()}`);
  }
  if (!partials.length) return body.slice(0, 6000);
  const joined = partials.join("\n\n");
  if (chunks.length === 1) return joined;
  return askExtractor(
    `${instruction}\n\nด้านล่างคือสรุปย่อยของเอกสารทีละส่วน (เรียงตามลำดับ) — เรียบเรียงรวมเป็นฉบับเดียวที่อ่านรู้เรื่อง ไม่ตกประเด็นสำคัญ:\n\n${joined.slice(0, 60_000)}`,
    { timeoutMs: opts.timeoutMs ?? 180_000 },
  ).catch(() => joined);
}

/** อ่านไฟล์เอกสารแบบละเอียด (ไม่ตัดทิ้ง) — คืนเนื้อดิบ + สรุป */
export async function readDocDeep(filePath: string, fileName: string, note?: string): Promise<{ raw: string; summary: string }> {
  const { extractText } = await import("./extract");
  const { text: raw } = await extractText(filePath);
  if (!raw.trim()) throw new Error("อ่านเนื้อหาในไฟล์ไม่ได้ (ไฟล์ว่างหรือเป็นสแกนภาพ)");
  const summary = await summarizeLong(
    raw,
    `จัดเนื้อหาไฟล์ "${fileName}" เป็นโน้ตภาษาไทยแบบละเอียด: บรรทัดแรกสุด = ชื่อเรื่องสั้น ๆ เว้นบรรทัด แล้วสรุปประเด็นสำคัญเป็นหัวข้อ เก็บรายละเอียด/ตัวเลขที่มีประโยชน์ครบ ไม่ต้องเกริ่น${note ? `\nเจ้าของสั่งว่า: ${note}` : ""}`,
  );
  return { raw, summary };
}
