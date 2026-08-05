import { geminiFetch } from "./gemini-usage";

/**
 * ลูปใช้เครื่องมือของ Vex (เจ้าของสั่ง 5 ส.ค. 2026: "ยังไม่ฉลาด อยากให้วิเคราะห์ตัดสินใจได้มากกว่านี้")
 *
 * **ข้อจำกัดของโครงเดิม**: router เลือก 1 เจตนา → 1 ตัวจัดการ → ตอบ → จบ
 * `chat.ts` ประกอบ prompt ก้อนใหญ่แล้วเรียกสมองรอบเดียว **ไม่มีจังหวะ "เห็นผลแล้วคิดต่อ"**
 * → ทำงานหลายขั้นไม่ได้เลย เช่น "หาของ → เทียบราคา → ดูว่างบพอไหม → ฟันธง"
 *   ต้องเดาทุกอย่างในครั้งเดียว ไม่ก็ถามกลับ (ซึ่งเจ้าของเกลียดที่สุด)
 *
 * **ที่เพิ่ม**: วางแผน → เรียกเครื่องมือ → เห็นผลจริง → ตัดสินใจต่อ → ตอบ
 *
 * **ขอบเขตที่จงใจจำกัดไว้ (สำคัญ)**
 * เครื่องมือในลูปนี้ **อ่านอย่างเดียวทั้งหมด** ไม่มีตัวไหนเขียน/ส่ง/จ่ายเงิน/ลบ
 * ทางเขียนยังเดินผ่านตัวจัดการเดิมที่มีขั้นยืนยันครบเหมือนเดิมทุกประการ
 * เหตุผล: ลูปที่ตัดสินใจเองได้ + สั่งการได้จริง = พลาดทีเดียวแก้ไม่ได้
 *         ให้มัน "รู้มากขึ้นก่อนตอบ" ปลอดภัยกว่าให้มัน "ทำมากขึ้น"
 */

export interface AgentTool {
  name: string;
  description: string;
  params: Record<string, { type: string; description: string }>;
  required?: string[];
  run: (args: Record<string, string>) => Promise<string>;
}

const clip = (s: string, n = 6000) => (s.length > n ? `${s.slice(0, n)}\n…(ตัดที่ ${n} ตัวอักษร)` : s);

/**
 * เครื่องมือทั้งหมด — อ่านอย่างเดียว
 * ทุกตัวคืน "ข้อความที่อ่านรู้เรื่อง" ไม่ใช่ JSON ดิบ เพราะปลายทางคือสมองที่ต้องเอาไปคิดต่อ
 */
export function agentTools(): AgentTool[] {
  return [
    {
      name: "recall_memory",
      description: "ค้นบทสนทนาเก่ากับเจ้าของย้อนหลังทั้งหมด ใช้เมื่อต้องรู้ว่าเคยคุยอะไรกันไว้ เคยตกลงอะไรกัน หรือเจ้าของเคยบอกความชอบ/เงื่อนไขอะไรไว้",
      params: { query: { type: "string", description: "เรื่องที่อยากค้น" } },
      required: ["query"],
      run: async (a) => {
        const { recallContext } = await import("./kiki-memory");
        return clip((await recallContext(a.query || "")) || "ไม่เจอบทสนทนาเก่าที่เกี่ยวข้อง");
      },
    },
    {
      name: "read_finance",
      description: "ดูสถานะการเงินจริงของเจ้าของ: งบคงเหลือ ใช้ไปเท่าไหร่ เหลือใช้ได้วันละเท่าไหร่ หนี้ บิลที่ใกล้ตัด — ใช้ทุกครั้งที่ต้องตัดสินใจเรื่องเงินหรือของที่ต้องซื้อ",
      params: {},
      run: async () => {
        const { financeSnapshot, snapshotFacts } = await import("./kiki-finance");
        const snap = await financeSnapshot();
        return clip(snapshotFacts(snap).join("\n"));
      },
    },
    {
      name: "read_calendar",
      description: "ดูนัดหมายที่จะถึง ใช้เมื่อต้องรู้ว่าเจ้าของว่างไหม ชนกับอะไรหรือเปล่า",
      params: { limit: { type: "string", description: "เอากี่รายการ (ไม่ใส่ = 10)" } },
      run: async (a) => {
        // ห้ามใช้ getUpcoming() ของปฏิทินกลาง — มันกรองด้วย chatId ไม่ใช่ agent
        // ส่ง "kiki" เข้าไปจะได้ศูนย์รายการเสมอ (นัดของ Vex อยู่คนละ chatId กัน)
        const { db } = await import("./db");
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const rows = await db.calendarEvent.findMany({
          where: { agent: "kiki", done: false, date: { gte: start } },
          orderBy: { date: "asc" },
          take: Number(a.limit) || 10,
        }).catch(() => []);
        if (!rows.length) return "ไม่มีนัดที่จะถึง";
        return clip(rows.map((r) => `${r.date.toLocaleDateString("th-TH")} ${r.timeText || "(ทั้งวัน)"} — ${r.title}${r.location ? ` ที่ ${r.location}` : ""}${r.withWho ? ` กับ${r.withWho}` : ""}`).join("\n"));
      },
    },
    {
      name: "read_tasks",
      description: "ดูงานที่ค้างในกระดานงานของเจ้าของ",
      params: {},
      run: async () => {
        const { tasksContext } = await import("./kiki-tasks");
        return clip((await tasksContext()) || "ไม่มีงานค้าง");
      },
    },
    {
      name: "read_url",
      description: "เปิดอ่านลิงก์จริง ๆ (คลิป YouTube = ดูคลิปจริง · เว็บที่ต้องล็อกอิน = เปิดในเบราว์เซอร์ที่ล็อกอินไว้) ใช้เมื่อต้องรู้เนื้อในลิงก์ ห้ามเดาเนื้อหาจาก URL",
      params: { url: { type: "string", description: "ลิงก์ที่จะอ่าน" } },
      required: ["url"],
      run: async (a) => {
        const { readAnyUrl } = await import("./kiki-read");
        const r = await readAnyUrl(a.url || "", { shot: false });
        if (!r.ok && !r.text) return `เปิดลิงก์นี้ไม่ได้: ${r.problem || "ไม่ทราบสาเหตุ"} — ห้ามเดาเนื้อหา ให้บอกเจ้าของตรง ๆ`;
        return clip(`### ${r.title}\n${r.text}`, 12_000);
      },
    },
    {
      name: "search_web",
      description: "ค้นข้อมูลสด ๆ จากอินเทอร์เน็ต ใช้เมื่อต้องการข้อมูลปัจจุบัน ราคา ข่าว หรือของที่ไม่แน่ใจว่ายังจริงอยู่ไหม",
      params: { query: { type: "string", description: "คำค้น" } },
      required: ["query"],
      run: async (a) => {
        const { webResearch } = await import("./kiki");
        return clip(await webResearch(a.query || ""), 10_000);
      },
    },
    {
      name: "read_owner_facts",
      description: "ดูข้อเท็จจริงถาวรเกี่ยวกับเจ้าของที่เคยสั่งให้จำไว้ (นิสัย ความชอบ เป้าหมาย ข้อห้าม คนรอบตัว)",
      params: {},
      run: async () => {
        const { ownerFactsContext } = await import("./kiki");
        return clip((await ownerFactsContext()) || "ยังไม่มีข้อมูลที่จำไว้");
      },
    },
    {
      name: "read_owner_profile",
      description: "ดูโปรไฟล์เจ้าของที่กลั่นมาแล้ว: เป้าหมายตอนนี้ เพดานเงิน รสนิยมเวลาเลือกของ ข้อห้าม จังหวะชีวิต — ใช้เมื่อต้อง 'เลือกแทนเขา' หรือฟันธงว่าควรเอาตัวไหน",
      params: {},
      run: async () => {
        const { profileContext } = await import("./kiki-profile");
        return clip((await profileContext()) || "ยังไม่มีโปรไฟล์");
      },
    },
  ];
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, string> };
  functionResponse?: { name: string; response: { result: string } };
}
interface GeminiContent { role: string; parts: GeminiPart[] }

export interface AgentRun {
  answer: string;
  steps: { tool: string; args: Record<string, string>; ms: number }[];
  usedTools: boolean;
}

const MAX_ROUNDS = 5;      // พอสำหรับงานหลายขั้น แต่ไม่ปล่อยให้วนไม่จบ
const BUDGET_MS = 110_000; // เพดานเวลารวม — เว็บมี maxDuration 240 วิ ต้องเหลือที่ให้ขั้นตอบ

/**
 * ตอบโดยใช้เครื่องมือได้หลายรอบ
 * โยน error เมื่อใช้ไม่ได้ (ไม่มีคีย์/ล่ม) → ผู้เรียกต้องถอยไปทางเดิมเสมอ ห้ามปล่อยเงียบ
 */
export async function runAgent(system: string, question: string): Promise<AgentRun> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("no GEMINI_API_KEY");

  const tools = agentTools();
  const byName = new Map(tools.map((t) => [t.name, t]));
  const declarations = tools.map((t) => ({
    name: t.name,
    description: t.description,
    ...(Object.keys(t.params).length
      ? { parameters: { type: "OBJECT", properties: Object.fromEntries(Object.entries(t.params).map(([k, v]) => [k, { type: v.type.toUpperCase(), description: v.description }])), required: t.required || [] } }
      : {}),
  }));

  const contents: GeminiContent[] = [{ role: "user", parts: [{ text: question }] }];
  const steps: AgentRun["steps"] = [];
  const t0 = Date.now();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const overBudget = Date.now() - t0 > BUDGET_MS;
    const res = await geminiFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents,
          // หมดเวลา/รอบสุดท้าย = ห้ามเรียกเครื่องมือเพิ่ม ต้องสรุปจากที่มี
          ...(overBudget || round === MAX_ROUNDS - 1 ? {} : { tools: [{ function_declarations: declarations }] }),
        }),
        signal: AbortSignal.timeout(90_000),
      },
      "agent",
    );
    const j = (await res.json()) as { candidates?: { content?: GeminiContent }[]; error?: { message?: string } };
    if (j.error?.message) throw new Error(j.error.message);
    const parts = j.candidates?.[0]?.content?.parts || [];
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall!);

    if (!calls.length) {
      const answer = parts.map((p) => p.text || "").join("").trim();
      if (!answer) throw new Error("ตอบว่าง");
      return { answer, steps, usedTools: steps.length > 0 };
    }

    contents.push({ role: "model", parts });
    const responses: GeminiPart[] = [];
    for (const c of calls) {
      const tool = byName.get(c.name);
      const args = c.args || {};
      const s = Date.now();
      let result: string;
      if (!tool) {
        result = `ไม่มีเครื่องมือชื่อ ${c.name}`;
      } else {
        // เครื่องมือพังไม่ควรล้มทั้งลูป — บอกสมองไปตรง ๆ แล้วให้มันหาทางอื่น
        result = await tool.run(args).catch((e) => `เครื่องมือนี้ใช้ไม่ได้ตอนนี้: ${e instanceof Error ? e.message.slice(0, 200) : "error"}`);
      }
      steps.push({ tool: c.name, args, ms: Date.now() - s });
      responses.push({ functionResponse: { name: c.name, response: { result } } });
    }
    contents.push({ role: "user", parts: responses });
  }

  throw new Error("ลูปไม่จบใน 5 รอบ");
}

// ===== ชั้นหาข้อมูลก่อนตอบ =====

const NO_TOOLS = "ไม่ต้องหาอะไรเพิ่ม";

const GATHER_SYSTEM = `คุณคือ "ฝ่ายหาข้อมูล" ของเลขาส่วนตัวคนหนึ่ง ไม่ได้เป็นคนตอบเจ้าของเอง
หน้าที่เดียวของคุณ: อ่านคำถาม/คำสั่งของเจ้าของ แล้ว "ไปหาข้อเท็จจริงที่คนตอบจำเป็นต้องรู้" ด้วยเครื่องมือที่มี

วิธีทำงาน
- ใช้เครื่องมือได้หลายตัวและหลายรอบ เห็นผลรอบแรกแล้วค่อยตัดสินใจว่าต้องหาอะไรต่อ
- เรื่องที่เกี่ยวกับ "ซื้อ/จ่าย/ราคา/ไหวไหม" ต้องดูการเงินจริงเสมอ ห้ามเดาว่าเจ้าของมีเงินเท่าไหร่
- มีลิงก์ในคำถาม = ต้องเปิดอ่านจริง ห้ามเดาเนื้อหาจาก URL
- ข้อมูลที่อาจเปลี่ยนตามเวลา (ราคา ของที่ขายอยู่ ข่าว สเปก) = ค้นสด อย่าตอบจากความจำ
- เรื่องที่อ้างถึงของเก่า ("ที่คุยกันไว้" "อันนั้น" "เหมือนคราวก่อน") = ค้นบทสนทนาเก่า

สิ่งที่ต้องคืนกลับมาเมื่อหาเสร็จ
- เขียนเป็น "ข้อเท็จจริงที่หามาได้" เป็นข้อ ๆ ไม่ต้องเรียบเรียงสวย ไม่ต้องทักทาย ไม่ต้องสรุปเชิงความเห็น
- ตัวเลข ราคา ลิงก์ ชื่อรุ่น วันที่ ต้องยกมาครบเป๊ะ อย่าปัด อย่าย่อ
- หาไม่เจอ/เปิดไม่ได้ ให้เขียนตรง ๆ ว่าไม่เจอ ห้ามแต่งขึ้นมาเอง

ถ้าคำถามนี้ตอบได้เลยโดยไม่ต้องใช้เครื่องมือใด ๆ (คุยเล่น ทักทาย ถามความเห็นล้วน ๆ ความรู้ทั่วไปที่ไม่เปลี่ยนตามเวลา)
ให้ตอบสั้น ๆ แค่คำว่า: ${NO_TOOLS}`;

export interface Gathered {
  notes: string;                 // ข้อเท็จจริงที่หามาได้ (ว่าง = ไม่ต้องหาอะไร)
  steps: AgentRun["steps"];
  ms: number;
}

/**
 * ไปหาข้อเท็จจริงมาก่อนให้ Vex ตอบ (D1 — 5 ส.ค. 2026)
 *
 * ทำไมแยกเป็นสองชั้น แทนที่จะให้ลูปตอบเจ้าของเอง:
 *  - เสียงและบุคลิกของ Vex อยู่กับสมองหลัก (Claude ผ่าน `askKiki`) ถ้าให้ลูปตอบตรง ๆ
 *    คำตอบจะเปลี่ยนเสียงทันที และกติกาข้อ 2 (ห้ามข้อความสำเร็จรูป/ต้องผ่าน askKiki) จะพัง
 *  - ชั้นนี้ทำหน้าที่เดียวคือ "รู้ให้มากขึ้นก่อนพูด" ซึ่งเป็นสิ่งที่เจ้าของขอจริง ๆ
 *
 * ล้มเหลวเมื่อไหร่ = คืน notes ว่าง แล้วปล่อยให้ตอบแบบเดิม (ห้ามทำให้ทางเดิมพัง)
 */
export async function gatherFacts(question: string, extraHint = ""): Promise<Gathered> {
  const t0 = Date.now();
  const empty: Gathered = { notes: "", steps: [], ms: 0 };
  if (!question.trim()) return empty;
  try {
    const r = await runAgent(GATHER_SYSTEM, `${extraHint ? `${extraHint}\n\n` : ""}เจ้าของพูดว่า: """${question.slice(0, 4000)}"""`);
    const notes = r.answer.trim();
    // ไม่ได้เรียกเครื่องมือเลย = ไม่มีข้อเท็จจริงใหม่ ทิ้งไปเลย อย่าเอาความเห็นของชั้นนี้ไปปนกับคำตอบ
    if (!r.usedTools || notes.includes(NO_TOOLS)) return { ...empty, steps: r.steps, ms: Date.now() - t0 };
    return { notes, steps: r.steps, ms: Date.now() - t0 };
  } catch {
    return { ...empty, ms: Date.now() - t0 };
  }
}
