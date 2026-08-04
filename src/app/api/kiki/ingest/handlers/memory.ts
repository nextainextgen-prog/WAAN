import { vexList } from "@/lib/kiki-format";
import { askKiki, askExtractor, rememberOwnerFact, forgetOwnerFacts, listOwnerFacts, VEX_RULE_CATEGORY, vexLine } from "@/lib/kiki";
import { vexSay } from "../shared";
import type { Ctx, Handler } from "../types";

export const ruleTeachHandler: Handler = async (ctx) => {
  const { text, replyText, msgId, is, reply } = ctx;
  // ===== เจ้าของสอน/ปรับนิสัย Vex (พัฒนาตัวเองผ่านแชท) =====
  // จับทั้งแบบขึ้นต้นชัดเจน (สอนว่า/ต่อไป/ตั้งแต่นี้) และแบบสั่งห้ามที่มีคำบอกความถาวร (อย่า...อีก/ตลอด/ทุกครั้ง)
  // — เคยพลาด: "ต่อไปไม่ต้องใส่อิโมจิในภาพนี้" ไม่เข้า pattern แล้ว AI ตอบมั่วว่าจำแล้วทั้งที่ไม่ได้จำ
  const teachM = text.match(/^\s*(?:สอน(?:นาย|ไว้)?(?:ว่า)?|ต่อไป(?:นี้)?|ตั้งแต่(?:นี้|วันนี้)(?:ไป|เป็นต้นไป)?|นับจากนี้|จากนี้(?:ไป)?|หลังจากนี้|ครั้ง(?:หน้า|ต่อไป)|คราวหน้า|ปรับนิสัย|กฎใหม่)\s*[:：,]?\s*([\s\S]+)/);
  const banM = !teachM && /^\s*(?:อย่า|ห้าม|ไม่ต้อง|เลิก)/.test(text) && /ตลอด|ถาวร|ทุกครั้ง|อีกต่อไป|เด็ดขาด|อีกเลย|อีกแล้ว|ต่อไป/.test(text)
    ? text.trim()
    : null;
  if ((teachM && teachM[1].trim().length >= 5) || banM || is("rule_teach")) {
    const rawRule = (banM || teachM?.[1]?.trim() || text).trim();
    // ทำให้เป็นประโยคที่อ่านแล้วเข้าใจโดยไม่ต้องดูบริบท (เดิมเก็บดิบ ๆ จนความจำมีขยะ)
    const rule = (
      await askExtractor(`คำสั่งของเจ้าของ: """${rawRule}"""${replyText ? `\n(กำลัง reply ถึง: """${replyText.slice(0, 300)}""")` : ""}`, {
        system: `แปลงเป็น "กฎถาวร" ของเลขาให้เป็นประโยคเดียว สมบูรณ์ในตัว อ่านแล้วเข้าใจโดยไม่ต้องดูบริบท
ตอบเฉพาะประโยคกฎ ไม่ต้องมีคำนำ ไม่ต้องมีเครื่องหมายคำพูด · ถ้าคำสั่งกำกวมจนตั้งเป็นกฎไม่ได้ ตอบว่า SKIP`,
        timeoutMs: 45_000,
      }).catch(() => "")
    ).trim().replace(/^["'“”]|["'“”]$/g, "") || rawRule;
    if (/^SKIP$/i.test(rule)) {
      return reply([{ kind: "text", text: await vexLine(`ยังไม่ชัดว่าจะให้ผมปรับอะไรครับ บอกอีกทีว่าต่อไปให้ทำแบบไหน เดี๋ยวจำถาวรให้`), replyTo: msgId }]);
    }
    await rememberOwnerFact(rule, { category: VEX_RULE_CATEGORY, source: text });
    const t = await vexSay(
      `เจ้าของเพิ่งสอนกฎใหม่ให้ตัวเอง: "${rule}" — ยืนยันว่ารับมาปรับตัวถาวรแล้ว ตั้งแต่ข้อความหน้าเป็นต้นไป`,
      [`กฎใหม่: ${rule}`],
      `รับครับ ✅ ปรับตัวตามนี้ถาวรตั้งแต่ตอนนี้เลย\n\n"${rule}"`,
    );
    return reply([{ kind: "text", text: t, replyTo: msgId }]);
  }
  return null;
};

export const ruleListHandler: Handler = async (ctx) => {
  const { text, msgId, is, reply } = ctx;
  if (is("rule_list")) {
    const all = await listOwnerFacts();
    const rules = all.filter((f) => f.category === VEX_RULE_CATEGORY);
    if (!rules.length) {
      return reply([{ kind: "text", text: await vexLine('ยังไม่มีกฎพิเศษเลยครับ อยากให้ผมทำตัวยังไงบอกได้ เช่น "ต่อไปนี้ตอบสั้น ๆ พอ"'), replyTo: msgId }]);
    }
    const block = vexList({
      title: `กฎที่พี่สอนผมไว้ (${rules.length} ข้อ)`,
      numbered: true,
      items: rules.map((r) => r.fact),
      note: 'ข้อไหนไม่เอาแล้วบอก "ลืมเรื่อง..." ได้เลยครับ',
    });
    return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
  }

  return null;
};

export const rememberHandler: Handler = async (ctx) => {
  const { text, msgId, is, arg, reply } = ctx;
  // ===== ความจำ (จำ/ลืม/จำอะไรบ้าง) =====
  const rememberM = text.match(/^\s*(?:จำไว้(?:ว่า|นะ|ด้วย)?|ช่วยจำ(?:ว่า)?|จำด้วยว่า)\s*[:：]?\s*([\s\S]+)/);
  if ((rememberM && rememberM[1].trim().length >= 3) || (is("memory_remember") && (arg("fact") || text).length >= 5)) {
    const fact = (rememberM?.[1]?.trim() || arg("fact") || text).trim();
    const category = /ชอบ/.test(fact) && !/ไม่ชอบ/.test(fact) ? "ความชอบ"
      : /ไม่ชอบ|แพ้|เกลียด|ห้าม/.test(fact) ? "ไม่ชอบ"
      : /สุขภาพ|ยา|หมอ|ออกกำลัง|น้ำหนัก/.test(fact) ? "สุขภาพ"
      : /แฟน|แม่|พ่อ|พี่|น้อง|เพื่อน|ครอบครัว|วันเกิด/.test(fact) ? "คนรอบตัว"
      : /รหัส|บัญชี|เลขที่|ทะเบียน|wifi|password/i.test(fact) ? "ของสำคัญ"
      : "ทั่วไป";
    await rememberOwnerFact(fact, { category, source: text });
    const t = await vexSay(
      `เจ้าของสั่งให้จำ: "${fact}" (หมวด ${category}) — ยืนยันสั้น ๆ ว่าจำถาวรแล้ว`,
      [`จำไว้แล้ว: ${fact}`],
      `จำแล้วครับ ✅ "${fact}"\nถามเมื่อไหร่ก็ตอบได้`,
    );
    return reply([{ kind: "text", text: t, replyTo: msgId }]);
  }
  return null;
};

export const forgetHandler: Handler = async (ctx) => {
  const { text, msgId, is, reply } = ctx;
  const forgetM = text.match(/^\s*(?:ลืม(?:เรื่อง|ว่า|ไปเลย)?|ลบความจำ(?:เรื่อง)?)\s*[:：]?\s*([\s\S]+)/);
  if ((forgetM && forgetM[1].trim().length >= 2) || is("memory_forget")) {
    const kw = (forgetM?.[1] || text.replace(/^\s*(ลืม(เรื่อง|ว่า)?|ลบความจำ(เรื่อง)?)\s*/, "")).trim();
    const n = await forgetOwnerFacts(kw);
    return reply([{ kind: "text", text: n ? `ลืมให้แล้ว ${n} เรื่องครับ ✅` : `หาเรื่อง "${kw}" ในความจำไม่เจอครับ 🎯`, replyTo: msgId }]);
  }
  return null;
};

export const memoryListHandler: Handler = async (ctx) => {
  const { text, msgId, is, reply } = ctx;
  // "รู้จักผมมั้ย / รู้ประวัติผมไหม" = คำถามคุยกัน ไม่ใช่ขอลิสต์ดิบ
  // (4 ส.ค. เจ้าของด่า: ถาม 3 แบบ ได้ลิสต์ 13 ข้อเหมือนกันเป๊ะทั้งสามครั้ง อ่านไม่รู้เรื่อง)
  if (is("memory_list")) {
    const all = await listOwnerFacts();
    const profile = all.filter((f) => f.category !== VEX_RULE_CATEGORY);
    if (!all.length) {
      return reply([{ kind: "text", text: await vexLine('ยังไม่รู้อะไรเกี่ยวกับพี่เลยครับ เล่ามาได้ หรือบอกว่า "จำไว้ว่า ..." ผมเก็บให้ถาวร'), replyTo: msgId }]);
    }
    // ขอ "ลิสต์" ตรง ๆ เท่านั้นถึงจะดัมป์เป็นรายการ
    if (/ลิสต์|ลิส|รายการ|ทีละข้อ|ทั้งหมดกี่|มีกี่ข้อ|ขอดูรายการ/.test(text)) {
      const block = vexList({
        title: `ข้อมูลที่จำไว้เกี่ยวกับพี่ (${profile.length} เรื่อง)`,
        numbered: true,
        items: profile.map((f) => ({ main: f.fact, sub: f.category })),
        note: `กฎที่พี่สอนผมไว้อีก ${all.length - profile.length} ข้อ ถามแยกได้ · ข้อไหนไม่เอาแล้วบอก "ลืมเรื่อง..." ได้เลย`,
      });
      return reply([{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }]);
    }
    const byCat = new Map<string, string[]>();
    for (const f of profile) byCat.set(f.category, [...(byCat.get(f.category) || []), f.fact]);
    const grouped = [...byCat].map(([c, arr]) => `[${c}]\n${arr.map((x) => `- ${x}`).join("\n")}`).join("\n\n");
    const answer = await askKiki(text, [
      `=== ทุกอย่างที่ระบบจำเกี่ยวกับเจ้าของได้ตอนนี้ (${profile.length} เรื่อง) ===\n${grouped}`,
      `[โหมดตอบเรื่องตัวเจ้าของ] เขาถามว่าผมรู้จักเขาแค่ไหน — ตอบเป็นคำพูดของตัวเอง เล่าให้เห็นภาพว่ารู้อะไรบ้าง
จัดเป็นหมวดที่คนอ่านเข้าใจ (เช่น เป้าหมาย · นิสัย/ความชอบ · คนรอบตัว · การเงิน · เครื่องมือที่ใช้) ไม่ต้องเรียงตามหมวดในระบบ
ห้ามดัมป์เป็นลิสต์เลข ห้ามลอกข้อความในระบบมาทั้งดุ้น ห้ามเอา "กฎของ Vex" (คำสั่งเรื่องวิธีตอบของผมเอง) มาปนกับประวัติเขา
ปิดท้าย: บอกตรง ๆ ว่ายังไม่รู้อะไรเกี่ยวกับเขาบ้างที่เลขาควรรู้ แล้วถามกลับ 2-3 ข้อที่อยากรู้จริง ๆ`,
    ].join("\n\n"));
    return reply([{ kind: "text", text: answer.slice(0, 3900), replyTo: msgId }]);
  }

  return null;
};
