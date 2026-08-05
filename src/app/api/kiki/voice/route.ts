import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { transcribeAudio, kikiConversation, getSetting, setSetting, saveKikiChat, askKikiVoice } from "@/lib/kiki";
import { setActivity } from "@/lib/kiki-monitor";
import { routeIntent } from "@/lib/kiki-router";
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

/**
 * เจตนาที่เป็นการ "ถาม/อ่าน" ล้วน ๆ — ตอบในเส้นเสียงเอง ไม่ต้องส่งเข้าทะเบียน
 *
 * เพราะชั้นหาข้อเท็จจริง (kiki-agent) มีเครื่องมืออ่านครบอยู่แล้ว:
 *   ค้นเว็บ · อ่านลิงก์ · การเงิน · ปฏิทิน · งาน · ความจำ · ข้อมูลเจ้าของ
 * และมันใช้ Gemini ซึ่งเร็วกว่าตัวจัดการฝั่งข้อความที่เรียก Claude CLI (15-45 วินาที) มาก
 *
 * เคสจริง 5 ส.ค.: ถาม "วันนี้ฝนตกไหม" → route เป็น web_research → ส่งเข้าทะเบียน
 * → ตัวจัดการเรียก Claude CLI → ช้าจนตกไปทางสำรอง → ได้คำตอบว่า "เดี๋ยวเช็กให้"
 * ทั้งที่ควรค้นแล้วตอบเลยในรอบเดียว
 *
 * ที่เหลือ (บันทึกเงิน · ลงปฏิทิน · ส่งแชท · คุมเครื่อง · เปิดเพลง) = การกระทำจริง
 * ต้องผ่านทะเบียนเท่านั้น เพราะเส้นเสียงลงมือทำเองไม่ได้ (กติกา: สมองเดียว ท่อหลายทาง)
 */
const READ_ONLY_INTENTS = new Set([
  "chat", "web_research", "shopping",
  "finance_query", "finance_analyze", "finance_health", "finance_forecast",
  "calendar_view", "task_list", "memory_recall", "memory_list", "rule_list",
]);



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

  // ===== เลือกทางด้วยเจตนา ไม่ใช่ด้วยคำ (เฟส 2 — 5 ส.ค. 2026) =====
  //
  // ของเดิมใช้ regex ฟิกคำ 12 คำ (หา|ค้น|ราคา|รีวิว|...) ตัดสินว่าต้องออกไปหาข้อมูลไหม
  // ผลคือ "18:00 ฝนจะตกมั้ย" ไม่มีสักคำในนั้น → ไม่ออกไปหา → ตอบว่าไม่รู้
  // และผิดกติกาข้อ 1 ของเราเอง (ห้ามตัดสินใจด้วย regex)
  //
  // ตอนนี้ใช้ตัวจัดเส้นทางตัวเดียวกับฝั่งข้อความ = เส้นเสียงเข้าถึงความสามารถครบทั้ง 57 ตัว
  //   เจตนาที่เป็น "การกระทำ" (เปิดเพลง · ส่งแชท · จัดหมวดเงิน · คุมเครื่อง) → ส่งเข้าสมองเดียว
  //   เจตนาที่เป็น "คำถาม/คุย"                                              → ตอบเร็วในเส้นเสียง
  const tRoute = Date.now();
  const route = await routeIntent({ text: command, convo: await kikiConversation(6).catch(() => "") })
    .catch(() => ({ intent: "chat", confidence: 0, args: {} }));
  mark("อ่านเจตนา", tRoute);

  // ปลายทางที่ "ลงมือทำ" ต้องผ่านทะเบียนตัวจัดการจริงเท่านั้น เส้นเสียงทำเองไม่ได้
  // (คุยเล่น/ถามความเห็น/ถามข้อมูล ปล่อยให้เส้นเสียงตอบเองเพื่อความเร็ว)
  const isAction = !READ_ONLY_INTENTS.has(route.intent) && route.confidence >= 0.5;
  if (isAction) {
    void setActivity("⚙️", `${route.intent}: ${command.slice(0, 40)}`);
    return await raceOrDefer(command, `ทำ ${route.intent}`, heard, timing, t0, () => runThroughBrain(command));
  }

  // ===== คำถาม/คุย: ตอบเร็ว แต่ต้องมีข้อเท็จจริงจริง =====
  void setActivity("🧠", `กำลังคิด: ${command.slice(0, 50)}`);
  return await raceOrDefer(command, command.slice(0, 40), heard, timing, t0, async () => {
    const tBrain = Date.now();
    const out = await askKikiVoice(command, undefined, { withFacts: true });
    mark("คิดคำตอบ", tBrain);
    return out;
  });
}

/**
 * แข่งกับนาฬิกา แทนการเดาจากคำว่างานนี้นานไหม (เจ้าของสั่ง 5 ส.ค.)
 *
 * "ถ้างานไหนที่มันต้องใช้เวลา ให้พูดบอกผมเลยว่า ขอหาข้อมูลให้สักครู่ แล้วจะมาบอก"
 *
 * เดิมใช้ regex เดาว่างานไหนนาน ซึ่งเดาผิดตลอด — คำถามสั้น ๆ อาจต้องค้นเว็บ
 * ส่วนคำสั่งที่ดูใหญ่อาจเสร็จใน 1 วินาที · ตัวจับเวลาไม่มีทางเดาผิดเพราะมันวัดของจริง
 *
 * ทันเวลา  → ตอบเลย เหมือนคุยกันปกติ
 * ไม่ทัน   → พูด "ขอเวลาแป๊บนะ" ทันทีจากคลังเสียง (0 วินาที) แล้วงานวิ่งต่อเบื้องหลัง
 *            เสร็จเมื่อไหร่หย่อนลงกล่องขาออก ท่อเอาไปพูดตามให้เอง
 */
const PATIENCE_MS = 3500;

async function raceOrDefer(
  command: string,
  topic: string,
  heard: string,
  timing: Record<string, number>,
  t0: number,
  work: () => Promise<string>,
): Promise<Response> {
  let done = false;
  const job = work()
    .then((r) => { done = true; return r; })
    .catch(() => { done = true; return ""; });

  const winner = await Promise.race([
    job,
    new Promise<null>((r) => setTimeout(() => r(null), PATIENCE_MS)),
  ]);

  if (winner !== null && done) {
    const spoken = String(winner || "");
    if (!spoken) return NextResponse.json({ action: { do: "cue", bank: "broke" }, heard, timing, sessionOpen: await sessionOpen() });
    await setSetting(LAST_SPOKEN_KEY, spoken);
    await saveKikiChat("assistant", spoken, "owner", "discord-voice");
    timing.รวม = Date.now() - t0;
    void setActivity("🗣️", "กำลังพูดตอบ");
    return NextResponse.json({ action: { do: "say", text: spoken }, heard, timing, sessionOpen: await sessionOpen() });
  }

  // ช้าเกินความอดทน → บอกเขาก่อน อย่าให้รอเงียบ ๆ แล้วส่งผลตามทีหลัง
  // ลงกระดาน "เรื่องที่ค้างอยู่" ด้วย เผื่อเขาถามระหว่างรอว่ากำลังทำอะไรให้
  void import("@/lib/kiki-jobs").then((j) => j.pushFocus({ kind: "topic", ref: `voice:${Date.now()}`, label: topic })).catch(() => {});
  void (async () => {
    const spoken = await job;
    const { queueOut } = await import("@/lib/kiki-outbox");
    if (!spoken) {
      // canned-ok: ข้อความบอกว่าทำไม่สำเร็จ ห้ามให้ AI เรียบเรียงจนกลายเป็นเคลมว่าทำได้
      await queueOut({ target: "discord-voice", topic, text: `เรื่อง${topic}นะครับ ผมทำไม่สำเร็จ ลองสั่งใหม่อีกทีได้ไหม`, priority: 3 });
      return;
    }
    await setSetting(LAST_SPOKEN_KEY, spoken);
    await saveKikiChat("assistant", spoken, "owner", "discord-voice");
    void setActivity("✅", `เสร็จแล้ว: ${topic}`);
    await queueOut({ target: "discord-voice", topic, text: spoken, priority: 3 });
  })();

  timing.รวม = Date.now() - t0;
  return NextResponse.json({ action: { do: "cue", bank: "onit" }, heard, timing, sessionOpen: await sessionOpen(), background: true });
}

/** ส่งเข้าสมองเดียว (ทะเบียนตัวจัดการ 57 ตัว) แล้วย่อผลให้พูดออกเสียงได้ */
async function runThroughBrain(command: string): Promise<string> {
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
  if (!full) return "";

  // เนื้อเต็มลงห้องแชทไว้ให้ย้อนดู · เสียงพูดแค่แก่น (เขาจอดับ อ่านไม่ได้อยู่แล้ว)
  const { queueOut } = await import("@/lib/kiki-outbox");
  const plain = full.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (plain.length > 220) void queueOut({ target: "discord-text", topic: "", text: full, priority: 1 });

  // สั้นพออยู่แล้วก็พูดไปตรง ๆ ไม่ต้องเสียเวลาเรียกสมองย่อซ้ำ
  if (plain.length <= 220) return plain;
  return await askKikiVoice(
    `[ระบบทำงานเสร็จแล้ว รายงานผลให้โด้ฟัง] ผลที่ได้:\n"""${plain.slice(0, 5000)}"""`,
  ).catch(() => plain.slice(0, 220));
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
