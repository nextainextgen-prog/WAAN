import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * เรียก Google Gemini — เป็น "สมองสำรอง" ของน้องวาน (last resort)
 * รองรับ 2 ทาง:
 *   1) REST API (แนะนำ/ดีฟอลต์): ใช้ GEMINI_API_KEY — เสถียร ไม่ต้องพึ่ง CLI
 *   2) Gemini CLI: ถ้ามี binary จริง (GEMINI_CLI_PATH ชี้ไฟล์ที่มีอยู่)
 */
export interface GeminiOptions {
  system?: string;
  timeoutMs?: number;
  model?: string;
}

function geminiCliBinary(): string | null {
  const p = process.env.GEMINI_CLI_PATH?.trim();
  // ยอมรับเฉพาะเมื่อชี้ไปไฟล์ที่มีอยู่จริง (ค่า "gemini" เฉยๆ = ไม่มีในเครื่องนี้)
  if (p && p.includes("/") && existsSync(p)) return p;
  return null;
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim()) || geminiCliBinary() !== null;
}

// ทาง REST API
async function askGeminiApi(prompt: string, opts: GeminiOptions): Promise<string> {
  const key = process.env.GEMINI_API_KEY!.trim();
  const model = opts.model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    };
    if (opts.system) {
      body.systemInstruction = { parts: [{ text: opts.system }] };
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Gemini API ตอบกลับ ${res.status} ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((p: { text?: string }) => p.text || "").join("")
      : "";
    if (!text.trim()) throw new Error("Gemini ไม่มีข้อความตอบกลับ");
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

// ทาง CLI
function askGeminiCli(prompt: string, opts: GeminiOptions, cli: string): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const fullInput = opts.system ? `${opts.system}\n\n---\n\n${prompt}` : prompt;

  return new Promise((resolve, reject) => {
    const child = spawn(cli, [], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill("SIGTERM");
      reject(new Error("Gemini CLI timeout"));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(`เรียก Gemini CLI ไม่ได้ (${err.message})`));
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `Gemini CLI exited with code ${code}`));
    });

    child.stdin.write(fullInput);
    child.stdin.end();
  });
}

export async function askGemini(prompt: string, opts: GeminiOptions = {}): Promise<string> {
  // REST มาก่อนถ้ามี key (เสถียรกว่า) ไม่งั้นใช้ CLI ถ้ามี binary จริง
  if (process.env.GEMINI_API_KEY?.trim()) return askGeminiApi(prompt, opts);
  const cli = geminiCliBinary();
  if (cli) return askGeminiCli(prompt, opts, cli);
  throw new Error("Gemini ยังไม่พร้อม — ตั้ง GEMINI_API_KEY หรือชี้ GEMINI_CLI_PATH ไป binary จริง");
}
