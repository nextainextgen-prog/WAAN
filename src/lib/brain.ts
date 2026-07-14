import { askCodex, codexConfigured } from "./codex";
import { askClaude } from "./claude";
import { askGemini } from "./gemini";
import { askHermes, hermesConfigured } from "./hermes";
import { buildSecretaryContext, getChatHistory } from "./secretary";
import { readVaultKnowledge, obsidianStatus } from "./obsidian";
import { db } from "./db";

// ประวัติสนทนาล่าสุด → ให้ AI "จำเรื่องที่เพิ่งคุยกัน" ตามเรื่องเดิมต่อได้
async function recentConversation(): Promise<string> {
  const rows = await getChatHistory(16).catch(() => []);
  if (!rows.length) return "";
  const lines = rows
    .map((r) => `${r.role === "assistant" ? "น้องวาน" : "ผู้ใช้"}: ${String(r.content).replace(/\s+/g, " ").slice(0, 600)}`)
    .join("\n");
  return `=== บทสนทนาล่าสุด (ใช้ต่อบริบทเวลาผู้ใช้ถามตามเรื่องเดิม อย่าทำเหมือนไม่เคยคุย) ===\n${lines}`;
}

/**
 * "สมอง AI" ของ Changoh — รวมแหล่งความรู้และโมเดลเข้าด้วยกัน
 *  ความรู้ (context): ข้อมูลทุนวิจัยจริง + Obsidian vault (second brain)
 *  โมเดล (reasoning): Codex gpt-5.5 (หลัก) + Claude (co-brain) / Gemini (สำรอง) / Hermes agent
 */
export type BrainModel = "codex" | "claude" | "gemini" | "hermes" | "auto";

const VALID: BrainModel[] = ["codex", "claude", "gemini", "hermes", "auto"];

export async function getDefaultModel(): Promise<BrainModel> {
  const row = await db.setting.findUnique({ where: { key: "brain_model" } });
  const v = (row?.value || process.env.BRAIN_DEFAULT_MODEL || "hermes") as BrainModel;
  return VALID.includes(v) ? v : "hermes";
}

export async function setDefaultModel(model: BrainModel) {
  await db.setting.upsert({
    where: { key: "brain_model" },
    update: { value: model },
    create: { key: "brain_model", value: model },
  });
}

// ประกอบบริบทเต็ม: ข้อมูลระบบ + ความรู้จาก Obsidian
export async function buildFullContext(): Promise<string> {
  const [base, vault] = await Promise.all([
    buildSecretaryContext(),
    readVaultKnowledge().catch(() => ""),
  ]);
  if (!vault) return base;
  return `${base}\n\n=== ความรู้จาก Obsidian (second brain) ===\n${vault}`;
}

export interface BrainResult {
  reply: string;
  model: BrainModel;
  usedFallback?: boolean;
}

// เรียกโมเดลตัวเดียว
async function callModel(
  model: Exclude<BrainModel, "auto">,
  message: string,
  context: string,
): Promise<string> {
  switch (model) {
    case "codex":
      return askCodex(message, { system: context, timeoutMs: 150_000 });
    case "claude":
      return askClaude(message, { system: context, timeoutMs: 150_000 });
    case "gemini":
      return askGemini(message, { system: context, timeoutMs: 150_000 });
    case "hermes":
      return askHermes(message, context, 150_000);
  }
}

export async function askBrain(
  message: string,
  opts: { model?: BrainModel; extraContext?: string } = {},
): Promise<BrainResult> {
  const requested = opts.model ?? (await getDefaultModel());
  let context = await buildFullContext();
  const convo = await recentConversation();
  if (convo) context += `\n\n${convo}`;
  if (opts.extraContext) context += `\n\n${opts.extraContext}`;

  // โหมด auto: Hermes (น้องวาน agent gpt-5.5) ด่านหน้า → Codex → Claude co-brain → Gemini สำรอง
  if (requested === "auto") {
    const order: Exclude<BrainModel, "auto">[] = [];
    if (hermesConfigured()) order.push("hermes");
    if (codexConfigured()) order.push("codex");
    order.push("claude", "gemini");
    let lastErr: unknown;
    for (let i = 0; i < order.length; i++) {
      try {
        const reply = await callModel(order[i], message, context);
        return { reply, model: order[i], usedFallback: i > 0 };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("ทุกโมเดลเชื่อมต่อไม่ได้");
  }

  const reply = await callModel(requested, message, context);
  return { reply, model: requested };
}

// สถานะการเชื่อมต่อของสมอง AI (ไว้แสดงในหน้า settings)
export async function brainStatus() {
  return {
    defaultModel: await getDefaultModel(),
    codex: codexConfigured(),
    hermes: hermesConfigured(),
    obsidian: obsidianStatus(),
  };
}
