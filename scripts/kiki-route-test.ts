// ชุดทดสอบตัวอ่านเจตนา — ทุกเคสมาจากของจริงที่เจ้าของเคยเจอ
// รัน: npm run kiki:route-test [รอบ]   (ใส่เลขรอบเพื่อวัด "ความเสถียร" ว่าประโยคเดิมไปทางเดิมทุกครั้งไหม)
import { routeIntent } from "../src/lib/kiki-router";

interface Case { text: string; want: string; reply?: string; shot?: boolean }

const CASES: Case[] = [
  { text: "คิดชื่อกลุ่มนี้ให้หน่อย อยากได้ประมาณว่า กลุ่มชีวิต 2026 เป็นภาษาอังกฤษ", want: "think" },
  { text: "อยากได้ AirPods Pro ซื้อไหวไหม", want: "wish" },
  { text: 'ให้มึงพูดว่า "ผมไม่ได้พูดครับ อั๋นพูดเอง" ส่งมาเป็นเสียง', want: "say_voice" },
  { text: "เปิดโหมดตอบเสียงหน่อย", want: "voice_mode" },
  { text: "ไม่ต้องพูดแล้ว ตอบเป็นตัวหนังสือพอ", want: "voice_mode" },
  { text: "เวลาบอกว่าจดลงกระดานงานแล้ว ให้เพิ่มอิโมจิ ✅ ไปด้วยทุกครั้ง", want: "rule_teach" },
  { text: "ต่อไปนี้ตอบสั้น ๆ พอ", want: "rule_teach" },
  { text: "จดไว้หน่อย โทรหาช่างแอร์พรุ่งนี้", want: "task_add" },
  { text: "โน๊ตไว้หน่อย ทำต่อว่าง", want: "task_add" },
  { text: "ถ้าผมถึง BNI แล้ว อย่าลืมบอกผมแจ้ง HR", want: "task_add" },
  { text: "ตอนนี้ผมมีงานอะไรที่ยังไม่ได้ทำ", want: "task_list" },
  { text: "เสร็จแล้วข้อ 2", want: "task_done" },
  { text: "จำไว้ว่าแฟนผมชื่ออั๋น แพ้กุ้ง", want: "memory_remember" },
  { text: "จำได้ไหมที่คุยเรื่องแผนลดน้ำหนัก", want: "memory_recall" },
  { text: "รู้จักผมแค่ไหนแล้ว", want: "memory_list" },
  { text: "จ่ายค่าข้าว 120", want: "finance_record" },
  { text: "วันนี้ใช้เงินไปเท่าไหร่แล้ว", want: "finance_query" },
  { text: "เดือนนี้หมวดไหนใช้เยอะสุด", want: "finance_analyze" },
  { text: "รวมรายการเงินออกที่ยังรอระบุมาให้หมด", want: "finance_pending" },
  { text: "ลงนัดพรุ่งนี้ 10 โมง ประชุมกับลูกค้า", want: "calendar_create" },
  { text: "พรุ่งนี้มีนัดอะไรบ้าง", want: "calendar_view" },
  { text: "หาข้อมูลราคาทองวันนี้ให้หน่อย", want: "web_research" },
  { text: "แคปหน้าจอมาให้ดูหน่อย", want: "mac" },
  { text: "พิมพ์ในดิสคอร์ดห้องบันทึกว่า ทดสอบ แล้วส่งเลย", want: "gui_type" },
  { text: "พิมพ์ไปในห้องนี้หน่อยว่าทดสอบ", reply: "หน้าจอที่เห็นตอนนี้ครับ", shot: true, want: "gui_type" },
  { text: "ไปหาไฟล์นี้ในเครื่องผมแล้วส่งมาให้หน่อย", reply: "docs/monitor-guide.md ฝากไว้ให้แล้ว", want: "file_find" },
  { text: "สรุปให้หน่อยว่าเดือนนี้ใช้เงินยังไง ทำเป็นไฟล์มาเลย", want: "doc_summary" },
  { text: "ยืนยัน", want: "chat" },
];

async function main() {
  const rounds = Math.max(1, Number(process.argv[2] || 1));
  const seen = new Map<string, Set<string>>();
  let pass = 0;
  let total = 0;
  const fails: string[] = [];
  for (let r = 0; r < rounds; r++) {
    for (const c of CASES) {
      const got = await routeIntent({ text: c.text, replyText: c.reply, replyIsScreenshot: c.shot });
      total++;
      if (got.intent === c.want) pass++;
      else fails.push(`${got.intent} (ควรเป็น ${c.want}) :: ${c.text.slice(0, 48)}`);
      const set = seen.get(c.text) || new Set<string>();
      set.add(got.intent);
      seen.set(c.text, set);
    }
  }
  const unstable = [...seen].filter(([, v]) => v.size > 1);
  console.log(`\nถูก ${pass}/${total} (${Math.round((pass / total) * 100)}%)`);
  if (fails.length) {
    console.log("\nที่พลาด:");
    for (const f of [...new Set(fails)]) console.log("  -", f);
  }
  if (rounds > 1) {
    console.log(`\nความเสถียร: ${seen.size - unstable.length}/${seen.size} ประโยคไปทางเดิมทุกรอบ`);
    for (const [t, v] of unstable) console.log(`  - "${t.slice(0, 40)}" → ${[...v].join(" / ")}`);
  }
  process.exit(fails.length ? 1 : 0);
}
main();
