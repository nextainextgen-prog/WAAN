import path from "node:path";
import fs from "node:fs";
import { MAC_RE, quickMac, macAgent } from "@/lib/kiki-mac";
import { askExtractor, setSetting, kikiConversation, getSetting, ttsOgg, vexLine, pendingElsewhereNote } from "@/lib/kiki";
import type { Ctx, Handler } from "../types";
import { ok, type Send } from "../types";

export const hermesHandler: Handler = async (ctx) => {
  const { chatId, text, msgId, is, reply } = ctx;
  // ===== ฝาก Hermes — งานยาก/หลายขั้น/ใช้เวลานาน (agent GPT-5.5 + เว็บ/เบราว์เซอร์/terminal) =====
  // จับทั้งแบบระบุชื่อ ("ฝาก Hermes ...") และแบบธรรมชาติ ("ผมฝากไปสร้าง...", "ฝากไปทำ...หน่อย")
  // — เคยพลาด: เจ้าของพิมพ์ "ฝากไปสร้างพื้นที่..." ไม่เข้า pattern แล้ว Vex แต่งคำสั่ง "ฝาก Hermes" เองซึ่งไม่มีผล งานหายเงียบ
  const hermesM =
    text.match(/^\s*(?:ผม)?(?:ฝาก|ให้)\s*(?:เฮอ(?:ร์)?เ?มี?ส|hermes)\s*(?:ไป|ช่วย|ทำ|จัดการ)?\s*[:：]?\s*([\s\S]{5,})/i) ||
    (!/ฝากบอก|ฝากแคป|ฝากทัก/.test(text) ? text.match(/^\s*(?:ผม)?ฝาก(?:มัน|ไป)\s*(?:ไป)?((?:สร้าง|ทำ|จัด|หา|เช็ค|รวบรวม|เตรียม)[\s\S]{5,})/) : null);
  if (hermesM || is("hermes")) {
    const { kikiHermesReady, queueHermesJob } = await import("@/lib/kiki-hermes");
    if (!kikiHermesReady()) return reply([{ kind: "text", text: await vexLine(`Hermes ยังไม่พร้อมใช้ในเครื่องครับ ⚠️ (หา CLI ไม่เจอ)`), replyTo: msgId }]);
    const task = (hermesM?.[1] || text).trim();
    const q = await queueHermesJob(chatId, task);
    const { pushFocus } = await import("@/lib/kiki-jobs");
    await pushFocus({ kind: "job", ref: q.id, label: task.slice(0, 50) });
    const wait = q.queued
      ? `ตอนนี้งานเต็มมืออยู่ เรื่องนี้ต่อคิวเป็นลำดับที่ ${q.ahead + 1} — ถึงคิวเมื่อไหร่ผมเริ่มให้เอง`
      : "ใช้เวลาได้ถึง 15 นาที";
    return reply([{ kind: "text", text: `รับงานแล้วครับ 🎯 ส่งต่อให้ Hermes ทำเบื้องหลัง\n\nงาน: ${task.slice(0, 200)}\n\n${wait} เสร็จเมื่อไหร่ผมเอาผลมาส่งเอง ระหว่างนี้สั่งงานอื่นได้ปกติ`, replyTo: msgId }]); // canned-ok: โควตงานที่รับมาตรงตัว
  }

  return null;
};

export const voiceAnnounceHandler: Handler = async (ctx) => {
  const { text, msgId, is, arg, reply } = ctx;
  // ===== ให้ Vex พูดขึ้นมาเองในสาย (เฟส 2 — 4 ส.ค. 2026) =====
  // กติกาเจ้าของ: ทุกอย่างที่เป็นเชิงรุก "ค่าเริ่มต้นคือไม่พูด" ต้องสั่งเปิดทีละกฎด้วยปาก
  // ห้ามเปิดหมดแล้วรอให้เจ้าของมาปิดทีหลัง
  if (!is("voice_announce")) return null;
  const { ANNOUNCE_KEY, ownerInVoice } = await import("@/lib/kiki-outbox");
  const mode = arg("mode");
  const off = mode ? mode === "off" : /ปิด|เลิก|หยุด|ไม่ต้อง|เงียบ|ไม่เอา/.test(text);
  await setSetting(ANNOUNCE_KEY, off ? "" : "1");
  if (off) {
    return reply([{ kind: "text", text: await vexLine("เงียบแล้วครับ จะไม่พูดขึ้นมาเองอีก รอโด้ถามอย่างเดียว"), replyTo: msgId }]);
  }
  const inVoice = await ownerInVoice();
  return reply([{
    kind: "text",
    text: await vexLine(
      `เปิดให้ผมพูดขึ้นมาเองแล้วครับ — บรีฟเช้า เตือนนัด บิลใกล้ตัด งานที่ฝากไว้เสร็จ พวกนี้ผมจะบอกเอง\n` +
      (inVoice ? "ตอนนี้โด้อยู่ในสายอยู่ ผมพูดให้ฟังได้เลย" : "ตอนนี้โด้ยังไม่อยู่ในสาย ผมจะโพสต์ไว้ในห้องแชทก่อน แล้วพูดตอนเข้าสาย") +
      `\nเบื่อเมื่อไหร่บอก "เงียบไว้" ได้เลย`,
    ),
    replyTo: msgId,
  }]);
};

/**
 * "พูดว่า ..." — พูดประโยคเดียวออกมาเป็นเสียง ไม่ใช่ตั้งค่าโหมด
 * เคสจริง 4 ส.ค. 2026: เจ้าของสั่ง 'ให้พูดว่า "ผมไม่ได้พูดครับ อั๋นพูดเอง" ส่งมาเป็นเสียง'
 * → ระบบไปเปิดโหมดตอบเสียงซ้ำสองรอบ ไม่ได้พูดประโยคที่สั่งสักที
 */
export const sayVoiceHandler: Handler = async (ctx) => {
  const { text, msgId, is, arg, reply } = ctx;
  if (!is("say_voice")) return null;
  const say = (arg("say") || arg("text") || arg("message") || "").trim();
  if (!say) {
    return reply([{ kind: "text", text: await vexLine("บอกประโยคที่จะให้ผมพูดมาด้วยครับ"), replyTo: msgId }]);
  }
  const ogg = await ttsOgg(say).catch(() => null);
  if (!ogg) {
    return reply([{ kind: "text", text: await vexLine(`ทำไฟล์เสียงไม่สำเร็จรอบนี้ครับ ข้อความที่จะพูดคือ: ${say}`), replyTo: msgId }]);
  }
  // ส่งเสียงอย่างเดียวตามที่สั่ง ไม่ต้องมีข้อความอธิบายมากวน
  return reply([{ kind: "voice", dataBase64: ogg.toString("base64"), filename: "vex.ogg", replyTo: msgId }]);
};

export const voiceModeHandler: Handler = async (ctx) => {
  const { text, msgId, is, arg, reply } = ctx;
  // ===== โหมดตอบเสียงตลอด =====
  // เจตนา voice_mode มีในแคตตาล็อกมาตลอดแต่ไม่เคยมีตัวรับ — พูดคนละคำกับ regex เมื่อไหร่ คำสั่งหายเงียบ
  // (ซ่อมตอนผ่าไฟล์ 4 ส.ค. 2026 · สำคัญเป็นพิเศษเพราะเฟสถัดไปคือเลขาเสียง สั่งด้วยปากล้วน)
  //
  // เปิดหรือปิด ให้ตัวอ่านเจตนาบอกมาทาง args — ห้ามเดาเอาจากคำใน regex
  // เคยพลาดตอนเทส: "ไม่ต้องพูดแล้ว ตอบเป็นตัวหนังสือพอ" ไม่มีคำว่า "ปิด" เลยกลายเป็นสั่งเปิด
  const mode = arg("mode");
  const wantsOff = mode ? mode === "off" : /ปิด|เลิก|หยุด|ไม่เอา|พอแล้ว|ข้อความพอ|ตัวหนังสือ|ไม่ต้องพูด|ไม่ต้องอ่าน/.test(text);
  if (is("voice_mode") && mode !== "change" && !/เปลี่ยนเสียง|ใช้เสียง|เอาเสียง|เสียงอะไรบ้าง/.test(text)) {
    await setSetting("kiki_voice_always", wantsOff ? "" : "1");
    const sends: Send[] = [{
      kind: "text",
      text: await vexLine(wantsOff
        ? 'ปิดโหมดตอบเสียงตลอดแล้วครับ จะพูดเฉพาะตอนโด้พูดมา หรือสั่ง "ตอบเสียง"'
        : 'เปิดโหมดตอบเสียงตลอดแล้วครับ ทุกคำตอบจะมีเสียงแนบ เบื่อเมื่อไหร่บอก "ปิดโหมดเสียง"'),
      replyTo: msgId,
    }];
    if (!wantsOff) {
      const ogg = await ttsOgg("เปิดโหมดพูดตลอดแล้วครับผม ต่อไปนี้ผมพูดให้ฟังทุกคำตอบเลย");
      if (ogg) sends.push({ kind: "voice", dataBase64: ogg.toString("base64"), filename: "vex.ogg" });
    }
    return reply(sends);
  }
  if (/ตอบเสียงตลอด|โหมดเสียง(?!.{0,6}(ปิด|ออก))|พูดตลอด|ตอบเป็นเสียงทุกครั้ง/.test(text) && !/ปิด|เลิก|หยุด|ไม่เอา/.test(text)) {
    await setSetting("kiki_voice_always", "1");
    const sends: Send[] = [{ kind: "text", text: await vexLine(`เปิดโหมดตอบเสียงตลอดแล้วครับ ทุกคำตอบจะมีเสียงแนบ เบื่อเมื่อไหร่พิมพ์ "ปิดโหมดเสียง"`), replyTo: msgId }];
    const ogg = await ttsOgg("เปิดโหมดพูดตลอดแล้วครับผม ต่อไปนี้ผมพูดให้ฟังทุกคำตอบเลย");
    if (ogg) sends.push({ kind: "voice", dataBase64: ogg.toString("base64"), filename: "vex.ogg" });
    return reply(sends);
  }
  if (/(ปิด|เลิก|หยุด|ไม่เอา).{0,10}(โหมดเสียง|ตอบเสียง|พูดตลอด)|ตอบข้อความพอ/.test(text)) {
    await setSetting("kiki_voice_always", "");
    return reply([{ kind: "text", text: await vexLine("ปิดโหมดตอบเสียงตลอดแล้วครับ ✅ จะพูดเฉพาะตอนพี่พูดมา หรือสั่ง \"ตอบเสียง\""), replyTo: msgId }]);
  }

  return null;
};

export const devConfirmHandler: Handler = async (ctx) => {
  const { chatId, text, msgId, channel, reply } = ctx;
  // ===== พัฒนาตัวเอง: ยืนยัน/ยกเลิก =====
  {
    const { getPendingDev, setPendingDev, queueDevJob, devJobRunning } = await import("@/lib/kiki-dev");
    const box = await getPendingDev(channel);
    // สั่งแก้โค้ดตัวเองจากช่องทางหนึ่งแล้วกดยืนยันอีกช่องทาง = ไม่ให้ผ่าน (ถอนยากที่สุดในบรรดาร่างทั้งหมด)
    if (box && !box.sameChannel && /^\[ปุ่ม:(พัฒนาเลย|ยกเลิกพัฒนา)\]$/.test(text)) {
      // canned-ok: เหตุผลเดียวกัน — ห้ามให้ถ้อยคำกลายเป็นการเคลมว่าสั่งงานพัฒนาไปแล้ว
      return reply([{ kind: "text", text: pendingElsewhereNote("งานพัฒนา", box.channel), replyTo: msgId }]);
    }
    const pendingDev = box?.sameChannel ? box.spec : null;
    if (pendingDev && text === "[ปุ่ม:ยกเลิกพัฒนา]") {
      await setPendingDev(null, channel);
      return reply([{ kind: "text", text: await vexLine("ยกเลิกแล้วครับ ✅ ไม่พัฒนา"), replyTo: msgId }]);
    }
    if (pendingDev && text === "[ปุ่ม:พัฒนาเลย]") {
      await setPendingDev(null, channel);
      if (await devJobRunning()) return reply([{ kind: "text", text: await vexLine(`มีงานพัฒนารันอยู่แล้วครับ ⚠️ รอตัวเดิมจบก่อน (สูงสุด 45 นาที) ค่อยสั่งตัวใหม่`), replyTo: msgId }]);
      await queueDevJob(chatId, pendingDev);
      return reply([{ kind: "text", text: await vexLine(`รับงานแล้วครับ 🎯 ส่งสเปกให้วิศวกร (Claude ตัวเดียวกับที่พี่ใช้) ลงมือแก้โค้ดผมแล้ว\n\nใช้เวลาได้ถึง 45 นาที เสร็จแล้วรายงานพร้อม commit — ช่วงท้ายผมจะรีสตาร์ทตัวเองแป๊บนึง ถ้าเงียบช่วงสั้น ๆ คือกำลังเกิดใหม่ครับ`), replyTo: msgId }]);
    }
  }

  return null;
};

export const selfDevHandler: Handler = async (ctx) => {
  const { text, replyText, msgId, is, channel, reply } = ctx;
  // ===== พัฒนาตัวเอง: รับสเปก + ปุ่มยืนยัน =====
  // แบบชัด: "พัฒนา: <สเปก>" · แบบหลวม: "มึงพัฒนาเองได้ ทำเลย" (สเปกอยู่ในเรื่องที่เพิ่งคุย — เคสจริง 3 ส.ค.)
  const devM = text.match(/^\s*(?:พัฒนา(?:ตัวเอง|ระบบ)?|อัปเกรด(?:ตัวเอง|ระบบ)?|เพิ่ม(?:ความสามารถ|ฟีเจอร์)|สร้างระบบ|ทำระบบ|แก้บั๊ก)\s*[:：]?\s*([\s\S]{10,})/);
  const devLoose = !devM && /(พัฒนา|อัปเกรด).{0,16}(ตัวเอง|เอง)|เพิ่มความสามารถ(ตัวเอง)?|ทำเองได้.{0,10}ทำเลย/.test(text) && !text.startsWith("[ปุ่ม");
  if ((devM || devLoose || is("self_dev")) && !text.startsWith("[ปุ่ม")) {
    const { setPendingDev } = await import("@/lib/kiki-dev");
    let spec = devM?.[1]?.trim() || "";
    if (!spec) {
      // สกัดสเปกจากบทสนทนา: เจ้าของเพิ่งบ่น/อยากได้อะไร
      const convo = await kikiConversation(14);
      try {
        const rawS = await askExtractor(`${convo}\n\nข้อความล่าสุดของเจ้าของ: """${text}"""${replyText ? `\n(reply ถึง: """${replyText.slice(0, 500)}""")` : ""}`, {
          system: `เจ้าของสั่งให้ "พัฒนาตัวเอง" โดยไม่บอกสเปกตรง ๆ — สเปกคือความสามารถที่เจ้าของเพิ่งอยากได้/เพิ่งถูกปฏิเสธในบทสนทนา ตอบ JSON เท่านั้น: {"spec":"สเปกที่ต้องพัฒนา เขียนชัด ๆ 1-3 ประโยค","confident":true/false}
ไม่แน่ใจว่าเจ้าของหมายถึงอะไร = confident:false`,
          timeoutMs: 60_000,
        });
        const mS = rawS.match(/\{[\s\S]*\}/);
        const j = mS ? (JSON.parse(mS[0]) as { spec?: string; confident?: boolean }) : null;
        if (j?.confident && j.spec) spec = j.spec.trim();
      } catch { /* ถามกลับข้างล่าง */ }
      if (!spec) {
        return reply([{ kind: "text", text: await vexLine(`ได้ครับ ผมพัฒนาตัวเองได้จริง — แต่ขอสเปกชัด ๆ หน่อยว่าให้เพิ่มอะไร\n\nพิมพ์: พัฒนา: <สิ่งที่อยากได้>`), replyTo: msgId }]);
      }
    }
    await setPendingDev(spec, channel);
    return reply([{
      kind: "text",
      text: `จะส่งสเปกนี้ให้วิศวกรแก้โค้ดผมจริง ๆ นะครับ:\n\n"${spec.slice(0, 500)}"\n\nกติกา: แตะได้เฉพาะโค้ดฝั่งผม (Vex) · tsc ต้องผ่าน · commit+push · เสร็จแล้วรีสตาร์ทตัวเอง+รายงาน\nถ้าของที่ได้ไม่ตรงใจ บอกพี่โด้ให้ย้อน commit ได้เสมอ`, // canned-ok: สเปกที่จะส่งให้วิศวกร + กติกา ต้องตรงตัว
      replyTo: msgId,
      buttons: [[{ text: "✅ พัฒนาเลย", data: "kiki:dev:yes" }, { text: "❌ ยกเลิก", data: "kiki:dev:no" }]],
    }]);
  }

  return null;
};

export const macHandler: Handler = async (ctx) => {
  const { text, msgId, route, is, reply } = ctx;
  // ===== สั่งเครื่อง Mac (คำสั่งด่วน + agent ทำแทนที่เครื่อง/Warp/Chrome) =====
  if (is("mac") || (MAC_RE.test(text) && route.intent === "chat")) {
    try {
      const quick = await quickMac(text);
      const r = quick || (await macAgent(text));
      const sends: Send[] = [];
      for (const ip of r.imagePaths || []) {
        try { sends.push({ kind: "photo", dataBase64: fs.readFileSync(ip).toString("base64"), filename: path.basename(ip) }); } catch { /* ข้าม */ }
      }
      // เจ้าของเจอบ่อย: agent อ้างว่า "ส่งภาพแคปมาแล้ว" ทั้งที่ไม่มีไฟล์จริง
      // → ระบบเป็นคนตรวจ ไม่เชื่อคำพูด AI
      const claimsShot = /แคป|ภาพ|screenshot|หน้าจอ/i.test(r.text);
      const gotShot = sends.some((x) => x.kind === "photo");
      let body = r.text.slice(0, 3900);
      if (claimsShot && !gotShot) {
        body += `\n\n⚠️ หมายเหตุจากระบบ: ไม่มีไฟล์ภาพจริงแนบมาด้วยรอบนี้ (ที่บอกว่าแคปแล้วยังไม่เกิดขึ้นจริง) — สั่ง "แคปหน้าจอ" ตรง ๆ ผมทำให้ได้ทันที`;
      }
      sends.push({ kind: "text", text: body, replyTo: msgId });
      return reply(sends);
    } catch (e) {
      return reply([{ kind: "text", text: await vexLine(`ทำที่เครื่องไม่สำเร็จครับ ⚠️ ${e instanceof Error ? e.message.slice(0, 150) : "error"}`), replyTo: msgId }]);
    }
  }

  // (ยกเลิกแล้ว 3 ส.ค.: สรุปฟีด Facebook/X — เจ้าของสั่งเลิกอ่านโซเชียลทั้งหมด)

  return null;
};

export const voicePickHandler: Handler = async (ctx) => {
  const { text, msgId, reply } = ctx;
  // ===== เปลี่ยนเสียงพูดของ Vex =====
  const voiceM = text.match(/(?:เปลี่ยน|ใช้|เอา)เสียง(?:เป็น|ชื่อ)?\s*([A-Za-z]+)/);
  if (voiceM) {
    const { TTS_VOICES } = await import("@/lib/kiki");
    const pick = TTS_VOICES.find((v) => v.toLowerCase() === voiceM[1].toLowerCase());
    if (pick) {
      await setSetting("kiki_tts_voice", pick);
      const sends: Send[] = [{ kind: "text", text: await vexLine(`เปลี่ยนเสียงเป็น ${pick} แล้วครับ ✅ ฟังตัวอย่างด้านล่างเลย`), replyTo: msgId }];
      const ogg = await ttsOgg(`สวัสดีครับ นี่เสียงใหม่ของผม ${pick} ครับผม เป็นไงบ้าง ชอบมั้ยครับ`, pick);
      if (ogg) sends.push({ kind: "voice", dataBase64: ogg.toString("base64"), filename: "vex.ogg" });
      return reply(sends);
    }
    return reply([{ kind: "text", text: await vexLine(`ไม่รู้จักเสียง "${voiceM[1]}" ครับ — พิมพ์ "มีเสียงอะไรบ้าง" ดูรายชื่อได้`), replyTo: msgId }]);
  }
  if (/มีเสียง(อะไร|ไหน)บ้าง|เสียงทั้งหมด|รายชื่อเสียง/.test(text)) {
    const { TTS_VOICES } = await import("@/lib/kiki");
    const { DEFAULT_VOICE } = await import("@/lib/tts");
    const cur = (await getSetting("kiki_tts_voice")) || DEFAULT_VOICE;
    return reply([{ kind: "text", text: `เสียงที่เลือกได้ (ตอนนี้ใช้ ${cur}):\n\n${TTS_VOICES.join(" · ")}\n\nเปลี่ยนโดยพิมพ์ "เปลี่ยนเสียงเป็น <ชื่อ>" ครับ`, replyTo: msgId }]); // canned-ok: ลิสต์เสียงทั้งหมด
  }

  return null;
};
