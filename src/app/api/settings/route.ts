import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import path from "node:path";
import { getCurrentUser } from "@/lib/auth";
import { brainStatus, setDefaultModel, type BrainModel } from "@/lib/brain";
import { loadStyleMemory, saveStyleMemory } from "@/lib/slides";
import { getBotToken, getAllowedChatId } from "@/lib/telegram";
import { obsidianStatus } from "@/lib/obsidian";
import { hasSignature } from "@/lib/sign";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [brain, style, chatId] = await Promise.all([
    brainStatus(),
    loadStyleMemory(),
    getAllowedChatId(),
  ]);

  const connections = {
    codex: {
      ok: brain.codex,
      detail: brain.codex
        ? `${process.env.CODEX_MODEL || "gpt-5.5"} · ${process.env.CODEX_CLI_PATH || "Codex CLI"}`
        : "ยังไม่พบ Codex CLI",
    },
    claude: { ok: true, detail: process.env.CLAUDE_CLI_PATH || "claude" },
    gemini: {
      ok: Boolean(process.env.GEMINI_API_KEY || process.env.GEMINI_CLI_PATH?.includes("/")),
      detail: process.env.GEMINI_API_KEY
        ? `${process.env.GEMINI_MODEL || "gemini-2.5-flash"} · REST API`
        : "ยังไม่ตั้งค่า (ตั้ง GEMINI_API_KEY)",
    },
    hermes: {
      ok: brain.hermes,
      detail: brain.hermes
        ? process.env.HERMES_WEBHOOK_URL?.trim()
          ? "เชื่อมแล้ว (webhook)"
          : "เชื่อมแล้ว (Hermes CLI)"
        : "ยังไม่ได้ติดตั้ง/ตั้งค่า",
    },
    telegram: {
      ok: Boolean(getBotToken()) && Boolean(chatId),
      detail: !getBotToken() ? "ยังไม่มี token" : chatId ? `ผูกกับ chat ${chatId}` : "มี token แล้ว รอผูก (/start)",
    },
    obsidian: {
      ok: brain.obsidian.connected,
      detail: brain.obsidian.connected ? `${brain.obsidian.vaultPath}` : "ยังไม่ตั้งค่า vault path",
    },
    signature: {
      ok: hasSignature(),
      detail: hasSignature() ? "พร้อมเซ็นเอกสาร" : "วางไฟล์ public/signature.png",
    },
  };

  return NextResponse.json({ brainModel: brain.defaultModel, style, connections });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (body.action === "brain") {
    await setDefaultModel(body.model as BrainModel);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "style") {
    await saveStyleMemory(String(body.content || ""));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
