// ตัวรันงาน "พัฒนาตัวเอง" ของ Vex — รัน detached นอกโปรเซสเว็บ (เพราะงานจบด้วยการรีสตาร์ทเว็บ)
// flow: อ่านงานจาก DB → claude CLI (ตัวเดียวกับพี่โด้ใช้) แก้โค้ดตามกติกา → รีสตาร์ท → รายงานผลเข้าแชทตรง
// เรียก: npx tsx scripts/kiki-dev-run.ts <jobId>
import { spawn, execSync } from "node:child_process";
import { db } from "../src/lib/db";

const ROOT = process.cwd();
const jobId = process.argv[2];
if (!jobId) { console.error("no jobId"); process.exit(1); }

const DEV_RULES = `คุณคือวิศวกรผู้ดูแลระบบ "Vex" (เลขาส่วนตัว Telegram) ในโปรเจกต์นี้ ทำงานตามสเปกที่ได้รับให้จบจริง

ขอบเขตไฟล์ (เด็ดขาด): แก้ได้เฉพาะ src/lib/kiki*.ts · src/app/api/kiki/** · scripts/kiki-bot.mjs · scripts/kiki-dev-run.ts · scripts/watchdog.mjs · prisma/schema.prisma (เฉพาะ model ของ Vex: Kiki*/FinanceTxn/FinanceBudget/Debt/WishItem/OwnerFact/Recurring/RecurringBill)
ห้ามแตะ: ไฟล์อื่นทั้งหมด (ของน้องวาน/เว็บบริษัท) · .env · credentials* · ห้าม sudo · ห้าม rm -rf · ห้ามลบไฟล์

ขั้นตอนบังคับ:
1. อ่านโค้ดที่เกี่ยวก่อนแก้ (โครง: src/lib/kiki.ts=แกน+persona, kiki-finance/calendar/life/gmail/userbot/mac/hermes.ts, ingest=intent ทั้งหมด, cron=งานตามเวลา, scripts/kiki-bot.mjs=ตัวส่ง Telegram)
2. แก้ schema (ถ้าจำเป็น) → npx prisma db push ก่อน
3. npx tsc --noEmit ต้องผ่าน — ไม่ผ่านให้แก้จนผ่าน แก้ไม่ได้ให้ git checkout ไฟล์ที่แตะคืนแล้วรายงานว่าล้มเหลวเพราะอะไร
4. git add เฉพาะไฟล์ที่คุณแก้ → commit ลง main (ข้อความ: "feat(vex-self): <สรุป>" + บรรทัดท้าย "Co-Authored-By: Vex Self-Dev <noreply@anthropic.com>") → git push origin main
5. ห้ามรัน launchctl/รีสตาร์ทเอง — ระบบภายนอกจะรีสตาร์ทให้หลังคุณจบ
6. บรรทัดท้ายสุดของคำตอบ: สรุปสิ่งที่ทำ + วิธีใช้/สั่งทดสอบ (ภาษาไทย สั้น อ่านง่าย — ข้อความนี้จะถูกส่งให้เจ้าของใน Telegram)

ถ้าสเปกกำกวมให้ตัดสินใจเองแบบ conservative ตามแพตเทิร์นที่มีอยู่ในโค้ด (intent regex + ปุ่มยืนยัน + deterministic ก่อน LLM)`;

async function tgSend(chatId: string, text: string): Promise<void> {
  const token = (process.env.KIKI_BOT_TOKEN || "").trim();
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 3900) }),
  }).catch(() => {});
}

function sh(cmd: string): string {
  try { return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return ""; }
}

async function main() {
  const job = await db.kikiHermesJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("job not found");
  const spec = job.task.replace(/^\[พัฒนา\]\s*/, "");
  const before = sh("git rev-parse HEAD");

  const cliPath = process.env.CLAUDE_CLI_PATH || "claude";
  const out: string[] = [];
  const code = await new Promise<number>((resolve) => {
    const child = spawn(cliPath, ["-p", "--output-format", "text", "--strict-mcp-config", "--allowedTools", "Bash,Read,Glob,Grep,Write,Edit"], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_DISABLE_IDE: "1" },
    });
    const timer = setTimeout(() => { child.kill("SIGTERM"); resolve(124); }, 45 * 60_000);
    child.stdout.on("data", (d) => out.push(d.toString()));
    child.stderr.on("data", (d) => out.push(d.toString()));
    child.on("close", (c) => { clearTimeout(timer); resolve(c ?? 1); });
    child.stdin.write(`${DEV_RULES}\n\n=== สเปกจากเจ้าของ ===\n${spec}`);
    child.stdin.end();
  });

  const after = sh("git rev-parse HEAD");
  const committed = after && after !== before;
  const tscOk = sh("npx tsc --noEmit 2>&1 || echo TSC_FAIL").includes("TSC_FAIL") === false;

  // รีสตาร์ทให้โค้ดใหม่ทำงาน (เฉพาะเมื่อมี commit จริง)
  if (committed && tscOk) {
    sh(`launchctl kickstart -k gui/${process.getuid?.() || 501}/com.changoh.web`);
    for (let i = 0; i < 45; i++) {
      if (sh(`curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://localhost:3000/`)) {
        const codeStr = sh(`curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://localhost:3000/`);
        if (/^(200|30\d)$/.test(codeStr)) break;
      }
      execSync("sleep 2");
    }
    sh(`launchctl kickstart -k gui/${process.getuid?.() || 501}/com.changoh.kiki`);
  }

  const tail = out.join("").trim().split("\n").filter(Boolean).slice(-12).join("\n");
  const ok = code === 0 && committed && tscOk;
  await db.kikiHermesJob.update({
    where: { id: jobId },
    data: { status: ok ? "done" : "failed", result: tail.slice(0, 8000), error: ok ? null : `exit=${code} commit=${committed} tsc=${tscOk}`, doneAt: new Date(), sentAt: new Date() },
  });
  const head = ok
    ? `พัฒนาเสร็จแล้วครับ ✅ (commit ${after.slice(0, 7)} — ระบบรีสตาร์ทรันของใหม่แล้ว)`
    : code === 124
      ? `งานพัฒนาใช้เวลาเกิน 45 นาที ผมหยุดไว้ก่อนครับ ⚠️${committed ? ` (มี commit ${after.slice(0, 7)} ค้าง — แจ้งพี่โด้เช็คด้วย)` : " ไม่มีการแก้ไขค้าง"}`
      : `งานพัฒนาไม่สำเร็จครับ ⚠️ (${committed ? `มี commit แต่ tsc ${tscOk ? "ผ่าน" : "ไม่ผ่าน"}` : "ไม่มีการแก้ไขเกิดขึ้น"}) — ส่งเรื่องให้พี่โด้ดูต่อได้`;
  await tgSend(job.chatId, `${head}\n\nงาน: ${spec.slice(0, 150)}\n\nรายงานจากวิศวกร:\n${tail.slice(-1200)}`);
}

main().then(() => process.exit(0)).catch(async (e) => {
  await db.kikiHermesJob.update({ where: { id: jobId }, data: { status: "failed", error: String(e?.message || e).slice(0, 400), doneAt: new Date(), sentAt: new Date() } }).catch(() => {});
  console.error(e);
  process.exit(1);
});
