import { spawn } from "node:child_process";

/**
 * เรียก Claude ผ่าน Claude Code CLI (ใช้ Max subscription — ไม่ใช้ API key)
 * รูปแบบ: claude -p "<prompt>"  โดยส่ง system/context ทาง stdin
 */
export interface ClaudeOptions {
  system?: string; // system prompt / บริบท
  timeoutMs?: number;
  maxBuffer?: number;
}

export async function askClaude(prompt: string, opts: ClaudeOptions = {}): Promise<string> {
  const cliPath = process.env.CLAUDE_CLI_PATH || "claude";
  const timeoutMs = opts.timeoutMs ?? 120_000;

  // รวม context + คำถามเป็น input เดียว ส่งทาง stdin (รองรับข้อความยาว/ภาษาไทย)
  const fullInput = opts.system ? `${opts.system}\n\n---\n\n${prompt}` : prompt;

  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "text"];
    const child = spawn(cliPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill("SIGTERM");
      reject(new Error("Claude CLI timeout — ใช้เวลานานเกินไป"));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(
        new Error(
          `เรียก Claude CLI ไม่ได้ (${err.message}). ตรวจสอบว่าติดตั้ง claude และ login Max แล้ว`,
        ),
      );
    });

    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `Claude CLI exited with code ${code}`));
      }
    });

    child.stdin.write(fullInput);
    child.stdin.end();
  });
}

// ตรวจว่า claude CLI พร้อมใช้งานไหม
export async function claudeHealthCheck(): Promise<{ ok: boolean; detail: string }> {
  try {
    const out = await askClaude("ตอบกลับคำเดียวว่า: OK", { timeoutMs: 30_000 });
    return { ok: true, detail: out.slice(0, 80) };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
