// ===== Thunder — จัดกลุ่มข้อความที่ "ความหมายเดียวกัน" ด้วย embedding =====
// แก้ปัญหาเดิม: "ต่ออายุบัญชี" / "ต่ออายุบอท" / "ต่ออายุบริการ" ถูกนับแยกกัน
// ทั้งที่เป็นเรื่องเดียวกัน ทำให้อันดับคำถามบ่อยเพี้ยน
import { embedBatch } from "@/lib/embeddings";

export interface Cluster {
  label: string; // ข้อความตัวแทนของกลุ่ม
  items: string[]; // สมาชิกทั้งหมด
  n: number;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// จัดกลุ่มแบบ greedy: เทียบกับตัวแทนของแต่ละกลุ่ม ถ้าคล้ายพอก็เข้ากลุ่มเดิม
// minSim 0.72 = ความหมายใกล้กันจริง (วัดจาก bge-m3 กับข้อความไทย)
export async function clusterTexts(texts: string[], minSim = 0.72): Promise<Cluster[]> {
  const clean = texts.map((t) => (t || "").trim()).filter((t) => t.length >= 3);
  if (!clean.length) return [];
  if (clean.length === 1) return [{ label: clean[0], items: clean, n: 1 }];

  const vecs = await embedBatch(clean);
  const clusters: { rep: Float32Array; label: string; items: string[] }[] = [];

  for (let i = 0; i < clean.length; i++) {
    const v = vecs[i];
    if (!v) {
      // embed ไม่ได้ → จับกลุ่มด้วยข้อความตรงตัวแทน
      const same = clusters.find((c) => c.label === clean[i]);
      if (same) same.items.push(clean[i]);
      continue;
    }
    let best: { c: (typeof clusters)[number]; sim: number } | null = null;
    for (const c of clusters) {
      const sim = cosine(v, c.rep);
      if (sim >= minSim && (!best || sim > best.sim)) best = { c, sim };
    }
    if (best) best.c.items.push(clean[i]);
    else clusters.push({ rep: v, label: clean[i], items: [clean[i]] });
  }

  return clusters
    .map((c) => ({
      // ตัวแทนกลุ่ม = ข้อความที่สั้นที่สุด (มักเป็นประโยคที่ตรงประเด็นที่สุด)
      label: [...c.items].sort((a, b) => a.length - b.length)[0],
      items: c.items,
      n: c.items.length,
    }))
    .sort((a, b) => b.n - a.n);
}
