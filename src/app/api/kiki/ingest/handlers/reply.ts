import { vexLine, askExtractor } from "@/lib/kiki";
import {
  draftInOwnerStyle, trustOf, setTrust, resolvePeer, sendNow, setOutgoing, getOutgoing, undoLastSend,
} from "@/lib/kiki-reply";
import { pushFocus, getFocus } from "@/lib/kiki-jobs";
import type { Handler } from "../types";

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
  const r = await undoLastSend();
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
    return reply([{
      kind: "text",
      text: r.ok ? await vexLine(`ส่งให้ ${d.peerName} แล้วครับ`) : `ส่งไม่ได้ครับ — ${r.msg}`, // canned-ok: เหตุที่ส่งไม่ได้ต้องตรงตัว
      replyTo: msgId,
    }]);
  }
  if (/^\s*(ไม่|ไม่เอา|ยกเลิก|ไม่ส่ง|เดี๋ยวก่อน)\b/.test(text)) {
    await setOutgoing(null);
    return reply([{ kind: "text", text: await vexLine("ไม่ส่งแล้วครับ ทิ้งร่างไป"), replyTo: msgId }]);
  }
  // แก้ข้อความ: "แก้เป็น..." / "เปลี่ยนเป็น..."
  const editM = text.match(/^\s*(?:แก้|เปลี่ยน|เอาใหม่)(?:เป็น|ว่า)?\s*[:：]?\s*([\s\S]{2,})/);
  if (editM) {
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
