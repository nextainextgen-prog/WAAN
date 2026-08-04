import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { transcribeAudio, kikiConversation, getSetting, setSetting } from "@/lib/kiki";
import {
  getMode, setMode, MODE_LABEL, matchWake, isStopCommand, isUndoCommand, matchModeCommand,
  addressedToVex, looksLikeEcho, toVoiceReply, openModeAge, OPEN_IDLE_EXIT_MS, OPEN_ASK_AGAIN_MS,
  type ListenMode,
} from "@/lib/kiki-listen";

export const runtime = "nodejs";
export const maxDuration = 240;

/**
 * เสียงขาเข้าจากห้องเสียง Discord (เฟส 3 + 6 — 4 ส.ค. 2026)
 *
 * ท่อส่งไฟล์เสียง 1 ประโยคมาให้ (Discord ตัดให้เองเมื่อเงียบ = VAD ฟรีด่านแรก)
 * ที่นี่ตัดสินทั้งหมด: ถอดเสียง → เป็นเสียงสะท้อนไหม → คำสั่งหยุด/เปลี่ยนโหมดไหม →
 * โหมดตอนนี้ให้ตอบไหม → ถ้าตอบ ส่งเข้าสมองเดิม (/api/kiki/ingest) แล้วย่อเป็นคำพูด
 *
 * ท่อไม่ตัดสินใจอะไรเลย มันแค่เล่นเสียงตามที่บอก — ตรงตามหลัก "สมองเดียว ท่อหลายทาง"
 */

const LAST_SPOKEN_KEY = "vex_last_spoken";   // ไว้กันเสียงตัวเองย้อนเข้าไมค์
const WINDOW_KEY = "vex_convo_window_until";  // หน้าต่างคุยหลังเรียกชื่อ
const WINDOW_MS = 30_000;                     // เรียกครั้งเดียวคุยต่อได้ 30 วิ ยืดทุกครั้งที่พูด
const LAST_HEARD_KEY = "vex_last_heard_at";

type Action =
  | { do: "ignore"; why: string }
  | { do: "stop" }
  | { do: "undo" }
  | { do: "cue"; cue: "wake" | "mode-on" | "mode-off"; mode?: ListenMode; label?: string }
  | { do: "say"; text: string; heard: string };

export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const path = String(body.path || "");
  const speaking = Boolean(body.speaking); // Vex กำลังพูดอยู่ตอนได้ยินประโยคนี้ไหม
  if (!path) return NextResponse.json({ action: { do: "ignore", why: "ไม่มีไฟล์" } });

  // ===== ถอดเสียง =====
  let heard = "";
  try {
    heard = (await transcribeAudio(path, "audio/ogg")).trim();
  } catch {
    return NextResponse.json({ action: { do: "ignore", why: "ถอดเสียงไม่ได้" } });
  } finally {
    await fs.rm(path, { force: true }).catch(() => {});
  }
  if (heard.length < 2) return NextResponse.json({ action: { do: "ignore", why: "สั้นเกินไป" }, heard });

  // ===== เสียงตัวเองย้อนเข้าไมค์ (เจ้าของเปิดลำโพงแทนหูฟัง) =====
  const lastSpoken = (await getSetting(LAST_SPOKEN_KEY)) || "";
  if (looksLikeEcho(heard, lastSpoken)) {
    return NextResponse.json({ action: { do: "ignore", why: "เสียงตัวเองสะท้อนกลับ" }, heard });
  }

  await setSetting(LAST_HEARD_KEY, String(Date.now()));

  // ===== สั่งหยุดกลางประโยค — ต้องมาก่อนทุกอย่าง ตอบไวที่สุด =====
  if (isStopCommand(heard)) return NextResponse.json({ action: { do: "stop" }, heard });
  if (isUndoCommand(heard)) return NextResponse.json({ action: { do: "undo" }, heard });

  // ===== สั่งเปลี่ยนโหมด =====
  const wantMode = matchModeCommand(heard);
  if (wantMode) {
    await setMode(wantMode);
    await setSetting(WINDOW_KEY, "");
    return NextResponse.json({
      action: { do: "cue", cue: wantMode === "muted" || wantMode === "silent" ? "mode-off" : "mode-on", mode: wantMode, label: MODE_LABEL[wantMode] },
      heard,
    });
  }

  const mode = await getMode();

  // ปิดปาก = ไม่พูดไม่ฟัง แต่ยังบันทึกไว้เล่าทีหลัง
  if (mode === "muted") return NextResponse.json({ action: { do: "ignore", why: "โหมดปิดปาก" }, heard });

  // ฟังเงียบ = จดงาน/นัด/ข้อเท็จจริงเอง แต่ไม่พูดเลย
  if (mode === "silent") {
    void harvestSilently(heard);
    return NextResponse.json({ action: { do: "ignore", why: "โหมดฟังเงียบ" }, heard });
  }

  // ===== ตัดสินว่าประโยคนี้ถึงเราหรือเปล่า =====
  const now = Date.now();
  const windowUntil = Number((await getSetting(WINDOW_KEY)) || 0);
  const inWindow = now < windowUntil;
  const { woke, rest } = matchWake(heard);

  let command = heard;
  if (mode === "wake") {
    if (woke) {
      // เรียกชื่อแล้วไม่มีคำสั่งตามมา = เปิดหน้าต่างรอเงียบ ๆ ห้ามถามว่า "มีอะไรครับ"
      await setSetting(WINDOW_KEY, String(now + WINDOW_MS));
      if (!rest) return NextResponse.json({ action: { do: "cue", cue: "wake" }, heard });
      command = rest;
    } else if (inWindow) {
      command = heard; // อยู่ในหน้าต่างคุย ไม่ต้องเรียกซ้ำ
    } else {
      return NextResponse.json({ action: { do: "ignore", why: "ยังไม่ได้เรียกชื่อ" }, heard });
    }
  } else {
    // โหมดอิสระ — ยังต้องกรองว่าพูดกับเราไหม
    if (!inWindow && !woke) {
      const convo = await kikiConversation(6).catch(() => "");
      if (!(await addressedToVex(heard, convo))) {
        return NextResponse.json({ action: { do: "ignore", why: "ไม่ได้พูดกับผม" }, heard });
      }
    }
    if (woke && rest) command = rest;
    // ทางออกอัตโนมัติของโหมดอิสระ
    const age = await openModeAge();
    if (age > OPEN_ASK_AGAIN_MS) {
      await setMode("wake");
      const { vexLine } = await import("@/lib/kiki");
      const say = await vexLine("โหมดอิสระครบครึ่งชั่วโมงแล้วครับ ผมกลับไปโหมดเรียกชื่อก่อน อยากให้เปิดอีกบอกได้");
      return NextResponse.json({ action: { do: "say", text: say, heard }, heard });
    }
  }

  // ยืดหน้าต่างคุยทุกครั้งที่คุยจริง — เรียกครั้งเดียวคุยยาวได้
  await setSetting(WINDOW_KEY, String(now + WINDOW_MS));

  // ===== ส่งเข้าสมองเดิม =====
  const internal = process.env.INTERNAL_API_TOKEN || "";
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  let full = "";
  try {
    const res = await fetch(`${appUrl}/api/kiki/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-token": internal },
      body: JSON.stringify({
        chatId: process.env.DISCORD_VOICE_CH_ID || "voice",
        text: command,
        fromId: process.env.DISCORD_OWNER_ID || "",
        fromName: "โด้",
        platform: "discord",
        channel: "discord-voice",
        msgId: String(now),
      }),
      signal: AbortSignal.timeout(220_000),
    });
    const j = (await res.json()) as { sends?: { kind: string; text?: string }[] };
    full = (j.sends || []).filter((s) => s.kind === "text" && s.text).map((s) => s.text!).join("\n\n");
  } catch {
    full = "";
  }
  if (!full) return NextResponse.json({ action: { do: "ignore", why: "สมองไม่ตอบ" }, heard });

  const spoken = await toVoiceReply(full);
  await setSetting(LAST_SPOKEN_KEY, spoken);
  // เนื้อเต็มลงห้องแชทให้ย้อนดูตอนเปิดจอ (เฉพาะตอนที่ย่อแล้วสั้นกว่าจริงมาก)
  if (full.replace(/<[^>]+>/g, "").trim().length > spoken.length + 80) {
    const { queueOut } = await import("@/lib/kiki-outbox");
    await queueOut({ target: "discord-text", topic: command.slice(0, 60), text: full, priority: 1 });
  }
  return NextResponse.json({ action: { do: "say", text: spoken, heard }, heard, full });
}

/** โหมดฟังเงียบ: จดสิ่งที่ควรจด แต่ไม่พูดสักคำ */
async function harvestSilently(heard: string) {
  try {
    const { saveKikiChat } = await import("@/lib/kiki");
    await saveKikiChat("user", `[ฟังเงียบ] ${heard}`, "owner", "discord-voice");
    const { addTask } = await import("@/lib/kiki-tasks");
    const { askExtractor } = await import("@/lib/kiki");
    const raw = await askExtractor(`ประโยคที่ได้ยิน: """${heard}"""`, {
      system: `เจ้าของพูดออกมาโดยไม่ได้สั่งใคร ให้ดูว่ามี "สิ่งที่ต้องทำ" ที่ควรจดไว้ไหม
ตอบ JSON: {"task":"สิ่งที่ต้องทำ สั้น ชัด (ไม่มี = เว้นว่าง)"}
เอาเฉพาะที่เป็นงานจริง ๆ พึมพำเฉย ๆ / บ่น / คุยเรื่องทั่วไป = เว้นว่าง`,
      timeoutMs: 40_000,
    });
    const task = String(JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}").task || "").trim();
    if (task.length >= 4) await addTask({ title: task, source: heard, kind: "todo", remind: false });
  } catch { /* จดไม่ได้ก็ข้าม ห้ามพูดอะไรออกมาเด็ดขาด */ }
}
