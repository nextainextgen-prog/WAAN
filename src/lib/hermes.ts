import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * ตัวเชื่อม Hermes — agent ของ Nous Research (NousResearch/hermes-agent)
 * รองรับ 2 โหมด:
 *   1) CLI (แนะนำ): เรียก `hermes -z "<prompt>"` (one-shot) — ติดตั้งผ่าน install.sh
 *   2) Webhook: POST ไป HERMES_WEBHOOK_URL (เช่น n8n) ถ้าตั้งค่าไว้
 */

function hermesCliPath(): string | null {
  const explicit = process.env.HERMES_CLI_PATH?.trim();
  if (explicit) return existsSync(explicit) ? explicit : null;
  const candidates = [
    path.join(os.homedir(), ".local/bin/hermes"),
    "/usr/local/bin/hermes",
    path.join(os.homedir(), ".hermes/bin/hermes"),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

export function hermesConfigured(): boolean {
  return Boolean(process.env.HERMES_WEBHOOK_URL?.trim()) || hermesCliPath() !== null;
}

// โหมด CLI — hermes -z (one-shot, print เฉพาะคำตอบ)
function askHermesCli(message: string, context: string, timeoutMs: number): Promise<string> {
  const cli = hermesCliPath();
  if (!cli) return Promise.reject(new Error("ไม่พบ hermes CLI"));
  const fullInput = context ? `${context}\n\n---\n\n${message}` : message;

  return new Promise((resolve, reject) => {
    const args = ["-z", fullInput];
    if (process.env.HERMES_MODEL) args.push("-m", process.env.HERMES_MODEL);
    if (process.env.HERMES_PROVIDER) args.push("--provider", process.env.HERMES_PROVIDER);

    const child = spawn(cli, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill("SIGTERM");
      reject(new Error("Hermes CLI timeout"));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error(`เรียก Hermes CLI ไม่ได้ (${err.message})`));
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `Hermes CLI exited with code ${code}`));
    });
  });
}

// โหมด Webhook
async function askHermesWebhook(message: string, context: string, timeoutMs: number): Promise<string> {
  const url = process.env.HERMES_WEBHOOK_URL!.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.HERMES_AUTH_HEADER) headers["Authorization"] = process.env.HERMES_AUTH_HEADER;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ message, context, source: "changoh-system" }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Hermes ตอบกลับ ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const data = await res.json();
      return String(data.reply ?? data.output ?? data.text ?? JSON.stringify(data));
    }
    return (await res.text()).trim();
  } finally {
    clearTimeout(timer);
  }
}

export async function askHermes(message: string, context: string, timeoutMs = 150_000): Promise<string> {
  // webhook มาก่อนถ้าตั้งค่าไว้ (ผู้ใช้ตั้งใจ) ไม่งั้นใช้ CLI
  if (process.env.HERMES_WEBHOOK_URL?.trim()) return askHermesWebhook(message, context, timeoutMs);
  return askHermesCli(message, context, timeoutMs);
}
