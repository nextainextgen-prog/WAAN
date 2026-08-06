import { vexLine, askKiki, askExtractor } from "@/lib/kiki";
import { renderHtmlToPng } from "@/lib/html-pdf";
import {
  VEX_SESSIONS, checkAllSessions, checkSession, isBroken, startAuthRun, currentRun, saveRun,
  feedAnswer, pendingPrompt, cleanLog, terminalCardHtml, readRunStatus, verifyAuthResult, clearRun,
  cleanupRun, resetAlert, type AuthRun,
} from "@/lib/vex-ops";
import { vexList } from "@/lib/kiki-format";
import type { Ctx, Handler, Send } from "../types";

/**
 * เซสชันดูแลตัวเอง (เจ้าของสั่ง 5 ส.ค. 2026)
 *
 * ตัวนี้ต้องอยู่ "ก่อน" ทุกตัวในทะเบียน เพราะระหว่างล็อกอินค้างอยู่
 * ข้อความถัดไปของเจ้าของมักเป็น OTP ล้วน ๆ ("60539") ซึ่งถ้าปล่อยผ่าน
 * จะไปเข้าเส้นทางอื่นแล้วโปรเซสค้างรอจนหมดเวลาไปเปล่า ๆ
 */

async function shot(title: string, body: string): Promise<string | null> {
  try {
    const png = await renderHtmlToPng(terminalCardHtml(title, body), { width: 820, height: 200 });
    return png.toString("base64");
  } catch {
    return null; // แคปไม่ได้ก็ยังต้องถามด้วยข้อความให้ได้ (ห้ามเงียบ)
  }
}

/** ถามคำถามที่โปรเซสค้างรออยู่ พร้อมภาพหน้าจอจริง — ไม่ใช่ให้โมเดลเดาว่ามันถามอะไร */
async function askOwner(run: AuthRun, prompt: string, reply: Ctx["reply"]) {
  const body = cleanLog(run.id);
  const png = await shot(`vex-auth · ${run.script}`, body);
  const say = await askKiki(
    `[กำลังล็อกอินให้เจ้าของ] คำสั่ง ${run.script} รันอยู่ และตอนนี้โปรเซสค้างรอให้พิมพ์ตอบตรงนี้:\n"${prompt}"\n\n` +
      `บอกเจ้าของสั้น ๆ ว่ามันรออะไรอยู่ แล้วขอสิ่งนั้น (พิมพ์ตอบในแชทได้เลย เดี๋ยวเราเอาไปกรอกให้)\n` +
      `ไม่เกิน 2 บรรทัด ห้ามบอกให้เขาไปเปิดเทอร์มินัลเอง เพราะเรารันให้อยู่แล้ว`,
  ).catch(() => `ตอนนี้มันรอตรงนี้ครับ: ${prompt}\nพิมพ์ตอบมาได้เลย เดี๋ยวผมกรอกให้`); // canned-ok: ตัวดักพัง — ถามไม่ได้ = การล็อกอินค้างตาย

  const sends: Send[] = [];
  if (png) sends.push({ kind: "photo", dataBase64: png, filename: "vex-auth.png", caption: prompt.slice(0, 200) });
  sends.push({ kind: "text", text: say });
  return reply(sends);
}

/** จบงาน: ตรวจหลักฐานจริงก่อนเคลม (กติกาข้อ 3) */
async function finishRun(run: AuthRun, reply: Ctx["reply"]) {
  const v = verifyAuthResult(run);
  const body = cleanLog(run.id);
  const png = await shot(`vex-auth · ${run.script} (จบแล้ว)`, body);
  await clearRun();
  if (v.ok) await resetAlert(run.key);
  const say = await askKiki(
    `[รายงานผลการล็อกอิน] คำสั่ง ${run.script}\n` +
      `ระบบตรวจหลักฐานเองแล้วได้ว่า: ${v.ok ? "สำเร็จ" : "ยังไม่สำเร็จ"}\nหลักฐาน: ${v.evidence}\n\n` +
      `รายงานเจ้าของสั้น ๆ ตามนี้ ห้ามเคลมเกินหลักฐาน${v.ok ? "" : " — ยังไม่สำเร็จก็ต้องบอกตรง ๆ พร้อมเสนอว่าจะลองใหม่ไหม"}`,
  ).catch(() => `${v.ok ? "ล็อกอินสำเร็จแล้วครับ" : "ยังล็อกอินไม่สำเร็จครับ"}\n${v.evidence}`); // canned-ok: ตัวดักพัง — ผลลัพธ์ต้องถึงมือเจ้าของเสมอ
  cleanupRun(run.id);
  const sends: Send[] = [];
  if (png) sends.push({ kind: "photo", dataBase64: png, filename: "vex-auth-done.png" });
  sends.push({ kind: "text", text: say });
  return reply(sends);
}

/**
 * มีการล็อกอินค้างอยู่ → ข้อความนี้ใช่คำตอบของคำถามที่ค้างไหม
 * ให้สมองตัดสิน ไม่ใช่ regex (กติกาข้อ 1) — "60539" กับ "เดี๋ยวก่อน" ต้องแยกออกจากกัน
 */
export const authRunHandler: Handler = async (ctx) => {
  const { text, msgId, reply } = ctx;
  const run = await currentRun();
  if (!run) return null;

  const status = readRunStatus(run.id);
  if (status !== "running") return finishRun(run, reply);

  // เจ้าของสั่งเลิกกลางคัน
  if (text === "[ปุ่ม:หยุดล็อกอิน]") {
    await clearRun();
    cleanupRun(run.id);
    return reply([{ kind: "text", text: await vexLine("หยุดการล็อกอินให้แล้วครับ สั่งใหม่ได้ทุกเมื่อ"), replyTo: msgId }]);
  }

  const prompt = pendingPrompt(run.id);
  if (!prompt) return null; // ยังไม่ถามอะไร ปล่อยข้อความนี้ไปทางปกติ

  const verdict = await askExtractor(
    `โปรแกรมกำลังค้างรอให้พิมพ์ตอบว่า: "${prompt}"\nเจ้าของพิมพ์มาว่า: """${text.slice(0, 300)}"""`,
    {
      system: `ตอบ JSON เท่านั้น: {"isAnswer":true/false,"value":"<ค่าที่จะกรอกลงไป>"}
isAnswer: ข้อความนี้คือคำตอบของคำถามที่โปรแกรมถามอยู่หรือเปล่า
  เบอร์โทร/รหัส OTP/รหัสผ่าน/ตัวเลขล้วน ๆ ที่ตรงกับสิ่งที่ถาม = true
  พูดเรื่องอื่น สั่งงานอื่น ถามอย่างอื่น บอกให้รอ = false
value: ค่าดิบที่จะพิมพ์ลงไป (ตัดคำพูดรอบข้างออก) เช่น "โอเค 60539 นะ" → "60539"
  เบอร์โทรไทยขึ้นต้น 0 ให้แปลงเป็นรูปแบบสากล +66 เช่น "0831245989" → "+66831245989"`,
      timeoutMs: 20_000,
    },
  ).catch(() => "");

  let parsed: { isAnswer?: boolean; value?: string } = {};
  try { parsed = JSON.parse(verdict.match(/\{[\s\S]*\}/)?.[0] || "{}"); } catch { /* อ่านไม่ออก = ไม่ใช่คำตอบ */ }

  if (!parsed.isAnswer || !parsed.value) {
    // ===== ห้ามยึดเทิร์นเด็ดขาด (แก้ 6 ส.ค. 2026) =====
    //
    // เคสจริงที่พัง: มีการล็อกอินค้างอยู่ โด้ส่งลิงก์ X มาสั่งให้อ่าน+วิเคราะห์+เสนอไอเดีย
    // แล้วสั่งต่อว่า "ไปดูแท็บ Warp หน่อย" — **ได้ช่องกรอกเบอร์โทรกลับมาทั้งสองครั้ง**
    // เพราะตรงนี้เคย `return askOwner(...)` = กลืนคำสั่งจริงทิ้งไปเลย
    //
    // การล็อกอินเป็นงานเบื้องหลัง ห้ามมาบังงานที่เจ้าของสั่งจริง ๆ
    // ต่อท้ายเป็นหมายเหตุพอ แล้วปล่อยข้อความไปให้ตัวจัดการที่ถูกต้องรับไป
    if (Date.now() - run.lastAskedAt > 90_000) {
      run.lastAskedAt = Date.now();
      run.lastPrompt = prompt;
      await saveRun(run);
      ctx.setTriggerNote(`ค้างอยู่อีกเรื่อง: การล็อกอินที่สั่งไว้ยังรออยู่ตรง "${prompt}" — พิมพ์ตอบเมื่อไหร่ผมกรอกให้ทันที`); // canned-ok: หมายเหตุต่อท้าย ต้องสั้นและตรงกับสิ่งที่โปรเซสถามจริง
    }
    return null;
  }

  const fed = await feedAnswer(run, parsed.value);
  if (!fed) {
    return reply([{ kind: "text", text: await vexLine("ป้อนคำตอบเข้าโปรเซสไม่สำเร็จครับ ⚠️ ลองสั่งล็อกอินใหม่อีกรอบ"), replyTo: msgId }]);
  }

  // รอให้โปรเซสขยับ แล้วดูว่าถามอะไรต่อ หรือจบแล้ว
  await new Promise((r) => setTimeout(r, 6_000));
  const st = readRunStatus(run.id);
  if (st !== "running") return finishRun(run, reply);
  const next = pendingPrompt(run.id);
  if (next && next !== prompt) {
    run.lastAskedAt = Date.now();
    run.lastPrompt = next;
    await saveRun(run);
    return askOwner(run, next, reply);
  }
  return reply([{ kind: "text", text: await vexLine("กรอกให้แล้วครับ กำลังรอผล เดี๋ยวมาบอก"), replyTo: msgId }]);
};

/** สั่งเรื่องเซสชันตรง ๆ + ปุ่มจากใบแจ้ง */
export const sessionAuthHandler: Handler = async (ctx) => {
  const { chatId, text, msgId, is, reply } = ctx;

  // ปุ่มจากใบแจ้งเตือน — ผูกกับเซสชันตัวนั้นชัดเจน กัน "รันเลย" ไปโดนตัวผิด
  const btn = text.match(/^\[ปุ่ม:auth:([a-z0-9_-]+)\]$/);
  if (btn) {
    const sess = VEX_SESSIONS.find((s) => s.key === btn[1]);
    if (!sess) return reply([{ kind: "text", text: await vexLine("ไม่รู้จักเซสชันตัวนี้ครับ"), replyTo: msgId }]);
    return startAndReport(sess.key, chatId, reply, msgId);
  }
  if (text === "[ปุ่ม:auth-skip]") {
    return reply([{ kind: "text", text: await vexLine("โอเคครับ ไว้พร้อมค่อยบอก เดี๋ยวผมเตือนอีกที"), replyTo: msgId }]);
  }

  if (!is("session_auth")) return null;

  const health = checkAllSessions();
  const broken = health.filter(isBroken);

  // สั่งให้รันเลย vs ถามสถานะเฉย ๆ — ให้สมองแยก ไม่ใช่ regex
  const v = await askExtractor(
    `เจ้าของพูดว่า: """${text.slice(0, 300)}"""\nเซสชันที่มีปัญหาตอนนี้: ${broken.map((b) => `${b.key} (${b.label})`).join(", ") || "ไม่มี"}`,
    {
      system: `ตอบ JSON เท่านั้น: {"action":"run"|"status","key":"<คีย์เซสชัน ถ้าระบุชัด>"}
action=run: สั่งให้ไปล็อกอิน/ต่ออายุ/รันให้ ("รันเลย" "ล็อกอินใหม่ให้ที" "จัดการให้หน่อย")
action=status: แค่ถามว่าเซสชันไหนหมดบ้าง สถานะเป็นไง
key: ใส่เฉพาะเมื่อระบุชัดว่าตัวไหน ไม่ชัดให้เว้นว่าง`,
      timeoutMs: 20_000,
    },
  ).catch(() => "");
  let j: { action?: string; key?: string } = {};
  try { j = JSON.parse(v.match(/\{[\s\S]*\}/)?.[0] || "{}"); } catch { /* ไม่ชัด = ถือว่าถามสถานะ */ }

  if (j.action === "run") {
    const key = j.key && VEX_SESSIONS.some((s) => s.key === j.key) ? j.key : broken[0]?.key;
    if (!key) {
      return reply([{ kind: "text", text: await vexLine("ตอนนี้ทุกเซสชันยังดีอยู่ครับ ไม่มีตัวไหนต้องล็อกอินใหม่"), replyTo: msgId }]);
    }
    return startAndReport(key, chatId, reply, msgId);
  }

  // รายงานสถานะ — ลิสต์บรรทัดละรายการ (กติกาข้อ 5)
  const icon = (s: string) => (s === "ok" ? "🟢" : s === "unknown" ? "⚪" : "🔴");
  const block = vexList({
    title: "สถานะเซสชันของผม",
    items: health.map((h) => ({ main: `${icon(h.state)} ${h.label}`, sub: h.detail })),
  });
  const sends: Send[] = [{ kind: "text", text: block.text, parseMode: block.parseMode, replyTo: msgId }];
  if (broken.length) {
    sends.push({
      kind: "text",
      text: await vexLine(`${broken.length} ตัวต้องล็อกอินใหม่ ให้ผมจัดการเลยไหมครับ`),
      buttons: [broken.map((b) => ({ text: `รัน ${b.key}`, data: `auth:${b.key}` }))],
    });
  }
  return reply(sends);
};

async function startAndReport(key: string, chatId: string, reply: Ctx["reply"], msgId?: number | string) {
  const sess = VEX_SESSIONS.find((s) => s.key === key)!;
  const before = checkSession(sess);
  if (!isBroken(before)) {
    return reply([{
      kind: "text",
      text: await askKiki(
        `[เจ้าของสั่งล็อกอินใหม่ แต่เซสชันยังดีอยู่] เซสชัน "${sess.label}" ตรวจแล้วได้ว่า: ${before.detail}\n` +
          `บอกเจ้าของสั้น ๆ ว่ายังไม่ต้องล็อกอินใหม่ก็ได้ แต่ถ้ายืนยันจะทำก็บอกมา`,
      ).catch(() => `เซสชัน "${sess.label}" ยังดีอยู่ครับ (${before.detail})`), // canned-ok: ตัวดักพัง
      replyTo: msgId,
    }]);
  }

  const run = await startAuthRun(sess, chatId);
  if (!run) {
    return reply([{ kind: "text", text: await vexLine("มีการล็อกอินอีกตัวรันค้างอยู่ครับ รอตัวนั้นจบก่อน"), replyTo: msgId }]);
  }

  // รอโปรเซสตั้งตัว แล้วดูว่ามันถามอะไรเป็นอย่างแรก
  await new Promise((r) => setTimeout(r, 8_000));
  const st = readRunStatus(run.id);
  if (st !== "running") return finishRun(run, reply);
  const prompt = pendingPrompt(run.id);
  if (prompt) {
    run.lastAskedAt = Date.now();
    run.lastPrompt = prompt;
    await saveRun(run);
    return askOwner(run, prompt, reply);
  }
  return reply([{
    kind: "text",
    text: await vexLine(`เริ่มรัน ${sess.script} ให้แล้วครับ${sess.interactive ? " ถ้ามันขออะไรเดี๋ยวผมมาถาม" : ` — ${sess.askFor}`}`),
    replyTo: msgId,
  }]);
}
