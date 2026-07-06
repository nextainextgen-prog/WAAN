import { spawn } from "node:child_process";

/**
 * เรียก Google Gemini ผ่าน Gemini CLI (login ด้วยบัญชี Google — ไม่ใช้ API key)
 * ใช้เป็นสมองสำรอง/ทางเลือกของเลขา AI คู่กับ Claude
 */
export interface GeminiOptions {
  system?: string;
  timeoutMs?: number;
}

export async function askGemini(prompt: string, opts: GeminiOptions = {}): Promise<string> {
  const cliPath = process.env.GEMINI_CLI_PATH || "gemini";
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const fullInput = opts.system ? `${opts.system}\n\n---\n\n${prompt}` : prompt;

  return new Promise((resolve, reject) => {
    // ส่ง input ทาง stdin เพื่อรองรับข้อความยาว/ภาษาไทย
    const child = spawn(cliPath, [], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
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
      reject(new Error(`เรียก Gemini CLI ไม่ได้ (${err.message}). ตรวจสอบว่าติดตั้ง gemini และ login แล้ว`));
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
