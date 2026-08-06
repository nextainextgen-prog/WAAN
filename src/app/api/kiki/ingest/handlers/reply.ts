import { vexLine, askExtractor, getSetting, setSetting } from "@/lib/kiki";
import {
  draftInOwnerStyle, trustOf, setTrust, resolvePeer, sendNow, setOutgoing, getOutgoing, undoLastSend,
} from "@/lib/kiki-reply";
import { pushFocus, getFocus } from "@/lib/kiki-jobs";
import type { Handler } from "../types";

// ===== เรียนรู้ระดับความอิสระของการส่งข้อความ (จิตใจเฟส 5 — 6 ส.ค. 2026) =====
// อนุมัติร่างหา "คนเดิม" ติดกันครบ 5 ครั้ง → เสนอเลื่อนความไว้ใจคนนั้นเป็นระดับ 2 (ส่งเลย ถอนได้ 30 วิ)
// เสนออย่างเดียว — การเลื่อนจริงต้องให้เจ้าของเคาะ · เจ้าของถอนข้อความ = ลดกลับทันที
const PROMOTE_KEY = "vex_autonomy_prompt"; // {"peerId":"...","peerName":"...","at":ms}

interface PromotePending { peerId: string; peerName: string; at: number }

async function getPromotePending(): Promise<PromotePending | null> {
  try {
    const p = JSON.parse((await getSetting(PROMOTE_KEY)) || "null") as PromotePending | null;
    if (!p || Date.now() - p.at > 15 * 60_000) return null;
    return p;
  } catch {
    return null;
  }
}

/** ตัวรับคำตอบข้อเสนอเลื่อนระดับ — คำยืนยันสั้น regex ได้ (ข้อยกเว้นกติกา 1) · ห้าม \b กับคำไทย */
export const autonomyPromoteHandler: Handler = async (ctx) => {
  const { text, msgId, reply } = ctx;
  const p = await getPromotePending();
  if (!p) return null;
  const t = text.trim();
  if (t.length > 30) return null;
  if (/(ไม่เอา|ไม่ต้อง|ไม่เลื่อน|ยกเลิก|ถามก่อนเหมือนเดิม|อย่า)/.test(t)) {
    await setSetting(PROMOTE_KEY, "");
    return reply([{ kind: "text", text: await vexLine(`รับครับ — ข้อความถึง ${p.peerName} ผมจะถามก่อนส่งเหมือนเดิมทุกครั้ง`), replyTo: msgId }]);
  }
  if (/(เลื่อนได้|เลื่อนเลย|อนุมัติ|เอาเลย|ได้เลย|จัดไป|โอเคเลย)/.test(t)) {
    await setSetting(PROMOTE_KEY, "");
    await setTrust(p.peerId, 2);
    ctx.setEvidence(`ระบบเลื่อนความไว้ใจของ ${p.peerName} เป็นระดับ 2 แล้วจริง (ส่งเลย ถอนได้ 30 วิ) — เรื่องนี้จบแล้ว`);
    return reply([{
      kind: "text",
      text: await vexLine(`เลื่อนแล้วครับ — ต่อไปข้อความถึง ${p.peerName} ผมส่งเลยแล้วบอกทีหลัง ถอนได้ใน 30 วินาที · เปลี่ยนใจเมื่อไหร่บอกว่า "${p.peerName}ต้องถามก่อนทุกครั้ง"`),
      replyTo: msgId,
    }]);
  }
  return null; // ไม่ใช่คำตอบเรื่องนี้ — ปล่อยผ่าน ไม่ยึดเทิร์น
};

/**
 * ลูปตอบกลับ (สเปกข้อ 9 + เฟส 5)
 *
 * "อั๋นถามว่าเย็นนี้กินข้าวไหน" → เจ้าของพูด "เดี๋ยวไปกินร้านกมูทะ"
 * → เรียบเรียงเป็นภาษาที่เจ้าของใช้คุยกับอั๋นจริง → ส่งในนามเจ้าของ → บอกกลับสั้น ๆ
 *
 * ระดับความไว้ใจรายคน (เริ่มทุกคนที่ 1):
 *   0 ร่างไว้ รอสั่งส่ง · 1 อ่านทวนให้ฟังรอบเดียว · 2 ส่งเลย ถอนได้ใน 30 วิ
 */

/** "Vex ถอน" — ต้องมาก่อนทุกอย่าง ตอบไวที่สุด */
export const undoSendHandler: Handler = async (ctx) => {
  const { text, msgId, reply } = ctx;
  if (!/^\s*(vex\s*)?(ถอน|เรียกคืน|undo)\b/i.test(text) && !/ถอนข้อความที่เพิ่งส่ง/.test(text)) return null;
  // ถอน = เจ้าของไม่พอใจการส่งครั้งนั้น — ลดระดับความอิสระทันที (จิตใจเฟส 5) ก่อนที่ร่างจะถูกล้าง
  const beforeUndo = await getOutgoing();
  const r = await undoLastSend();
  if (r.ok && beforeUndo?.peerId) {
    const { recordApproval } = await import("@/lib/kiki-autonomy");
    await recordApproval(`dm:${beforeUndo.peerId}`, false).catch(() => {});
    // เคยไว้ใจถึงขั้นส่งเอง (ระดับ 2) แล้วโดนถอน = กลับมาถามก่อนทุกครั้ง
    if ((await trustOf(beforeUndo.peerId)) === 2) await setTrust(beforeUndo.peerId, 1);
  }
  // canned-ok: ผลของการถอนต้องตรงตัว ห้ามให้ AI แต่งจนกลายเป็นเคลมว่าถอนสำเร็จทั้งที่ไม่สำเร็จ
  return reply([{ kind: "text", text: r.msg, replyTo: msgId }]);
};

/** ยืนยันร่างที่อ่านทวนไปแล้ว (ระดับ 1) */
export const confirmReplyHandler: Handler = async (ctx) => {
  const { text, msgId, channel, reply } = ctx;
  const d = await getOutgoing();
  if (!d?.message) return null;
  if (d.sentAt) return null; // ส่งไปแล้ว รอหน้าต่างถอน ไม่ใช่รอยืนยัน
  if (d.channel !== channel) return null; // ยืนยันข้ามช่องทางไม่ได้ (กฎเดียวกับร่างอื่น)

  if (/^\s*(เอา|ส่งเลย|ส่งได้|ยืนยัน|โอเค|ใช่|ได้เลย|ok)\b/i.test(text)) {
    const r = await sendNow(d.peerId, d.message);
    await setOutgoing(r.ok ? { ...d, sentAt: Date.now() } : null);
    // นับการอนุมัติ (จิตใจเฟส 5) — ครบ 5 ติดกับคนเดิม + ยังต้องถามทุกครั้ง = เสนอเลื่อนให้เจ้าของเคาะ
    let proposal = "";
    if (r.ok) {
      try {
        const { recordApproval } = await import("@/lib/kiki-autonomy");
        const a = await recordApproval(`dm:${d.peerId}`, true);
        if (a.shouldPropose && (await trustOf(d.peerId)) < 2) {
          await setSetting(PROMOTE_KEY, JSON.stringify({ peerId: d.peerId, peerName: d.peerName, at: Date.now() } satisfies PromotePending));
          proposal = await vexLine(
            `สังเกตว่าโด้อนุมัติร่างถึง ${d.peerName} ติดกัน ${a.streak} ครั้งแล้วไม่เคยแก้เลย — เสนอว่าต่อไปให้ผมส่งหาเขาได้เลยแล้วบอกทีหลัง (ถอนได้ใน 30 วิ) ถ้าเอาตอบ "เลื่อนได้" ถ้าให้ถามก่อนเหมือนเดิมตอบ "ไม่ต้อง"`,
          );
        }
      } catch { /* นับไม่ได้ก็ข้าม */ }
    }
    return reply([
      {
        kind: "text",
        text: r.ok ? await vexLine(`ส่งให้ ${d.peerName} แล้วครับ`) : `ส่งไม่ได้ครับ — ${r.msg}`, // canned-ok: เหตุที่ส่งไม่ได้ต้องตรงตัว
        replyTo: msgId,
      },
      ...(proposal ? [{ kind: "text" as const, text: proposal }] : []),
    ]);
  }
  if (/^\s*(ไม่|ไม่เอา|ยกเลิก|ไม่ส่ง|เดี๋ยวก่อน)\b/.test(text)) {
    await setOutgoing(null);
    // ไม่ส่ง = streak เริ่มนับใหม่ (ไม่ใช่การลดระดับ — แค่ยังไม่ไว้ใจพอ)
    void import("@/lib/kiki-autonomy").then((a) => a.recordApproval(`dm:${d.peerId}`, false)).catch(() => {});
    return reply([{ kind: "text", text: await vexLine("ไม่ส่งแล้วครับ ทิ้งร่างไป"), replyTo: msgId }]);
  }
  // แก้ข้อความ: "แก้เป็น..." / "เปลี่ยนเป็น..."
  const editM = text.match(/^\s*(?:แก้|เปลี่ยน|เอาใหม่)(?:เป็น|ว่า)?\s*[:：]?\s*([\s\S]{2,})/);
  if (editM) {
    // เจ้าของต้องแก้ร่างเอง = สไตล์ที่เราร่างยังไม่ตรง — เก็บ diff เป็นบทเรียน (จิตใจเฟส 1)
    void import("@/lib/kiki-lessons").then((m) => m.recordStyleLesson(d.message, editM[1].trim(), d.peerName)).catch(() => {});
    const msg = await draftInOwnerStyle(d.peerId, d.peerName, editM[1].trim());
    await setOutgoing({ ...d, message: msg });
    return reply([{ kind: "text", text: `แก้เป็น: "${msg}"\n\nเอาไหมครับ`, replyTo: msgId }]); // canned-ok: ต้องอ่านร่างจริงให้ฟังตรงตัว
  }
  return null;
};

/**
 * สั่งตอบ/ทักใครก็ได้ด้วยภาษาคน
 * "ตอบอั๋นว่าเดี๋ยวไปกินร้านกมูทะ" · "บอกแม่ว่าเย็นนี้ไม่กลับ" · "ทักพี่ภูมิหน่อยว่า..."
 */
export const replyToPersonHandler: Handler = async (ctx) => {
  const { text, msgId, is, channel, reply } = ctx;
  const looksLikeReply = /^(ตอบ|บอก|ทัก|ส่งหา|ไปบอก|แจ้ง)\s*\S/.test(text);
  if (!is("tg_dm") && !looksLikeReply) return null;

  // แกะว่า "ใคร" กับ "ว่าอะไร" — ให้สมองแกะ ไม่ใช่ regex (ชื่อคนไทยรูปแบบอิสระมาก)
  let who = "";
  let gist = "";
  try {
    const focus = await getFocus();
    const raw = await askExtractor(
      `${focus.length ? `เรื่องที่ค้างอยู่ระหว่างกัน:\n${focus.map((f, i) => `${i + 1}. ${f.label}`).join("\n")}\n\n` : ""}คำสั่งเจ้าของ: """${text}"""`,
      {
        system: `แกะคำสั่ง "ให้ตอบ/ทักใครสักคน" ตอบ JSON เท่านั้น:
{"who":"ชื่อคนที่จะส่งหา","gist":"ใจความที่เจ้าของอยากสื่อ"}
ถ้าเจ้าของพูดลอย ๆ ว่า "ตอบเขาไป" ให้ดูจากเรื่องที่ค้างอยู่ว่าหมายถึงใคร
ไม่รู้ว่าใคร = who เว้นว่าง (ห้ามเดา)`,
        timeoutMs: 40_000,
      },
    );
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}") as { who?: string; gist?: string };
    who = (j.who || "").trim();
    gist = (j.gist || "").trim();
  } catch { /* แกะไม่ได้ = ถามกลับข้างล่าง */ }

  if (!who || !gist) {
    return reply([{ kind: "text", text: await vexLine("ให้ตอบใครว่าอะไรครับ บอกชื่อกับใจความมาได้เลย"), replyTo: msgId }]);
  }

  const peer = await resolvePeer(who);
  if (!peer) {
    // เดาไม่ออก = ถามกลับ ห้ามเดาแล้วส่งผิดคน (ความเสียหายถอนคืนไม่ได้)
    return reply([{ kind: "text", text: await vexLine(`หาแชทของ "${who}" ไม่เจอ หรือเจอหลายคนครับ ระบุให้ชัดกว่านี้หน่อย — พิมพ์ "ขอรายชื่อแชท" ดูได้`), replyTo: msgId }]);
  }

  const message = await draftInOwnerStyle(peer.id, peer.name, gist);
  const trust = await trustOf(peer.id);
  await pushFocus({ kind: "message", ref: peer.id, label: `ตอบ ${peer.name}: ${gist.slice(0, 40)}` });

  if (trust === 2) {
    // ไว้ใจเต็ม = ส่งเลย บอกทีหลัง ถอนได้ใน 30 วิ
    const r = await sendNow(peer.id, message);
    await setOutgoing(r.ok ? { peerId: peer.id, peerName: peer.name, message, sentAt: Date.now(), channel } : null);
    return reply([{
      kind: "text",
      text: r.ok
        ? `ส่งให้ ${peer.name} แล้วครับว่า "${message}"\n\nไม่ถูกใจพูดว่า "Vex ถอน" ภายใน 30 วินาที` // canned-ok: ต้องอ่านข้อความที่ส่งจริงตรงตัว
        : `ส่งไม่ได้ครับ — ${r.msg}\n\nร่างที่เตรียมไว้: "${message}"`,
      replyTo: msgId,
    }]);
  }

  // ระดับ 0 กับ 1 = ยังไม่ส่ง · ต่างกันที่ระดับ 0 ต้องสั่งส่งเอง ระดับ 1 แค่ตอบ "เอา"
  await setOutgoing({ peerId: peer.id, peerName: peer.name, message, channel });
  return reply([{
    kind: "text",
    text: `จะตอบ ${peer.name} ว่า "${message}"\n\n${trust === 0 ? 'สั่ง "ส่งเลย" เมื่อพร้อมครับ' : "เอาไหมครับ"}`, // canned-ok: อ่านร่างจริงให้ฟัง ห้ามให้ AI แต่งใหม่
    replyTo: msgId,
    buttons: [[{ text: "ส่งเลย", data: "kiki:dm:yes" }, { text: "ไม่ส่ง", data: "kiki:dm:no" }]],
  }]);
};

/** ปรับระดับความไว้ใจด้วยภาษาคน: "อั๋นไม่ต้องถามแล้ว ส่งเลย" / "ลูกค้าต้องถามก่อนทุกครั้ง" */
export const trustHandler: Handler = async (ctx) => {
  const { text, msgId, reply } = ctx;
  const m = text.match(/(.{1,30}?)\s*(ไม่ต้องถาม|ส่งได้เลย|ไว้ใจได้|ต้องถามก่อน|ถามก่อนทุกครั้ง|ห้ามส่งเอง)/);
  if (!m) return null;
  const peer = await resolvePeer(m[1].replace(/^(ต่อไป|ถ้า|เวลา|กับ)\s*/, "").trim());
  if (!peer) return null;
  const up = /ไม่ต้องถาม|ส่งได้เลย|ไว้ใจได้/.test(m[2]);
  await setTrust(peer.id, up ? 2 : 0);
  return reply([{
    kind: "text",
    text: await vexLine(up
      ? `จำแล้วครับ — ต่อไปข้อความถึง ${peer.name} ผมส่งเลยไม่ถามซ้ำ แล้วบอกทีหลัง (ถอนได้ใน 30 วินาที)`
      : `จำแล้วครับ — ต่อไปข้อความถึง ${peer.name} ผมจะร่างไว้รอโด้สั่งส่งทุกครั้ง ไม่ส่งเอง`),
    replyTo: msgId,
  }]);
};
