import { vexList } from "@/lib/kiki-format";
import {
  askKiki, askExtractor, askGeminiJson, rememberOwnerFact, replaceOwnerFact, findFactConflicts,
  forgetOwnerFacts, listOwnerFacts, VEX_RULE_CATEGORY, vexLine, getSetting, setSetting,
} from "@/lib/kiki";
import { vexSay } from "../shared";
import type { Ctx, Handler } from "../types";

// ===== ความจำขัดแย้งที่รอเจ้าของเคาะ (จิตใจเฟส 2 — 6 ส.ค. 2026) =====
// ข้อมูลใหม่ขัดของเก่า ห้ามเขียนทับเงียบ ๆ — เก็บคำถามค้างไว้ 15 นาที รอเจ้าของตอบ
const CONFLICT_KEY = "vex_fact_conflict";
const CONFLICT_TTL = 15 * 60_000;

interface PendingConflict {
  fact: string;
  category: string;
  source: string;
  sourceMsgId?: string | null;
  sourceChannel?: string | null;
  existingId: string;
  existingFact: string;
  at: number;
}

async function getPendingConflict(): Promise<PendingConflict | null> {
  try {
    const p = JSON.parse((await getSetting(CONFLICT_KEY)) || "null") as PendingConflict | null;
    if (!p || Date.now() - p.at > CONFLICT_TTL) return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * ตัวรับคำตอบของคำถามขัดแย้ง — คำยืนยันใช้ regex ได้ตามข้อยกเว้นกติกาข้อ 1
 * **ห้ามใช้ `\b`** — อักษรไทยเป็น non-word ทั้งหมด `\b` หลังคำไทยไม่ match อะไรเลย
 * (พลาดจริงตอนเทส 6 ส.ค.: "เปลี่ยนเป็นอันใหม่" ไม่เข้าเพราะ `เปลี่ยน\b` — บั๊กเดิมที่เคยเจอกับ "Vex พอ")
 * รับเฉพาะข้อความสั้น (≤30 ตัวอักษร) — ประโยคยาวที่บังเอิญมีคำพวกนี้คือคำสั่งใหม่ ไม่ใช่คำตอบ
 */
export const factConflictAnswerHandler: Handler = async (ctx) => {
  const { text, msgId, reply } = ctx;
  const p = await getPendingConflict();
  if (!p) return null;
  const t = text.trim();
  if (t.length > 30) return null;
  // ฝั่งปฏิเสธเช็คก่อน — "ไม่เปลี่ยน" มีคำว่า "เปลี่ยน" อยู่ข้างใน
  if (/(คงเดิม|ของเดิม|อันเดิม|ไม่เปลี่ยน|ไม่ต้อง|ไม่เอา|ไม่ใช่|ยกเลิก)/.test(t)) {
    await setSetting(CONFLICT_KEY, "");
    ctx.setEvidence(`ระบบคงความจำเดิมไว้แล้วจริงตามที่เจ้าของเลือก: "${p.existingFact}" — เรื่องนี้จบแล้ว ไม่มีอะไรค้าง`);
    return reply([{ kind: "text", text: await vexLine(`คงของเดิมไว้ครับ — ยังจำว่า "${p.existingFact}" เหมือนเดิม`), replyTo: msgId }]);
  }
  if (/(เปลี่ยน|อันใหม่|ใช้ใหม่|อัปเดต|ทับ)/.test(t)) {
    await setSetting(CONFLICT_KEY, "");
    await replaceOwnerFact(p.existingId, p.fact, {
      category: p.category, source: p.source, sourceMsgId: p.sourceMsgId, sourceChannel: p.sourceChannel,
    });
    ctx.setEvidence(`ระบบสลับความจำแล้วจริง: ปิดของเก่า "${p.existingFact}" และบันทึกของใหม่ "${p.fact}" เรียบร้อย — เรื่องนี้จบแล้ว ไม่มีอะไรค้าง`);
    return reply([{ kind: "text", text: await vexLine(`อัปเดตแล้วครับ — จากนี้จำว่า "${p.fact}" (ของเดิม "${p.existingFact}" เอาออกแล้ว)`), replyTo: msgId }]);
  }
  return null; // ไม่ใช่คำตอบของเรื่องนี้ ปล่อยผ่านไปเส้นทางอื่น (ห้ามยึดเทิร์น — บทเรียน 6 ส.ค.)
};

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
    await rememberOwnerFact(rule, { category: VEX_RULE_CATEGORY, source: text, kind: "procedural", sourceMsgId: ctx.userChatRowId, sourceChannel: ctx.channel });
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
      title: `กฎที่โด้สอนผมไว้ (${rules.length} ข้อ)`,
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

    // ===== ข้อมูลยาว (โปรไฟล์/การเงิน/เป้าหมาย) — "ฝังไว้เลย" =====
    // เจ้าของวางข้อมูลตัวเองมาเป็นหน้า ๆ (5 ส.ค. 2026) แล้วระบบพัง 2 ทาง:
    //   1) เก็บทั้งก้อนเป็น "ข้อเท็จจริงเดียว" → ค้นย้อนหลังไม่เจอ เอาไปใช้ตอบไม่ได้
    //   2) ไปแต่งคำยืนยันด้วยสมองตัวใหญ่ → ใช้เวลาเกิน 250 วินาที บอทขึ้น "ระบบหลังบ้านไม่ตอบ"
    // แก้: แตกเป็นข้อเท็จจริงย่อยด้วยตัวสกัดเร็ว แล้วยืนยันด้วยลิสต์ที่ระบบสร้างเอง (ไม่เรียกสมองตัวใหญ่)
    if (fact.length >= 280) {
      const parsed = await askGeminiJson<{ facts?: { fact?: string; category?: string }[] }>(
        `แตกข้อความที่เจ้าของเล่าเกี่ยวกับตัวเอง ออกเป็น "ข้อเท็จจริงย่อย" ที่สมบูรณ์ในตัวเอง สำหรับให้เลขาจำถาวร
ตอบ JSON เท่านั้น: {"facts":[{"fact":"ประโยคเดียว อ่านแล้วเข้าใจโดยไม่ต้องดูบริบท","category":"ตัวตน|นิสัย|ความชอบ|ไม่ชอบ|เป้าหมาย|การเงิน|สุขภาพ|คนรอบตัว|การทำงาน|ของสำคัญ|ทั่วไป"}]}
กติกา: เก็บให้ครบทุกประเด็นที่เขาบอก ห้ามสรุปรวบจนตกรายละเอียด ห้ามแต่งเพิ่มจากที่ไม่มี
ตัวเลข ชื่อ วันที่ ต้องคงไว้เป๊ะ · ไม่เกิน 40 ข้อ · ข้ามคำสั่งที่ไม่ใช่ข้อเท็จจริง เช่น "จำไว้ในสมองมึงเลย"`,
        fact.slice(0, 12_000),
      ).catch(() => null);

      // ตัวเร็วไม่ตอบ (โควตาชน/ล่ม) → ใช้ตัวสกัดหลักแทน ไม่ยอมทิ้งข้อมูลเจ้าของ
      let list = parsed?.facts;
      if (!list?.length) {
        const raw = await askExtractor(
          `แตกข้อความนี้เป็นข้อเท็จจริงย่อยสำหรับให้เลขาจำถาวร ตอบ JSON เท่านั้น: {"facts":[{"fact":"ประโยคเดียว สมบูรณ์ในตัว","category":"ตัวตน|นิสัย|ความชอบ|ไม่ชอบ|เป้าหมาย|การเงิน|สุขภาพ|คนรอบตัว|การทำงาน|ของสำคัญ|ทั่วไป"}]}\nเก็บครบทุกประเด็น ห้ามแต่งเพิ่ม ตัวเลข/ชื่อ/วันที่คงไว้เป๊ะ\n\n${fact.slice(0, 12_000)}`,
          { timeoutMs: 120_000 },
        ).catch(() => "");
        try {
          list = (JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}") as { facts?: { fact?: string; category?: string }[] }).facts;
        } catch { list = undefined; }
      }
      const items = (list || []).map((f) => ({ fact: String(f.fact || "").trim(), category: String(f.category || "ทั่วไป").trim() })).filter((f) => f.fact.length >= 4);
      if (items.length) {
        // ด่านขัดแย้ง: เช็คทั้งชุดในคอลเดียว — ข้อที่ขัดของเดิม "ไม่ลง" แล้วถามเจ้าของแทน (ห้ามทับเงียบ)
        const conflicts = await findFactConflicts(items.map((i) => i.fact)).catch(() => new Map());
        const conflictLines: string[] = [];
        for (const [idx, c] of conflicts) {
          const it = items[idx as number];
          if (it) conflictLines.push(`"${it.fact}" ขัดกับที่จำไว้ว่า "${(c as { existingFact: string }).existingFact}"`);
        }
        const clean = items.filter((_, i) => !conflicts.has(i));
        for (const it of clean) await rememberOwnerFact(it.fact, { category: it.category, source: text.slice(0, 300), sourceMsgId: ctx.userChatRowId, sourceChannel: ctx.channel }).catch(() => {});
        // เก็บคำถามขัดแย้งข้อแรกไว้รอเจ้าของเคาะ (ทีละข้อ — ถามรวดเดียวหลายข้อจะตอบไม่ถูกว่าอันไหน)
        const firstConflict = [...conflicts.entries()][0] as [number, { existingId: string; existingFact: string }] | undefined;
        if (firstConflict && items[firstConflict[0]]) {
          const it = items[firstConflict[0]];
          await setSetting(CONFLICT_KEY, JSON.stringify({
            fact: it.fact, category: it.category, source: text.slice(0, 300),
            sourceMsgId: ctx.userChatRowId, sourceChannel: ctx.channel,
            existingId: firstConflict[1].existingId, existingFact: firstConflict[1].existingFact, at: Date.now(),
          } satisfies PendingConflict));
        }
        // สร้างโปรไฟล์ใหม่ทันที (6 ส.ค. 2026) — ไม่งั้นของที่เพิ่งบอกจะยังไม่ถูกเอาไปใช้
        // จนกว่าแคชเดิมจะหมดอายุ (12 ชม.) เจ้าของบอก "ปรับให้เข้ากับตัวผม" แล้วต้องเปลี่ยนเดี๋ยวนี้
        void import("@/lib/kiki-profile").then((m) => m.buildProfile()).catch(() => {});
        const byCat = new Map<string, number>();
        for (const it of clean) byCat.set(it.category, (byCat.get(it.category) || 0) + 1);
        // รายงานตามจริง: ลงกี่ข้อจากกี่ข้อ + ข้อที่ขัดของเดิมต้องถาม ไม่ใช่เคลมว่าฝังหมด (กติกาข้อ 3)
        const block = vexList({
          title: `ฝังเข้าความจำแล้ว ${clean.length}${conflictLines.length ? `/${items.length}` : ""} เรื่อง`,
          items: [...byCat].map(([cat, n]) => `${cat} — ${n} เรื่อง`),
          note: 'กำลังปรับวิธีตอบให้เข้ากับที่บอกมา · ถามย้อนหลังได้ทุกเมื่อ · อยากดูทั้งหมดบอก "ขอดูรายการที่จำไว้"',
        });
        const sends: import("../types").Send[] = [{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }];
        if (conflictLines.length) {
          const ask = await vexLine(
            `มีข้อมูลใหม่ขัดกับที่จำไว้เดิม ยังไม่ได้บันทึกทับ: ${conflictLines[0]} — ถามเจ้าของว่าจะเอาอันใหม่ (ตอบ "เปลี่ยน") หรือคงของเดิม (ตอบ "คงเดิม")`,
          );
          sends.push({ kind: "text", text: ask });
        }
        return reply(sends);
      }
      // แตกไม่สำเร็จ = เก็บทั้งก้อนไว้ก่อน ดีกว่าทำข้อมูลเจ้าของหาย แล้วบอกตรง ๆ
      await rememberOwnerFact(fact.slice(0, 4000), { category: "ทั่วไป", source: text.slice(0, 300), sourceMsgId: ctx.userChatRowId, sourceChannel: ctx.channel });
      return reply([{ kind: "text", text: await vexLine("เก็บข้อความทั้งก้อนไว้แล้วครับ แต่แตกเป็นข้อ ๆ ไม่สำเร็จรอบนี้ — ส่งมาใหม่อีกทีผมจะจัดให้เป็นระเบียบกว่านี้"), replyTo: msgId }]);
    }

    const category = /ชอบ/.test(fact) && !/ไม่ชอบ/.test(fact) ? "ความชอบ"
      : /ไม่ชอบ|แพ้|เกลียด|ห้าม/.test(fact) ? "ไม่ชอบ"
      : /สุขภาพ|ยา|หมอ|ออกกำลัง|น้ำหนัก/.test(fact) ? "สุขภาพ"
      : /แฟน|แม่|พ่อ|พี่|น้อง|เพื่อน|ครอบครัว|วันเกิด/.test(fact) ? "คนรอบตัว"
      : /รหัส|บัญชี|เลขที่|ทะเบียน|wifi|password/i.test(fact) ? "ของสำคัญ"
      : "ทั่วไป";
    const r = await rememberOwnerFact(fact, {
      category, source: text, sourceMsgId: ctx.userChatRowId, sourceChannel: ctx.channel, checkConflict: true,
    });
    if (!r.saved && r.conflict) {
      // ขัดกับความจำเดิม — ห้ามทับเงียบ ๆ ต้องถาม (จิตใจเฟส 2)
      await setSetting(CONFLICT_KEY, JSON.stringify({
        fact, category, source: text.slice(0, 300), sourceMsgId: ctx.userChatRowId, sourceChannel: ctx.channel,
        existingId: r.conflict.existingId, existingFact: r.conflict.existingFact, at: Date.now(),
      } satisfies PendingConflict));
      const ask = await vexLine(
        `ข้อมูลใหม่ "${fact}" ขัดกับที่เคยจำไว้ว่า "${r.conflict.existingFact}" — ยังไม่บันทึกทับ ถามว่าเปลี่ยนใจแล้วหรือผมจำผิด (ตอบ "เปลี่ยน" = เอาอันใหม่ · "คงเดิม" = เก็บของเดิม)`,
      );
      return reply([{ kind: "text", text: ask, replyTo: msgId }]);
    }
    const t = await vexSay(
      `เจ้าของสั่งให้จำ: "${fact}" (หมวด ${category}) — ยืนยันสั้น ๆ ว่าจำถาวรแล้ว`,
      [`จำไว้แล้ว: ${fact}`],
      `จำแล้วครับ ✅ "${fact}"\nถามเมื่อไหร่ก็ตอบได้`,
    );
    return reply([{ kind: "text", text: t, replyTo: msgId }]);
  }
  return null;
};

/**
 * "รู้เรื่องนี้มาจากไหน" — ตอบที่มาของความจำได้ทุกครั้ง (จิตใจเฟส 2 — กฎเหล็ก 6: อธิบายที่มาได้)
 * ค้นทั้งข้อเท็จจริงและบทเรียน แล้วตอบด้วยหลักฐานจริง: quote + วันเวลา + ช่องทาง
 * แถวเก่าที่เก็บก่อนมีระบบที่มา = บอกตรง ๆ ห้ามแต่งที่มาขึ้นเอง
 */
export const memorySourceHandler: Handler = async (ctx) => {
  const { text, replyText, msgId, is, reply } = ctx;
  if (!is("memory_source")) return null;

  const { db } = await import("@/lib/db");
  // เอาของที่ถูกลบแล้วมาด้วย — เจ้าของมักถามถึงที่มาของ "ความจำเดิมที่เพิ่งเปลี่ยน"
  // (เจอตอนเทส: ของเก่าถูกปิด active แล้วหลุดจากหลักฐาน สมองเลยแต่งเองว่า "ไม่มีที่มา" ทั้งที่มี)
  const facts = await db.ownerFact.findMany({ orderBy: { updatedAt: "desc" }, take: 150 }).catch(() => []);
  const lessons = await db.lessonLearned.findMany({ where: { active: true }, take: 30 }).catch(() => []);
  const all = [
    ...facts.map((f) => ({ kind: "fact" as const, id: f.id, text: `${f.fact}${f.active ? "" : " (ถูกลบ/แทนที่ไปแล้ว)"}`, source: f.source, sourceMsgId: f.sourceMsgId, channel: f.sourceChannel, at: f.createdAt })),
    ...lessons.map((l) => ({ kind: "lesson" as const, id: l.id, text: `${l.whatWasWrong} → ${l.correction}`, source: l.evidence, sourceMsgId: l.evidenceMsgId, channel: null as string | null, at: l.createdAt })),
  ];
  if (!all.length) {
    return reply([{ kind: "text", text: await vexLine("ยังไม่มีความจำในระบบเลยครับ เลยไม่มีที่มาให้เล่า"), replyTo: msgId }]);
  }

  // หาว่าเจ้าของถามถึงความจำข้อไหน — โมเดลเลือกจากความหมาย (reply ถึงข้อความเก่าก็ใช้ประกอบ)
  const j = await askGeminiJson<{ ids?: number[] }>(
    `เจ้าของถามถึง "ที่มา" ของสิ่งที่เลขารู้: """${text.slice(0, 400)}"""${replyText ? `\n(กำลัง reply ถึง: """${replyText.slice(0, 400)}""")` : ""}\n\nความจำทั้งหมด:\n${all.map((a, i) => `${i + 1}. ${a.text.slice(0, 120)}`).join("\n")}\n\nตอบ JSON: {"ids":[เลขข้อที่เจ้าของน่าจะหมายถึง สูงสุด 3]} — ไม่ตรงสักอัน = []`,
    "",
    25_000,
  ).catch(() => null);
  const picked = (j?.ids || []).map((n) => all[n - 1]).filter(Boolean).slice(0, 3);
  if (!picked.length) {
    return reply([{ kind: "text", text: await vexLine("ยังไม่แน่ใจว่าโด้ถามถึงความจำข้อไหนครับ บอกใจความของเรื่องนั้นมาหน่อย เดี๋ยวผมไล่ที่มาให้"), replyTo: msgId }]);
  }

  // ดึงข้อความต้นทางจริงจากประวัติ (ถ้ามี sourceMsgId)
  const evidence: string[] = [];
  for (const p of picked) {
    const when = p.at.toLocaleString("th-TH-u-ca-gregory", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
    if (p.sourceMsgId) {
      const msg = await db.kikiChat.findUnique({ where: { id: p.sourceMsgId } }).catch(() => null);
      if (msg) {
        const msgWhen = msg.createdAt.toLocaleString("th-TH-u-ca-gregory", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
        evidence.push(`"${p.text.slice(0, 100)}" ← มาจากข้อความของโด้เมื่อ ${msgWhen} ทาง ${msg.channel}: "${msg.content.slice(0, 180)}"`);
        continue;
      }
    }
    if (p.source) {
      evidence.push(`"${p.text.slice(0, 100)}" ← มาจากที่โด้บอกไว้ (บันทึกเมื่อ ${when}${p.channel ? ` ทาง ${p.channel}` : ""}): "${p.source.slice(0, 180)}"`);
    } else {
      evidence.push(`"${p.text.slice(0, 100)}" ← บันทึกเมื่อ ${when} แต่เป็นความจำรุ่นก่อนมีระบบเก็บที่มา เลยไม่มีข้อความต้นทางให้ดู`);
    }
  }

  const answer = await askKiki(
    text,
    `[เจ้าของถามที่มาของความจำ] หลักฐานจริงจากระบบ (ตอบจากนี้เท่านั้น ห้ามแต่งที่มาเพิ่ม):\n${evidence.join("\n")}\n\n` +
      `เล่าที่มาให้ฟังตรง ๆ พร้อมวันเวลา · ข้อไหนไม่มีที่มาบันทึกไว้ให้ยอมรับตรง ๆ ว่าจำมาก่อนมีระบบบันทึกที่มา ห้ามเดา · ไม่เกิน 4 บรรทัด`,
  );
  return reply([{ kind: "text", text: answer, replyTo: msgId }]);
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
      return reply([{ kind: "text", text: await vexLine('ยังไม่รู้อะไรเกี่ยวกับโด้เลยครับ เล่ามาได้ หรือบอกว่า "จำไว้ว่า ..." ผมเก็บให้ถาวร'), replyTo: msgId }]);
    }
    // ขอ "ลิสต์" ตรง ๆ เท่านั้นถึงจะดัมป์เป็นรายการ
    if (/ลิสต์|ลิส|รายการ|ทีละข้อ|ทั้งหมดกี่|มีกี่ข้อ|ขอดูรายการ/.test(text)) {
      const block = vexList({
        title: `ข้อมูลที่จำไว้เกี่ยวกับโด้ (${profile.length} เรื่อง)`,
        numbered: true,
        items: profile.map((f) => ({ main: f.fact, sub: f.category })),
        note: `กฎที่โด้สอนผมไว้อีก ${all.length - profile.length} ข้อ ถามแยกได้ · ข้อไหนไม่เอาแล้วบอก "ลืมเรื่อง..." ได้เลย`,
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
    return reply([{ kind: "text", text: answer, replyTo: msgId }]);
  }

  return null;
};
