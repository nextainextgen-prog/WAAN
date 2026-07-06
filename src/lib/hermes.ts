/**
 * ตัวเชื่อม Hermes — agent เดิมของอาจารย์ (จาก vault: hermes-agent)
 * เชื่อมผ่าน webhook (เช่น n8n / endpoint ของ Hermes) — ตั้งค่า URL ใน .env
 *
 *   HERMES_WEBHOOK_URL = URL ที่รับ POST { message, context }
 *   HERMES_AUTH_HEADER = (ถ้ามี) ค่า Authorization header
 *
 * รูปแบบ response ที่รองรับ: { reply } | { output } | { text } | ข้อความ string ตรงๆ
 */
export function hermesConfigured(): boolean {
  return Boolean(process.env.HERMES_WEBHOOK_URL?.trim());
}

export async function askHermes(
  message: string,
  context: string,
  timeoutMs = 120_000,
): Promise<string> {
  const url = process.env.HERMES_WEBHOOK_URL?.trim();
  if (!url) throw new Error("ยังไม่ได้ตั้งค่า HERMES_WEBHOOK_URL");

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
