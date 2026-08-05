import { vexLine } from "@/lib/kiki";
import { vexList } from "@/lib/kiki-format";
import type { Handler, Send } from "../types";

/**
 * "ไปหาไฟล์นี้ในเครื่องผมแล้วส่งมาให้หน่อย"
 *
 * เคสที่พัง 5 ส.ค. 2026: เจ้าของ reply ข้อความที่มีชื่อไฟล์อยู่ในนั้น แล้วสั่งให้ไปหา
 * → Vex ตอบว่าไม่รู้ว่า "ไฟล์นี้" คือไฟล์ไหน (ไม่ได้อ่านข้อความที่ reply ถึง)
 *   แถมบอกว่าส่งไฟล์ออกจากเครื่องไม่ได้ ทั้งที่ระบบแนบไฟล์เข้าแชทได้อยู่แล้ว
 *
 * กติกา: ไฟล์ความลับ (กุญแจ/รหัส/เซสชัน) ไม่ส่งออกทางแชท — บอกที่อยู่ให้แทน
 */
export const fileFindHandler: Handler = async (ctx) => {
  const { text, replyText, msgId, is, arg, reply } = ctx;
  if (!is("file_find")) return null;

  const { findFiles, fileForSend, fileHintFrom, humanSize, shortPath, isSensitive } = await import("@/lib/kiki-files");

  // "ไฟล์นี้" = ไฟล์ที่พูดถึงในข้อความที่ reply ถึง — ต้องอ่านจากตรงนั้นให้ได้ก่อน
  const hint = arg("file") || arg("query") || fileHintFrom(text) || fileHintFrom(replyText);
  if (!hint) {
    return reply([{
      kind: "text",
      text: await vexLine("บอกชื่อไฟล์หรือบางส่วนของชื่อมาหน่อยครับ (นามสกุลอะไรก็ได้) เดี๋ยวผมค้นในเครื่องให้"),
      replyTo: msgId,
    }]);
  }

  const hits = await findFiles(hint, 8).catch(() => []);
  if (!hits.length) {
    return reply([{
      kind: "text",
      text: await vexLine(`ค้นทั้งเครื่องแล้วไม่เจอไฟล์ชื่อ "${hint}" ครับ (ค้นด้วย Spotlight + ไล่โฟลเดอร์ Projects, Desktop, Documents, Downloads) — บอกชื่อเต็มหรือโฟลเดอร์ที่คาดว่าอยู่ได้ไหมครับ`),
      replyTo: msgId,
    }]);
  }

  // เจอหลายไฟล์ที่ต่างกันจริง ๆ ให้เลือกก่อน (ชื่อเดียวกันเป๊ะหลายที่ = ส่งตัวที่ตรงที่สุดไปเลย)
  const best = hits[0];
  const others = hits.slice(1, 5);
  const sends: Send[] = [];

  const ready = await fileForSend(best);
  if (!ready.ok) {
    const block = vexList({
      title: `เจอไฟล์แล้ว แต่ยังไม่ได้ส่งให้`,
      items: [{ main: shortPath(best.path), sub: `${humanSize(best.size)} · ${ready.why}` }],
      note: isSensitive(best.path) ? "ถ้าจะดูเนื้อหาจริง ๆ เปิดที่เครื่องเองปลอดภัยกว่าครับ" : undefined,
    });
    return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
  }

  sends.push({ kind: "document", dataBase64: ready.payload.base64, filename: ready.payload.name, caption: shortPath(best.path) });
  const lines = [
    `ไฟล์: ${shortPath(best.path)}`,
    `ขนาด ${humanSize(best.size)} · แก้ไขล่าสุด ${best.mtime.toLocaleString("th-TH-u-ca-gregory", { dateStyle: "medium", timeStyle: "short" })}`,
    others.length ? `เจอชื่อคล้ายกันอีก ${others.length} ที่: ${others.map((o) => shortPath(o.path)).join(" · ")}` : "",
  ].filter(Boolean);
  sends.push({ kind: "text", text: await vexLine(lines.join("\n")), replyTo: msgId });
  return reply(sends);
};
