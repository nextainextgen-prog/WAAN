import { askClaude } from "@/lib/claude";
import { askKiki, retrievePersonalNotes, saveLinkToPersonal, KIKI_GUARD, KIKI_PERSONA, ownerFactsContext, kikiConversation, webResearch, isShoppingQuery, vexLine } from "@/lib/kiki";
import { financeSnapshot, snapshotFacts, fmtBaht } from "@/lib/kiki-finance";
import { vexSay } from "../shared";
import type { Ctx, Handler } from "../types";

export const linkSaveHandler: Handler = async (ctx) => {
  const { text, msgId, is, urls, reply } = ctx;
  const saveLinkIntent = urls.length > 0 && is("link_save");
  if (saveLinkIntent) {
    const saved: string[] = [];
    const failed: string[] = [];
    for (const u of urls) {
      try {
        const r = await saveLinkToPersonal(u, text.slice(0, 150));
        saved.push(r.title);
      } catch {
        failed.push(u);
      }
    }
    const t = await vexSay(
      "เพิ่งอ่านลิงก์ที่เจ้าของส่งมาแล้วเก็บเข้าคลังความรู้ส่วนตัวเรียบร้อย — ยืนยัน + สรุปสั้นมากว่าเรื่องอะไร",
      [...saved.map((s) => `เก็บแล้ว: ${s}`), ...failed.map((f) => `เปิดไม่ได้: ${f}`)],
      saved.length ? `เก็บเข้าคลังแล้วครับ 🔗 ${saved.join(" · ")}` : `เปิดลิงก์ไม่ได้เลยครับ ⚠️ ลองเช็คลิงก์อีกที`,
    );
    return reply([{ kind: "text", text: t, replyTo: msgId }]);
  }

  return null;
};

export const researchHandler: Handler = async (ctx) => {
  const { text, replyText, imageFiles, msgId, is, reply } = ctx;
  // ===== หาข้อมูล/หาสินค้า/ค้นเว็บสด + วิเคราะห์ =====
  if ((is("web_research") || is("shopping")) && !imageFiles.length) {
    try {
      const shopping = is("shopping") || isShoppingQuery(text);
      // ส่งบทสนทนาล่าสุดไปด้วย — เจ้าของถามต่อเนื่องได้ ("เอาแบบเมื่อกี้แต่ถูกกว่า")
      const convoCtx = await kikiConversation(12).catch(() => "");
      const research = await webResearch([replyText, text].filter(Boolean).join("\n"), { context: convoCtx, shopping });
      const answer = await askKiki(
        text,
        `=== ผลค้นเว็บสด (ข้อมูลจริงเรียลไทม์ ใช้ตอบ/วิเคราะห์ได้เลย ห้ามมโนเพิ่ม) ===\n${research.slice(0, 14_000)}\n\n[${shopping ? "จัดเป็นลิสต์ตัวเลือกสินค้า: ชื่อ/ราคา/ข้อดี + ลิงก์ URL เต็มวางบรรทัดของมันเอง (ห้ามตัดลิงก์ทิ้ง ห้ามย่อ) ปิดท้ายฟันธงตัวที่แนะนำสุด+เหตุผล ตัดสินใจแทนเจ้าของได้เลย" : "วิเคราะห์+สรุปตามที่เจ้าของขอ เว้นบรรทัดอ่านง่าย ตัวเลข/วันที่ครบ"}]`,
      );
      return reply([{ kind: "text", text: answer.slice(0, 3900), replyTo: msgId }]);
    } catch { /* ค้นไม่ได้ → ตกไปคุยปกติ ตอบเท่าที่รู้ */ }
  }

  return null;
};

export const docSummaryHandler: Handler = async (ctx) => {
  const { text, replyText, msgId, is, reply } = ctx;
  // ===== สรุปเป็น HTML (เจ้าของสั่ง "สรุป..." = เอกสาร HTML ละเอียดเสมอ) =====
  if (is("doc_summary")) {
    const ctxParts: string[] = [];
    if (replyText) ctxParts.push(`ข้อความที่เจ้าของ reply ถึง (หัวข้อหลักของสรุป):\n"""${replyText.slice(0, 3000)}"""`);
    const notes = await retrievePersonalNotes(text).catch(() => "");
    if (notes) ctxParts.push(`โน้ตส่วนตัวที่เกี่ยวข้อง:\n${notes}`);
    if (/เงิน|บัญชี|รายจ่าย|รายรับ|งบ|ใช้จ่าย/.test(text)) {
      const snap = await financeSnapshot();
      ctxParts.push(`ข้อมูลการเงินจริง:\n${snapshotFacts(snap).join("\n")}\nรายหมวด: ${snap.byCategory.map((c) => `${c.category} ${fmtBaht(c.amount)}฿`).join(", ")}`);
      const txns = await (await import("@/lib/db")).db.financeTxn.findMany({ orderBy: { occurredAt: "desc" }, take: 60 });
      ctxParts.push(`รายการล่าสุด:\n${txns.map((r) => `${r.occurredAt.toLocaleDateString("th-TH-u-ca-gregory")} ${r.type === "income" ? "+" : "-"}${r.amount} ${r.category} ${r.note || ""}`).join("\n")}`);
    }
    const convo = await kikiConversation(30);
    if (convo) ctxParts.push(convo);
    const facts = await ownerFactsContext();
    if (facts) ctxParts.push(facts);

    const raw = await askClaude(
      `คำสั่งจากเจ้าของ: ${text}\n\nสร้าง "เอกสารสรุป HTML" ฉบับสมบูรณ์ ภาษาไทย ละเอียดครบถ้วนตามข้อมูลจริงด้านล่าง ห้ามมโนข้อมูลที่ไม่มี\nข้อกำหนด: ไฟล์ HTML เดียวจบ (<!doctype html> ... </html>) มี CSS ในตัว ธีมสว่าง สะอาด อ่านง่าย มีหัวข้อ/ตาราง/ตัวเลขชัดเจน ถ้ามีข้อมูลตัวเลขให้ทำแถบกราฟง่าย ๆ ด้วย CSS ได้\nตอบเป็นโค้ด HTML ล้วน ๆ เท่านั้น ไม่มีข้อความอื่น\n\n=== ข้อมูลจริง ===\n${ctxParts.join("\n\n")}`,
      { guard: KIKI_GUARD, system: KIKI_PERSONA, timeoutMs: 220_000 },
    );
    const m = raw.match(/<!doctype[\s\S]*<\/html>/i) || raw.match(/<html[\s\S]*<\/html>/i);
    if (m) {
      const html = m[0];
      const name = `สรุป-${new Date().toISOString().slice(0, 10)}.html`;
      return reply([
        { kind: "text", text: await vexLine(`สรุปเสร็จแล้วครับ 📤 เปิดไฟล์ด้านล่างได้เลย`), replyTo: msgId },
        { kind: "document", dataBase64: Buffer.from(html, "utf8").toString("base64"), filename: name, caption: `🌐 ${text.slice(0, 80)}` },
      ]);
    }
    // ทำ HTML ไม่ได้ → ส่งเป็นข้อความปกติ
    return reply([{ kind: "text", text: raw.slice(0, 3800), replyTo: msgId }]);
  }

  return null;
};
