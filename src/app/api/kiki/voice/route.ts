import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { transcribeAudio, kikiConversation, getSetting, setSetting, saveKikiChat, askKikiVoice } from "@/lib/kiki";
import { setActivity } from "@/lib/kiki-monitor";
import {
  getMode, setMode, MODE_LABEL, matchWake, isStopCommand, isUndoCommand, matchModeCommand,
  isCloseCommand, quickAddressed, addressedToVex, looksLikeEcho, maybeWakeShort,
  openSession, touchSession, closeSession, sessionOpen,
} from "@/lib/kiki-listen";

export const runtime = "nodejs";
export const maxDuration = 240;

/**
 * เสียงขาเข้าจากห้องเสียง Discord — เขียนใหม่ 5 ส.ค. 2026 หลังเจ้าของเทสจริง
 *
 * เสียงบ่น: "เรียกกว่าจะตอบเป็นนาที · ไม่รู้ว่าได้ยินมั้ย · มัวแต่คิดนาน · พูดไม่รู้เรื่อง"
 *
 * โครงใหม่ = ตอบสองจังหวะเสมอ
 *   จังหวะ 1 (< 1 วิ) : ตอบรับจากคลังเสียง ให้รู้ว่าได้ยินแล้วและกำลังทำอะไรอยู่
 *   จังหวะ 2          : คำตอบจริง ผ่านสายด่วน (Gemini ~2 วิ) หรือเบื้องหลังถ้าเป็นงานยาว
 *
 * ท่อไม่ตัดสินใจอะไรเลย มันแค่ทำตาม action ที่นี่สั่ง
 */

const LAST_SPOKEN_KEY = "vex_last_spoken";
const LAST_HEARD_KEY = "vex_last_heard_at";

/** งานที่รู้ทั้งที่ยังไม่ต้องคิดว่าต้องออกไปหาข้อมูลข้างนอก = ตอบรับก่อนแล้วค่อยไปทำ */
const NEEDS_LOOKUP = /หา|ค้น|เช็ค(ราคา|ดู)|ราคา|รีวิว|เปรียบเทียบ|ที่พัก|โรงแรม|ร้าน|คอร์ส|ข่าว|สรุปเว็บ|อ่านลิงก์/;

export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const t0 = Date.now();
  const body = await req.json().catch(() => ({}));
  const path = String(body.path || "");
  if (!path) return NextResponse.json({ action: { do: "ignore", why: "ไม่มีไฟล์" } });

  const timing: Record<string, number> = {};
  const mark = (k: string, from: number) => { timing[k] = Date.now() - from; };

  // ===== ถอดเสียง =====
  void setActivity("🎙️", "ได้ยินแล้ว กำลังถอดเสียง");
  const tStt = Date.now();
  const audioBytes = await fs.stat(path).then((st) => st.size).catch(() => 0);
  let heard = "";
  try {
    heard = (await transcribeAudio(path, "audio/ogg")).trim();
  } catch {
    // ถอดไม่ได้ต้องบอก ห้ามเงียบหาย (เจ้าของสั่ง: "ล้มแล้วต้องพูด")
    return NextResponse.json({ action: { do: "cue", bank: "pardon" }, timing });
  } finally {
    await fs.rm(path, { force: true }).catch(() => {});
  }
  mark("ถอดเสียง", tStt);
  if (heard.length < 2) return NextResponse.json({ action: { do: "ignore", why: "สั้นเกินไป" }, heard, timing, sessionOpen: await sessionOpen() });

  // เสียงตัวเองย้อนเข้าไมค์
  if (looksLikeEcho(heard, (await getSetting(LAST_SPOKEN_KEY)) || "")) {
    return NextResponse.json({ action: { do: "ignore", why: "เสียงตัวเองสะท้อน" }, heard, timing, sessionOpen: await sessionOpen() });
  }
  await setSetting(LAST_HEARD_KEY, String(Date.now()));

  // ===== คำสั่งด่วน — ตอบก่อนทุกอย่าง =====
  if (isStopCommand(heard)) {
    await touchSession();
    return NextResponse.json({ action: { do: "stop" }, heard, timing, sessionOpen: await sessionOpen() });
  }
  if (isUndoCommand(heard)) return NextResponse.json({ action: { do: "undo" }, heard, timing, sessionOpen: await sessionOpen() });

  const wantMode = matchModeCommand(heard);
  if (wantMode) {
    await setMode(wantMode);
    await closeSession();
    return NextResponse.json({
      action: { do: "cue", cue: wantMode === "muted" || wantMode === "silent" ? "mode-off" : "mode-on", mode: wantMode, label: MODE_LABEL[wantMode] },
      heard, timing,
    });
  }

  const mode = await getMode();
  if (mode === "muted") return NextResponse.json({ action: { do: "ignore", why: "โหมดปิดปาก" }, heard, timing, sessionOpen: await sessionOpen() });
  if (mode === "silent") {
    void harvestSilently(heard);
    return NextResponse.json({ action: { do: "ignore", why: "โหมดฟังเงียบ" }, heard, timing, sessionOpen: await sessionOpen() });
  }

  const inSession = await sessionOpen();
  const { woke, rest } = matchWake(heard);

  // ===== ปิดสาย =====
  // เจ้าของบอกเอง: "โอเค ขอบคุณครับ / เยี่ยม / ลุย / จัดไป / เดี๋ยวมาต่อ"
  if (inSession && isCloseCommand(heard)) {
    await closeSession();
    return NextResponse.json({ action: { do: "cue", bank: "bye" }, heard, timing, sessionOpen: await sessionOpen() });
  }

  // ===== เปิดสาย =====
  // เสียงสั้นที่ถอดออกมาไม่ชัด แต่ยาวพอ ๆ กับคำเรียก = ถือว่าเรียก
  // (ปลุกผิดไม่มีต้นทุน แค่ตอบ "ครับ" · ปลุกไม่ติดคือพังทั้งประสบการณ์)
  const shortCall = !woke && !inSession && maybeWakeShort(heard, audioBytes);
  if (shortCall) {
    await openSession("");
    return NextResponse.json({ action: { do: "cue", bank: "here" }, heard, timing, sessionOpen: await sessionOpen(), opened: true, guessed: true });
  }
  if (woke && !inSession) {
    await openSession(rest);
    // เรียกเฉย ๆ ไม่มีคำสั่งตาม = ตอบรับสั้น ๆ แล้วรอ (ห้ามถามว่า "มีอะไรครับ")
    if (!rest) return NextResponse.json({ action: { do: "cue", bank: "here" }, heard, timing, sessionOpen: await sessionOpen(), opened: true });
  }

  // ===== ประโยคนี้พูดกับเราไหม =====
  const command = woke && rest ? rest : heard;
  const nowInSession = inSession || woke;
  if (!nowInSession) {
    return NextResponse.json({ action: { do: "ignore", why: "ยังไม่ได้เรียก" }, heard, timing, sessionOpen: await sessionOpen() });
  }
  const quick = quickAddressed(command, { inSession: nowInSession });
  if (quick === "no") return NextResponse.json({ action: { do: "ignore", why: "ไม่ได้พูดกับผม" }, heard, timing, sessionOpen: await sessionOpen() });
  if (quick === "unsure") {
    const tAddr = Date.now();
    const convo = await kikiConversation(6).catch(() => "");
    const ok = await addressedToVex(command, convo);
    mark("กรองว่าพูดกับใคร", tAddr);
    if (!ok) return NextResponse.json({ action: { do: "ignore", why: "ไม่แน่ใจว่าพูดกับผม จึงเงียบไว้" }, heard, timing, sessionOpen: await sessionOpen() });
  }

  await touchSession();
  await saveKikiChat("user", command, "owner", "discord-voice");

  // ===== งานที่ต้องออกไปหาข้อมูล = ตอบรับก่อน แล้วไปทำเบื้องหลัง =====
  // เจ้าของสั่ง: "ถ้าผมบอกแล้วก็พูดทันทีว่า รับทราบครับ เดี๋ยวไปหาข้อมูลให้"
  if (NEEDS_LOOKUP.test(command) && command.length > 8) {
    void setActivity("🔍", `กำลังหา: ${command.slice(0, 50)}`);
    void runInBackground(command);
    return NextResponse.json({ action: { do: "cue", bank: "onit" }, heard, timing, sessionOpen: await sessionOpen(), background: true });
  }

  // ===== สายด่วน: ตอบเลย =====
  void setActivity("🧠", `กำลังคิด: ${command.slice(0, 50)}`);
  const tBrain = Date.now();
  let spoken = "";
  try {
    spoken = await askKikiVoice(command);
  } catch {
    spoken = "";
  }
  mark("คิดคำตอบ", tBrain);
  if (!spoken) return NextResponse.json({ action: { do: "cue", bank: "broke" }, heard, timing, sessionOpen: await sessionOpen() });

  await setSetting(LAST_SPOKEN_KEY, spoken);
  await saveKikiChat("assistant", spoken, "owner", "discord-voice");
  timing.รวม = Date.now() - t0;
  void setActivity("🗣️", "กำลังพูดตอบ");
  return NextResponse.json({ action: { do: "say", text: spoken }, heard, timing, sessionOpen: await sessionOpen() });
}

/**
 * งานยาว: ทำเบื้องหลังแล้วหย่อนผลลงกล่องขาออก (ท่อจะเอาไปพูดเอง)
 * ทวนหัวเรื่องก่อนเสมอ — เจ้าของจอดับ ไม่รู้ว่ากำลังตอบเรื่องไหน
 */
async function runInBackground(command: string) {
  const { queueOut } = await import("@/lib/kiki-outbox");
  const { pushFocus } = await import("@/lib/kiki-jobs");
  const topic = command.replace(/^(ช่วย|ขอ|ไป)?\s*/, "").slice(0, 40);
  await pushFocus({ kind: "topic", ref: `voice:${Date.now()}`, label: topic });
  try {
    const internal = process.env.INTERNAL_API_TOKEN || "";
    const appUrl = process.env.APP_URL || "http://localhost:3000";
    const res = await fetch(`${appUrl}/api/kiki/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": internal },
      body: JSON.stringify({
        chatId: process.env.DISCORD_TEXT_CH_ID || "voice",
        text: command,
        fromId: process.env.DISCORD_OWNER_ID || "",
        fromName: "โด้",
        platform: "discord",
        channel: "discord-voice",
        msgId: String(Date.now()),
      }),
      signal: AbortSignal.timeout(230_000),
    });
    const j = (await res.json()) as { sends?: { kind: string; text?: string }[] };
    const full = (j.sends || []).filter((s) => s.kind === "text" && s.text).map((s) => s.text!).join("\n\n");
    if (!full) {
      // canned-ok: ข้อความบอกว่า "ทำไม่สำเร็จ" ห้ามให้ AI เรียบเรียงจนกลายเป็นเคลมว่าทำได้แล้ว
      await queueOut({ target: "discord-voice", topic, text: `เรื่อง${topic}ที่สั่งไว้นะครับ ผมหาไม่ได้ ลองใหม่อีกทีได้ไหม`, priority: 2 });
      return;
    }
    // เนื้อเต็มลงห้องแชท · เสียงพูดแค่แก่น
    void setActivity("✅", `หาเสร็จแล้ว: ${topic}`);
    await queueOut({ target: "discord-text", topic, text: full, priority: 2 });
    const { askKikiVoice: brief } = await import("@/lib/kiki");
    const say = await brief(
      `[รายงานผลงานที่ฝากไว้] เรื่อง: ${topic}\nผลที่ได้:\n"""${full.replace(/<[^>]+>/g, " ").slice(0, 5000)}"""\n\n` +
        `พูดรายงานให้เจ้าของฟัง ขึ้นต้นด้วยการทวนว่ากำลังพูดเรื่องอะไร แล้วบอกแก่น 1-2 ประโยค`,
    ).catch(() => `เรื่อง${topic}ที่สั่งไว้เสร็จแล้วครับ รายละเอียดลงในห้องแชทให้แล้ว`);
    await queueOut({ target: "discord-voice", topic, text: say, priority: 2 });
  } catch {
    // canned-ok: เหตุผลเดียวกัน — ต้องบอกตรง ๆ ว่าไม่สำเร็จ
    await queueOut({ target: "discord-voice", topic, text: `เรื่อง${topic}ที่สั่งไว้นะครับ ระบบมีปัญหาระหว่างทาง ลองสั่งใหม่ได้ไหม`, priority: 2 });
  }
}

/** โหมดฟังเงียบ: จดสิ่งที่ควรจด แต่ไม่พูดสักคำ */
async function harvestSilently(heard: string) {
  try {
    await saveKikiChat("user", `[ฟังเงียบ] ${heard}`, "owner", "discord-voice");
    const { addTask } = await import("@/lib/kiki-tasks");
    const { askExtractor } = await import("@/lib/kiki");
    const raw = await askExtractor(`ประโยคที่ได้ยิน: """${heard}"""`, {
      system: `เจ้าของพูดออกมาโดยไม่ได้สั่งใคร ดูว่ามี "สิ่งที่ต้องทำ" ที่ควรจดไหม
ตอบ JSON: {"task":"สิ่งที่ต้องทำ สั้น ชัด (ไม่มี = เว้นว่าง)"}
พึมพำ/บ่น/คุยทั่วไป = เว้นว่าง`,
      timeoutMs: 40_000,
    });
    const task = String(JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}").task || "").trim();
    if (task.length >= 4) await addTask({ title: task, source: heard, kind: "todo", remind: false });
  } catch { /* จดไม่ได้ก็ข้าม ห้ามพูดอะไรออกมา */ }
}
