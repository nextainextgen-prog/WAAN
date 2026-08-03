// ===== Thunder — สร้าง embedding ด้วย Ollama (BGE-M3) รันในเครื่อง =====
// ข้อมูลลูกค้าไม่ออกนอกเครื่อง (เหมาะกับ PDPA)
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const EMBED_MODEL = process.env.THUNDER_EMBED_MODEL || "bge-m3";
export const EMBED_DIM = Number(process.env.THUNDER_EMBED_DIM || 1024); // bge-m3 = 1024 มิติ

// แปลงข้อความ → เวกเตอร์ (Float32Array). คืน null ถ้า Ollama ล่ม (ให้ผู้เรียกถอยไป structured lookup)
export async function embedText(text: string): Promise<Float32Array | null> {
  const input = (text || "").trim();
  if (!input) return null;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const vec: number[] | undefined = j.embeddings?.[0] || j.embedding;
    if (!Array.isArray(vec) || vec.length === 0) return null;
    return Float32Array.from(vec);
  } catch {
    return null;
  }
}

// batch หลายข้อความในครั้งเดียว (เร็วกว่าเรียกทีละอัน)
export async function embedBatch(texts: string[]): Promise<(Float32Array | null)[]> {
  const clean = texts.map((t) => (t || "").trim());
  const nonEmpty = clean.filter(Boolean);
  if (!nonEmpty.length) return texts.map(() => null);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: clean }),
    });
    if (!res.ok) return texts.map(() => null);
    const j = await res.json();
    const arr: number[][] | undefined = j.embeddings;
    if (!Array.isArray(arr)) return texts.map(() => null);
    return clean.map((t, i) => (t && arr[i] ? Float32Array.from(arr[i]) : null));
  } catch {
    return texts.map(() => null);
  }
}

// เช็คว่า Ollama + โมเดลพร้อมไหม (ไว้เตือนตอน ingest/search)
export async function embedReady(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return { ok: false, reason: "Ollama ไม่ตอบ" };
    const j = await r.json();
    const has = (j.models || []).some((m: { name?: string }) => (m.name || "").startsWith(EMBED_MODEL));
    return has ? { ok: true } : { ok: false, reason: `ยังไม่มีโมเดล ${EMBED_MODEL} — รัน: ollama pull ${EMBED_MODEL}` };
  } catch {
    return { ok: false, reason: "เชื่อม Ollama ไม่ได้ (localhost:11434) — เปิดแอป Ollama" };
  }
}
