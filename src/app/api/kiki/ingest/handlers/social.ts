import { extractUrls } from "@/lib/weblink";
import { vexList } from "@/lib/kiki-format";
import { askKiki, sanitizeVexText, vexLine, setPendingFor } from "@/lib/kiki";
import type { Ctx, Handler } from "../types";
import { ok, type Send } from "../types";

export const socialStatusHandler: Handler = async (ctx) => {
  const { text, msgId, is, reply } = ctx;
  // ===== โซเชียล: ตอบโพสต์ / โพสต์ใหม่ / เช็คสถานะ (เจ้าของเลือกทาง A — Chrome ตัวจริง) =====
  if (is("social_status")) {
    const { ensureChrome, socialLoginStatus, chromeCdpUrl } = await import("@/lib/kiki-chrome");
    const st = await ensureChrome();
    if (!st.ok) {
      return reply([{ kind: "text", text: await vexLine(`เปิด Chrome ของผมไม่ได้ครับ ⚠️ ${st.msg}\n\nสั่งเปิดเองได้ที่เครื่อง: npm run kiki:chrome`), replyTo: msgId }]);
    }
    const rows = await socialLoginStatus().catch(() => []);
    const block = vexList({
      title: "สถานะเบราว์เซอร์ของผม",
      items: [
        { main: `Chrome พร้อมใช้งาน${st.started ? " (เพิ่งเปิดให้)" : ""}`, sub: chromeCdpUrl() },
        ...rows.map((r) => ({ main: `${r.site} — ${r.loggedIn ? "ล็อกอินอยู่" : "ยังไม่ได้ล็อกอิน"}` })),
      ],
      note: rows.some((r) => !r.loggedIn)
        ? "อันที่ยังไม่ล็อกอิน: ล็อกอินในหน้าต่าง Chrome ที่ผมเปิดไว้ครั้งเดียวพอ แล้วผมใช้ได้ตลอด"
        : "ครบแล้วครับ ส่งลิงก์โพสต์มาได้เลย",
    });
    return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
  }

  return null;
};

export const socialDraftHandler: Handler = async (ctx) => {
  const { text, platform, replyText, msgId, is, channel, reply } = ctx;
  if (is("social_reply") || is("social_post")) {
    const { draftReply, platformOf } = await import("@/lib/kiki-chrome");
    const linkFromText = [...extractUrls(text), ...extractUrls(replyText)][0] || "";
    let target = linkFromText;
    if (!target && is("social_post")) target = "https://x.com/compose/post";
    if (!target) {
      return reply([{ kind: "text", text: await vexLine("ส่งลิงก์โพสต์ที่จะให้ตอบมาด้วยครับ (หรือ reply ข้อความที่มีลิงก์นั้น) แล้วบอกว่าจะให้ตอบว่าอะไร"), replyTo: msgId }]);
    }
    // ให้ Vex ร่างข้อความเอง (โทนเหมือนเจ้าของพิมพ์) — อ่านโพสต์ก่อนถ้าเป็นการตอบ
    let postCtx = "";
    if (is("social_reply")) {
      const { readAnyUrl } = await import("@/lib/kiki-read");
      const r = await readAnyUrl(target, { shot: false }).catch(() => null);
      if (r?.ok) postCtx = `เนื้อหาโพสต์ที่จะตอบ:\n${r.text.slice(0, 4000)}`;
      else if (r?.problem) postCtx = `(อ่านโพสต์ไม่ได้: ${r.problem})`;
    }
    const drafted = await askKiki(
      `[ร่างข้อความโซเชียล] เจ้าของสั่ง: """${text}"""\n${postCtx}\n\nเขียน "ข้อความที่จะโพสต์/ตอบจริง" ในนามเจ้าของ (โทนเหมือนเขาพิมพ์เอง ไม่ต้องแนะนำตัว ไม่ต้องมีคำนำ) ตอบเฉพาะตัวข้อความเท่านั้น`,
    ).catch(() => "");
    const message = sanitizeVexText(drafted).text.replace(/<[^>]+>/g, "").trim().slice(0, 900);
    if (!message) return reply([{ kind: "text", text: await vexLine("ร่างข้อความไม่สำเร็จครับ ลองบอกใหม่ว่าจะให้ตอบแนวไหน"), replyTo: msgId }]);

    const d = await draftReply(target, message).catch((e) => ({
      ok: false, url: target, platform: platformOf(target), typed: "", shotBase64: undefined,
      msg: e instanceof Error ? e.message.slice(0, 160) : "เปิดเบราว์เซอร์ไม่ได้",
    }));
    const sends: Send[] = [];
    if (d.shotBase64) sends.push({ kind: "photo", dataBase64: d.shotBase64, filename: "draft.png", caption: "หน้าจอจริงตอนนี้ (พิมพ์ค้างไว้ ยังไม่ส่ง)" });
    if (!d.ok) {
      sends.push({ kind: "text", text: `ยังส่งไม่ได้ครับ ⚠️ ${d.msg}\n\nข้อความที่ร่างไว้:\n${message}`, replyTo: msgId }); // canned-ok: โชว์ข้อความที่ร่างไว้ตรงตัว ห้ามให้ AI แต่งใหม่
      return reply(sends);
    }
    await setPendingFor("kiki_pending_social", channel, { url: d.url, text: message, what: is("social_post") ? "โพสต์ใหม่" : "ตอบโพสต์" });
    sends.push({
      kind: "text",
      text: `พิมพ์ค้างไว้ในหน้าจริงแล้วครับ (${d.platform.toUpperCase()}) ยังไม่กดส่ง\n\nข้อความ:\n${message}\n\nกดยืนยันแล้วผมกดส่งให้เลย`, // canned-ok: โชว์ข้อความที่พิมพ์ค้างไว้ตรงตัว + ปุ่มยืนยัน
      replyTo: msgId,
      buttons: [[{ text: "ส่งเลย", data: "kiki:social:send" }, { text: "ยกเลิก", data: "kiki:social:no" }]],
    });
    return reply(sends);
  }

  return null;
};
