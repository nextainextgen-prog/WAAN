// ===== Thunder — รายงานแชทรายวัน (ฉบับเต็ม) =====
// รวมผลวิเคราะห์รายแชท (Typhoon) + ข้อมูลมอนิเตอร์ (BotActivity) + เทียบเมื่อวาน
// → 4 ข้อความในกลุ่ม + ไฟล์ .md ครบ (ลิงก์แชททุกเคส + ภาพแคปเคสเด่น)
// Claude ใช้เขียน "เล่าเรื่องวันนี้" + "feedback ถึงทีม" จากตัวเลข/คำพูดที่คัดมา
import fs from "node:fs";
import { db } from "@/lib/db";
import { askClaude } from "@/lib/claude";
import { bizDateLabel, bizDateRange, prevBizDate, bizDateOf, captureFaqCandidate, buildMonitorReport, type RangeSpec } from "@/lib/thunder";
import { clusterTexts } from "@/lib/chat-cluster";

const OHO_URL = process.env.OHO_URL || "https://app.oho.chat";
const roomLink = (convId: string) => `${OHO_URL}?room=${convId}`;

const SERVICE_LABEL: Record<string, string> = { easyslip: "EasySlip", thunderBot: "Thunder Bot", thunderApi: "Thunder API" };
const SENT_LABEL: Record<string, string> = { happy: "😊 พอใจ", neutral: "😐 เฉยๆ", upset: "😤 ไม่พอใจ" };
const LINE = "━━━━━━━━━━━━━━━━━━━━";

interface AdminStat {
  name: string; handled: number;
  helpGood: number; helpOk: number; helpPoor: number;
  toneGood: number; tonePoor: number;
  resolved: number; upset: number;
}

export interface DailyStats {
  chatCount: number; rawCount: number;
  byService: Record<string, number>;
  byTopic: Record<string, number>;
  renew: number; install: number; issues: number;
  resolvedRate: number | null;
  questionGroups: { label: string; n: number }[];
  problemGroups: { label: string; n: number }[];
  admins: AdminStat[];
  helpPct: { good: number; ok: number; poor: number } | null;
  tonePct: { good: number; ok: number; poor: number } | null;
  sentiment: { happy: number; neutral: number; upset: number };
  peakHours: { hour: number; n: number }[];
  followUps: { convId: string; customer: string; service: string; question: string; admin: string }[];
  frequentCustomers: { name: string; n: number }[];
  faqNew: number; faqDup: number;
  monitor: { dropped: number; waiting: number; forgot: number; handled: number; forgotByAdmin: { name: string; n: number }[]; maxWaitMin: number };
  trend: { prevCount: number | null; diffPct: number | null; newProblems: string[] };
  autoReplyRoi: { label: string; n: number; share: number }[];
}

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);
// ลบ "อีโมจิครึ่งตัว" (lone surrogate) ที่เกิดจาก .slice() ตัดกลางคู่ surrogate
// ถ้าไม่ลบ → Prisma serialize เป็น JSON แล้ว escape \u ขาด → save พัง ("unexpected end of hex escape")
const noLoneSurrogate = (s: string) =>
  (s || "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "").replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
const esc = (s: string) => noLoneSurrogate(s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
const mdCell = (s: string) => noLoneSurrogate((s || "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 120));

// เติมชื่อแอดมินที่ขาด จากบันทึกมอนิเตอร์ (แชทที่ปิดแล้วไม่มี header "กำลังดูแล")
export async function backfillAdmins(bizDate: string): Promise<number> {
  const rows = await db.chatLog.findMany({ where: { bizDate, OR: [{ admin: null }, { admin: "" }] }, select: { id: true, convId: true } });
  let filled = 0;
  for (const r of rows) {
    const act = await db.botActivity.findFirst({ where: { convId: r.convId, admin: { not: null } }, orderBy: { createdAt: "desc" }, select: { admin: true } });
    const name = (act?.admin || "").trim();
    if (!name) continue;
    await db.chatLog.update({ where: { id: r.id }, data: { admin: name } });
    filled++;
  }
  return filled;
}

// คัดเคสเด่นที่ควรดู (เอาไปแคปหน้าจอ + ใส่ในรายงาน)
export async function pickHighlights(bizDate: string, limit = 5): Promise<{ convId: string; reason: string }[]> {
  const rows = await db.chatLog.findMany({ where: { bizDate, analyzed: true } });
  const scored = rows.map((r) => {
    let score = 0;
    const reasons: string[] = [];
    if (r.sentiment === "upset") { score += 5; reasons.push("ลูกค้าไม่พอใจ"); }
    if (r.adminHelp === "poor") { score += 4; reasons.push("การตอบต้องปรับ"); }
    if (r.resolved === false) { score += 3; reasons.push("เคสยังไม่จบ"); }
    if (r.adminTone === "poor") { score += 3; reasons.push("น้ำเสียงต้องปรับ"); }
    if (r.problem) { score += 2; reasons.push("มีปัญหาระบบ"); }
    if (r.intent === "install") { score += 1; reasons.push("เคสติดตั้ง"); }
    return { convId: r.convId, score, reason: reasons.join(" · ") || "เคสทั่วไป" };
  });
  const picked = scored.filter((s) => s.score >= 2).sort((a, b) => b.score - a.score).slice(0, limit);
  await db.chatLog.updateMany({ where: { bizDate }, data: { highlight: false } });
  for (const p of picked) await db.chatLog.updateMany({ where: { bizDate, convId: p.convId }, data: { highlight: true } });
  return picked.map((p) => ({ convId: p.convId, reason: p.reason }));
}

// ===== รายงานแชทแบบช่วงวัน (รวมหลายวัน) — สั่งขอเมื่อไหร่ก็ได้ + ไฟล์ .md =====
// เร็ว: รวมสถิติจาก ChatLog ที่วิเคราะห์แล้วในช่วง (ไม่เรียก Claude เล่าเรื่อง/ภาพ)
export async function buildChatRangeReport(sinceMs: number, untilMs: number, label: string): Promise<{ short: string; markdown: string; count: number } | null> {
  const TH = 7 * 3600_000;
  const bizOf = (ms: number) => { const d = new Date(ms + TH - 6 * 3600_000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; };
  const sinceBiz = bizOf(sinceMs), untilBiz = bizOf(untilMs - 1); // untilMs = ต้นวันถัดไป → -1ms ให้ได้วันสุดท้ายจริง
  const rows = await db.chatLog.findMany({ where: { bizDate: { gte: sinceBiz, lte: untilBiz }, analyzed: true }, orderBy: { createdAt: "asc" } });
  const raw = await db.chatLog.count({ where: { bizDate: { gte: sinceBiz, lte: untilBiz } } });
  if (!rows.length) return raw ? { short: `📋 <b>รายงานแชท · ${label}</b>\n\nมีบทสนทนา ${raw} เคส แต่ยังไม่ได้วิเคราะห์ค่ะ (ระบบวิเคราะห์อัตโนมัติทุกเช้า)`, markdown: "", count: 0 } : null;

  const byService: Record<string, number> = {}, byTopic: Record<string, number> = {}, byDay: Record<string, number> = {};
  const adminMap: Record<string, { handled: number; helpGood: number; resolved: number; upset: number }> = {};
  const questions: string[] = [], problems: string[] = [];
  let renew = 0, install = 0, issues = 0, resolvedYes = 0, resolvedKnown = 0, upset = 0;
  for (const r of rows) {
    byService[r.service || "อื่นๆ"] = (byService[r.service || "อื่นๆ"] || 0) + 1;
    if (r.topic) byTopic[r.topic] = (byTopic[r.topic] || 0) + 1;
    byDay[r.bizDate] = (byDay[r.bizDate] || 0) + 1;
    if (r.intent === "renew") renew++; if (r.intent === "install") install++; if (r.intent === "issue") issues++;
    if (r.resolved !== null) { resolvedKnown++; if (r.resolved) resolvedYes++; }
    if (r.sentiment === "upset") upset++;
    if (r.question) questions.push(r.question);
    if (r.problem) problems.push(r.problem);
    const a = (r.admin || "").trim();
    if (a) { const m = (adminMap[a] ||= { handled: 0, helpGood: 0, resolved: 0, upset: 0 }); m.handled++; if (r.adminHelp === "good") m.helpGood++; if (r.resolved) m.resolved++; if (r.sentiment === "upset") m.upset++; }
  }
  const qg = (await clusterTexts(questions)).slice(0, 10);
  const pg = (await clusterTexts(problems)).slice(0, 10);
  const admins = Object.entries(adminMap).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.handled - a.handled);
  const resolvedRate = resolvedKnown ? pct(resolvedYes, resolvedKnown) : null;

  const s: string[] = [];
  s.push(`📋 <b>รายงานแชท · ${label}</b>`, `รวม <b>${rows.length}</b> เคส (${Object.keys(byDay).length} วัน)`, "");
  s.push("<b>แยกบริการ</b>");
  for (const [k, v] of Object.entries(byService).sort((a, b) => b[1] - a[1])) s.push(`  • ${SERVICE_LABEL[k] || k}: ${v}`);
  s.push("", `🔁 ต่ออายุ <b>${renew}</b> · 🛠 ติดตั้ง <b>${install}</b> · ⚠️ ปัญหา <b>${issues}</b>`);
  if (resolvedRate !== null) s.push(`✅ ปิดจบ <b>${resolvedRate}%</b> · 😤 ไม่พอใจ <b>${upset}</b>`);
  if (qg.length) { s.push("", "<b>ถามบ่อยสุด</b>"); qg.slice(0, 5).forEach((q) => s.push(`  ${q.n}× ${q.label}`)); }
  if (admins.length) { s.push("", "<b>แอดมิน</b>"); admins.slice(0, 6).forEach((a) => s.push(`  • ${a.name}: ${a.handled} เคส · ปิดจบ ${pct(a.resolved, a.handled)}%`)); }
  s.push("", "<i>📎 รายละเอียดในไฟล์แนบ</i>");

  const md: string[] = [];
  md.push(`# รายงานแชท · ${label}`, `> รวม **${rows.length}** เคส · ${Object.keys(byDay).length} วัน · ปิดจบ ${resolvedRate ?? "-"}% · ไม่พอใจ ${upset}`, "");
  md.push("## รายวัน", "", "| วันที่ | เคส |", "|---|---|");
  for (const [d, v] of Object.entries(byDay).sort()) md.push(`| ${d} | ${v} |`);
  md.push("", "## แยกบริการ", "", "| บริการ | เคส |", "|---|---|");
  for (const [k, v] of Object.entries(byService).sort((a, b) => b[1] - a[1])) md.push(`| ${SERVICE_LABEL[k] || k} | ${v} |`);
  md.push("", "## ลูกค้าถามเรื่องอะไร", "", "| หมวด | เคส |", "|---|---|");
  for (const [k, v] of Object.entries(byTopic).sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |`);
  md.push("", `ต่ออายุ ${renew} · ติดตั้ง ${install} · ปัญหา ${issues}`, "");
  if (qg.length) { md.push("## คำถามที่พบบ่อย", ""); qg.forEach((q) => md.push(`- **${q.n}×** ${mdCell(q.label)}`)); md.push(""); }
  if (pg.length) { md.push("## ปัญหาที่เจอ (ส่งทีมพัฒนา)", ""); pg.forEach((p) => md.push(`- **${p.n}×** ${mdCell(p.label)}`)); md.push(""); }
  if (admins.length) {
    md.push("## คุณภาพรายแอดมิน", "", "| แอดมิน | เคส | ตอบดี | ปิดจบ | ลูกค้าไม่พอใจ |", "|---|---|---|---|---|");
    for (const a of admins) md.push(`| ${a.name} | ${a.handled} | ${pct(a.helpGood, a.handled)}% | ${pct(a.resolved, a.handled)}% | ${a.upset} |`);
    md.push("");
  }

  // เสียงลูกค้าจริง — เคสที่มีปัญหา/ไม่พอใจก่อน (ยกคำพูดจริง + คำตอบแอดมิน)
  const voices = rows.filter((r) => r.customerSay && (r.problem || r.sentiment === "upset"));
  const voiceList = (voices.length ? voices : rows.filter((r) => r.customerSay)).slice(0, 25);
  if (voiceList.length) {
    md.push("## เสียงลูกค้าจริง + คำตอบแอดมิน", "");
    for (const r of voiceList) {
      md.push(`- **${mdCell(r.customer || "-")}** (${SERVICE_LABEL[r.service || ""] || "-"} · ${r.bizDate}) — [เปิดแชท](${roomLink(r.convId)})`);
      md.push(`  - ลูกค้า: “${mdCell(r.customerSay || "")}”`);
      if (r.adminSay) md.push(`  - แอดมิน (${mdCell(r.admin || "-")}): “${mdCell(r.adminSay)}”`);
      md.push(`  - ${r.resolved ? "✅ จบแล้ว" : "⏳ ยังไม่จบ"} · ${SENT_LABEL[r.sentiment || "neutral"] || ""}`);
      md.push("");
    }
  }

  // เคสที่ยังไม่จบ (ต้องตามต่อ) พร้อมลิงก์
  const followUps = rows.filter((r) => r.resolved === false);
  if (followUps.length) {
    md.push("## เคสที่ต้องตามต่อ (ยังไม่จบ)", "", "| วันที่ | ลูกค้า | บริการ | เรื่อง | ผู้ดูแล | ลิงก์ |", "|---|---|---|---|---|---|");
    for (const f of followUps.slice(0, 60)) md.push(`| ${f.bizDate} | ${mdCell(f.customer || "-")} | ${SERVICE_LABEL[f.service || ""] || f.service || "-"} | ${mdCell(f.question || f.summary || "-")} | ${mdCell(f.admin || "-")} | [เปิด](${roomLink(f.convId)}) |`);
    md.push("");
  }

  // รายเคสทั้งหมด + ลิงก์แชท
  md.push("## รายเคสทั้งหมด", "", "| # | วันที่ | บริการ | ลูกค้า | แอดมิน | หมวด | จบ | สรุป | ลิงก์ |", "|---|---|---|---|---|---|---|---|---|");
  rows.forEach((r, i) => md.push(`| ${i + 1} | ${r.bizDate} | ${SERVICE_LABEL[r.service || ""] || r.service || "-"} | ${mdCell(r.customer || "-")} | ${mdCell(r.admin || "-")} | ${r.topic || "-"} | ${r.resolved ? "✅" : "⏳"} | ${mdCell(r.summary || "")} | [เปิด](${roomLink(r.convId)}) |`));
  md.push("");
  md.push("---", `_Thunder · น้องวาน · รายงานช่วง ${label}_`);

  // เพิ่มตัวอย่างเสียงลูกค้าในข้อความย่อด้วย (2 เคส)
  if (voiceList.length) {
    s.push("", "<b>เสียงลูกค้า (ตัวอย่าง)</b>");
    for (const r of voiceList.slice(0, 2)) s.push(`  🗣 “${(r.customerSay || "").slice(0, 80)}”`);
  }

  return { short: noLoneSurrogate(s.join("\n")), markdown: noLoneSurrogate(md.join("\n")), count: rows.length };
}

export async function buildDailyReport(bizDate: string): Promise<{ stats: DailyStats; messages: string[]; markdown: string; html: string }> {
  const rows = await db.chatLog.findMany({ where: { bizDate, analyzed: true }, orderBy: { createdAt: "asc" } });
  const rawCount = await db.chatLog.count({ where: { bizDate } });

  // รายงานรอบเช้า 06:00 = ข้อมูลของ "เมื่อวาน" — แต่ถ้าสั่งดูของวันปัจจุบันต้องพูดว่า "วันนี้"
  const todayBiz = bizDateOf();
  const dayWord = bizDate === todayBiz ? "วันนี้" : bizDate === prevBizDate(todayBiz) ? "เมื่อวาน" : bizDateLabel(bizDate);

  // ---------- รวมสถิติพื้นฐาน ----------
  const byService: Record<string, number> = {};
  const byTopic: Record<string, number> = {};
  const adminMap: Record<string, AdminStat> = {};
  const custCount: Record<string, number> = {};
  const hourCount: Record<number, number> = {};
  const questions: string[] = [];
  const problems: string[] = [];
  let renew = 0, install = 0, issues = 0, resolvedYes = 0, resolvedKnown = 0;
  let hG = 0, hO = 0, hP = 0, tG = 0, tO = 0, tP = 0;
  const sentiment = { happy: 0, neutral: 0, upset: 0 };

  for (const r of rows) {
    byService[r.service || "อื่นๆ"] = (byService[r.service || "อื่นๆ"] || 0) + 1;
    if (r.topic) byTopic[r.topic] = (byTopic[r.topic] || 0) + 1;
    if (r.intent === "renew") renew++;
    if (r.intent === "install") install++;
    if (r.intent === "issue") issues++;
    if (r.resolved !== null) { resolvedKnown++; if (r.resolved) resolvedYes++; }
    if (r.question) questions.push(r.question);
    if (r.problem) problems.push(r.problem);
    if (r.adminHelp === "good") hG++; else if (r.adminHelp === "ok") hO++; else if (r.adminHelp === "poor") hP++;
    if (r.adminTone === "good") tG++; else if (r.adminTone === "ok") tO++; else if (r.adminTone === "poor") tP++;
    if (r.sentiment === "happy") sentiment.happy++; else if (r.sentiment === "upset") sentiment.upset++; else sentiment.neutral++;
    if (r.customer) custCount[r.customer] = (custCount[r.customer] || 0) + 1;
    const h = new Date(r.createdAt.getTime() + 7 * 3600_000).getUTCHours();
    hourCount[h] = (hourCount[h] || 0) + 1;

    const name = (r.admin || "").trim();
    if (name) {
      const a = (adminMap[name] ||= { name, handled: 0, helpGood: 0, helpOk: 0, helpPoor: 0, toneGood: 0, tonePoor: 0, resolved: 0, upset: 0 });
      a.handled++;
      if (r.adminHelp === "good") a.helpGood++; else if (r.adminHelp === "ok") a.helpOk++; else if (r.adminHelp === "poor") a.helpPoor++;
      if (r.adminTone === "good") a.toneGood++; else if (r.adminTone === "poor") a.tonePoor++;
      if (r.resolved) a.resolved++;
      if (r.sentiment === "upset") a.upset++;
    }
  }

  // ---------- จัดกลุ่มด้วยความหมาย (แก้ปัญหานับซ้ำแยกกัน) ----------
  const qClusters = await clusterTexts(questions);
  const pClusters = await clusterTexts(problems);
  const questionGroups = qClusters.slice(0, 10).map((c) => ({ label: c.label, n: c.n }));
  const problemGroups = pClusters.slice(0, 10).map((c) => ({ label: c.label, n: c.n }));

  // ---------- เคสต้องตามต่อ ----------
  const followUps = rows
    .filter((r) => r.resolved === false)
    .slice(0, 15)
    .map((r) => ({ convId: r.convId, customer: r.customer || "-", service: SERVICE_LABEL[r.service || ""] || r.service || "-", question: r.question || r.summary || "-", admin: r.admin || "-" }));

  // ---------- ข้อมูลมอนิเตอร์ของวันนั้น ----------
  const { startMs, endMs } = bizDateRange(bizDate);
  const monRange: RangeSpec = { sinceMs: startMs, untilMs: endMs, label: bizDate };
  const monRows = await db.botActivity.findMany({
    where: { kind: { in: ["waiting-alert", "close-remind", "session-expired", "watch-close"] }, createdAt: { gte: new Date(startMs), lt: new Date(endMs) } },
    select: { kind: true, admin: true, waitSec: true },
  });
  const monitor = { dropped: 0, waiting: 0, forgot: 0, handled: 0, forgotByAdmin: [] as { name: string; n: number }[], maxWaitMin: 0 };
  const forgotBy: Record<string, number> = {};
  for (const m of monRows) {
    if (m.kind === "session-expired") monitor.dropped++;
    else if (m.kind === "waiting-alert") { monitor.waiting++; if ((m.waitSec || 0) / 60 > monitor.maxWaitMin) monitor.maxWaitMin = Math.round((m.waitSec || 0) / 60); }
    else if (m.kind === "close-remind") { monitor.forgot++; if (m.admin) forgotBy[m.admin] = (forgotBy[m.admin] || 0) + 1; }
    else if (m.kind === "watch-close") monitor.handled++;
  }
  monitor.forgotByAdmin = Object.entries(forgotBy).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 5);
  void monRange;

  // ---------- เทียบกับวันก่อน ----------
  const prevDate = prevBizDate(bizDate);
  const prev = await db.dailyReport.findUnique({ where: { bizDate: prevDate } });
  let prevCount: number | null = null, diffPct: number | null = null;
  const newProblems: string[] = [];
  if (prev) {
    prevCount = prev.chatCount;
    if (prevCount > 0) diffPct = Math.round(((rows.length - prevCount) / prevCount) * 100);
    try {
      const ps = JSON.parse(prev.stats) as Partial<DailyStats>;
      const old = new Set((ps.problemGroups || []).map((p) => p.label));
      for (const p of problemGroups) if (!old.has(p.label)) newProblems.push(p.label);
    } catch { /* ไม่มีของเก่าก็ข้าม */ }
  }

  // ---------- โอกาสทำ auto-reply (ความถี่ = ผลตอบแทน) ----------
  const autoReplyRoi = questionGroups.slice(0, 5).map((g) => ({ label: g.label, n: g.n, share: pct(g.n, rows.length || 1) }));

  const totalGraded = hG + hO + hP, totalTone = tG + tO + tP;
  const stats: DailyStats = {
    chatCount: rows.length, rawCount, byService, byTopic, renew, install, issues,
    resolvedRate: resolvedKnown ? pct(resolvedYes, resolvedKnown) : null,
    questionGroups, problemGroups,
    admins: Object.values(adminMap).sort((a, b) => b.handled - a.handled),
    helpPct: totalGraded ? { good: pct(hG, totalGraded), ok: pct(hO, totalGraded), poor: pct(hP, totalGraded) } : null,
    tonePct: totalTone ? { good: pct(tG, totalTone), ok: pct(tO, totalTone), poor: pct(tP, totalTone) } : null,
    sentiment,
    peakHours: Object.entries(hourCount).map(([h, n]) => ({ hour: Number(h), n })).sort((a, b) => b.n - a.n).slice(0, 4),
    followUps,
    frequentCustomers: Object.entries(custCount).filter(([, n]) => n >= 2).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 6),
    faqNew: 0, faqDup: 0,
    monitor,
    trend: { prevCount, diffPct, newProblems: newProblems.slice(0, 5) },
    autoReplyRoi,
  };

  // ---------- เก็บคำถาม/ปัญหาใหม่เข้าคลัง ----------
  for (const r of rows) {
    if (!r.question || r.question.length < 8) continue;
    const answerDraft = (r.adminSay || "").trim() || (() => {
      try {
        const msgs = JSON.parse(r.messages) as { side: string; text: string }[];
        const adminMsgs = msgs.filter((m) => m.side === "admin" && m.text.trim().length >= 15);
        return adminMsgs.sort((x, y) => y.text.length - x.text.length)[0]?.text || "";
      } catch { return ""; }
    })();
    if (!answerDraft) continue;
    const res = await captureFaqCandidate(r.question, answerDraft, { scope: r.service || "general", source: `แชท ${bizDate}` });
    if (res.result === "new") stats.faqNew++;
    else if (res.result === "dup") stats.faqDup++;
  }

  // ---------- Claude: เล่าเรื่องวันนี้ + feedback ทีม ----------
  const voiceSample = rows.filter((r) => r.customerSay).slice(0, 12).map((r) => `- (${SERVICE_LABEL[r.service || ""] || "-"}) ลูกค้า: "${r.customerSay}"${r.adminSay ? ` → แอดมิน: "${r.adminSay}"` : ""}`).join("\n");
  const brief = [
    `วัน: ${bizDateLabel(bizDate)} (${dayWord})`,
    `แชททั้งหมด ${rows.length} เคส (${Object.entries(byService).map(([k, v]) => `${SERVICE_LABEL[k] || k} ${v}`).join(", ")})`,
    `ต่ออายุ ${renew} · ติดตั้ง ${install} · ปัญหา ${issues} · ปิดจบ ${stats.resolvedRate ?? "-"}%`,
    `อารมณ์ลูกค้า: พอใจ ${sentiment.happy} · เฉยๆ ${sentiment.neutral} · ไม่พอใจ ${sentiment.upset}`,
    `เรื่องที่ถามบ่อย: ${questionGroups.slice(0, 5).map((g) => `${g.label} (${g.n})`).join(" | ") || "-"}`,
    `ปัญหาที่เจอ: ${problemGroups.slice(0, 6).map((g) => `${g.label} (${g.n})`).join(" | ") || "-"}`,
    `มอนิเตอร์: ระบบเฝ้าหลุด ${monitor.dropped} · แชทค้างไม่มีคนรับ ${monitor.waiting} (รอนานสุด ${monitor.maxWaitMin} นาที) · ลืมปิดแชท ${monitor.forgot}`,
    prevCount !== null ? `เทียบเมื่อวาน: ${prevCount} เคส (${diffPct !== null ? (diffPct >= 0 ? "+" : "") + diffPct + "%" : "-"})` : "",
    stats.helpPct ? `คุณภาพตอบ: ดี ${stats.helpPct.good}% พอใช้ ${stats.helpPct.ok}% ต้องปรับ ${stats.helpPct.poor}%` : "",
    `แอดมิน: ${stats.admins.map((a) => `${a.name} ${a.handled} เคส (ปิดจบ ${pct(a.resolved, a.handled)}%)`).join(", ") || "-"}`,
    voiceSample ? `\nตัวอย่างคำพูดจริง:\n${voiceSample}` : "",
  ].filter(Boolean).join("\n");

  let story = "", feedback = "";
  if (rows.length > 0) {
    try {
      story = await askClaude(
        `คุณคือหัวหน้าทีม Support ที่กำลังเล่าให้ผู้บริหารฟังว่า "${dayWord}เกิดอะไรขึ้นบ้าง"\n\n${brief}\n\n` +
        `สำคัญ: ข้อมูลชุดนี้เป็นของ${dayWord} ให้ใช้คำว่า "${dayWord}" เวลาพูดถึงช่วงเวลานี้ ห้ามเรียกว่า "วันนี้" ถ้าคำที่กำหนดไม่ใช่ "วันนี้"\n` +
        `เขียนเล่าเป็นภาษาคน อ่านง่าย ไม่ต้องมีหัวข้อย่อย ความยาว 4-6 ย่อหน้าสั้นๆ เว้นบรรทัดระหว่างย่อหน้า ` +
        `เนื้อหาต้องครอบคลุม: ${dayWord}งานหนักไหมเทียบกับวันก่อนหน้า, ลูกค้าส่วนใหญ่มาเรื่องอะไร, ` +
        `มีปัญหาอะไรที่น่าห่วง, ทีมรับมือได้ดีแค่ไหน, มีอะไรที่ต้องรีบจัดการ ` +
        `ห้ามใช้ bullet point ห้ามขึ้นหัวข้อ เขียนเป็นย่อหน้าเล่าเรื่องล้วนๆ ห้ามเกริ่นนำแบบ "จากข้อมูล..."`,
        { timeoutMs: 120_000 },
      );
    } catch { story = ""; }

    const weak = rows.filter((r) => r.adminHelp === "poor" || r.adminTone === "poor" || r.sentiment === "upset" || r.resolved === false).slice(0, 10);
    if (weak.length) {
      const weakBrief = weak.map((r) => `- ${r.admin || "ไม่ทราบ"} | ${SERVICE_LABEL[r.service || ""] || "-"} | ลูกค้า: "${r.customerSay || r.question}" | แอดมินตอบ: "${r.adminSay || "-"}" | จบเคส: ${r.resolved ? "จบ" : "ยังไม่จบ"}`).join("\n");
      try {
        feedback = await askClaude(
          `นี่คือเคสที่ควรปรับปรุงของทีม Support ${dayWord}:\n\n${weakBrief}\n\n` +
          `เขียน "คำแนะนำถึงทีม" 3-5 ข้อ ภาษาไทย สุภาพ สร้างสรรค์ (ติเพื่อก่อ ไม่ตำหนิรายบุคคลรุนแรง) ` +
          `แต่ละข้อขึ้นต้นด้วย "- " บอกว่าควรทำอะไรแทน พร้อมตัวอย่างประโยคที่ควรใช้ถ้าเหมาะ ` +
          `ห้ามเขียนหัวข้อหรือคำนำ ตอบเฉพาะรายการ`,
          { timeoutMs: 90_000 },
        );
      } catch { feedback = ""; }
    }
  }

  // ================= ข้อความที่ 1: ผู้บริหาร + เล่าเรื่อง =================
  const m1: string[] = [];
  m1.push(`📋 <b>รายงานแชทประจำวัน</b>`);
  m1.push(`🗓 ${bizDateLabel(bizDate)}`);
  m1.push(LINE);
  m1.push("");
  m1.push("👔 <b>สรุปสำหรับผู้บริหาร</b>");
  m1.push("");
  m1.push(`     • คุยกับลูกค้า <b>${rows.length}</b> เคส${prevCount !== null && diffPct !== null ? `  (เมื่อวาน ${prevCount} · ${diffPct >= 0 ? "▲" : "▼"} ${Math.abs(diffPct)}%)` : ""}`);
  m1.push(`     • ปิดเคสจบได้ <b>${stats.resolvedRate ?? "-"}%</b>`);
  m1.push(`     • เรื่องหลัก: ${questionGroups[0]?.label || "-"}`);
  if (problemGroups.length) m1.push(`     • ปัญหาเด่น: ${problemGroups[0].label} (${problemGroups[0].n} ราย)`);
  m1.push(`     • ลูกค้าไม่พอใจ <b>${sentiment.upset}</b> เคส · เคสค้างต้องตาม <b>${followUps.length}</b> เคส`);
  m1.push("");
  if (story) {
    m1.push(LINE);
    m1.push("");
    m1.push(`📖 <b>${dayWord}เกิดอะไรขึ้นบ้าง</b>`);
    m1.push("");
    for (const para of story.trim().split(/\n\s*\n/)) { m1.push(esc(para.trim())); m1.push(""); }
  }

  // ================= ข้อความที่ 2: ตัวเลข + มอนิเตอร์ =================
  const m2: string[] = [];
  m2.push("📊 <b>ตัวเลขของวัน</b>");
  m2.push("");
  m2.push("🏷 <b>แยกตามบริการ</b>");
  m2.push("");
  for (const [k, v] of Object.entries(byService).sort((a, b) => b[1] - a[1])) m2.push(`     ▸ ${SERVICE_LABEL[k] || k}  —  <b>${v}</b> เคส`);
  m2.push("");
  m2.push("📌 <b>ลูกค้าติดต่อมาเรื่องอะไร</b>");
  m2.push("");
  for (const [k, v] of Object.entries(byTopic).sort((a, b) => b[1] - a[1])) m2.push(`     ▸ ${k}  —  <b>${v}</b> ราย`);
  m2.push("");
  m2.push(`     🔁 ต่ออายุ <b>${renew}</b>  ·  🛠 ติดตั้ง <b>${install}</b>  ·  ⚠️ ปัญหา <b>${issues}</b>`);
  m2.push("");
  m2.push("😊 <b>อารมณ์ลูกค้า</b>");
  m2.push("");
  m2.push(`     พอใจ ${sentiment.happy}  ·  เฉยๆ ${sentiment.neutral}  ·  <b>ไม่พอใจ ${sentiment.upset}</b>`);
  m2.push("");
  if (stats.peakHours.length) {
    m2.push("⏰ <b>ช่วงเวลาที่แชทเข้าเยอะ</b>");
    m2.push("");
    for (const p of stats.peakHours) m2.push(`     ${String(p.hour).padStart(2, "0")}:00 - ${String((p.hour + 1) % 24).padStart(2, "0")}:00  —  ${p.n} เคส`);
    m2.push("");
  }
  m2.push(LINE);
  m2.push("");
  m2.push("🖥 <b>จากห้องมอนิเตอร์แชท</b>");
  m2.push("");
  m2.push(`     🔴 ระบบเฝ้าหลุด  —  <b>${monitor.dropped}</b> ครั้ง`);
  m2.push(`     🟠 แชทค้างไม่มีคนรับ  —  <b>${monitor.waiting}</b> ครั้ง${monitor.maxWaitMin ? `  (รอนานสุด ${monitor.maxWaitMin} นาที)` : ""}`);
  m2.push(`     🟡 ลืมปิดแชท  —  <b>${monitor.forgot}</b> ครั้ง`);
  m2.push(`     🟢 รับเคส/ดูแล  —  ${monitor.handled} ครั้ง`);
  if (monitor.forgotByAdmin.length) {
    m2.push("");
    m2.push("     <i>ลืมปิดบ่อยสุด</i>");
    for (const f of monitor.forgotByAdmin) m2.push(`     · ${f.name}  ${f.n} ครั้ง`);
  }
  m2.push("");
  if (stats.trend.newProblems.length) {
    m2.push(`🆕 <b>ปัญหาใหม่ที่เพิ่งเจอ${dayWord}</b>`);
    m2.push("");
    for (const p of stats.trend.newProblems) m2.push(`     • ${esc(p)}`);
    m2.push("");
  }

  // ================= ข้อความที่ 3: ปัญหา + เสียงลูกค้า + เคสค้าง =================
  const m3: string[] = [];
  m3.push("🐞 <b>ลูกค้าแจ้งปัญหาอะไรมาบ้าง</b>");
  m3.push("");
  if (problemGroups.length) {
    problemGroups.slice(0, 6).forEach((p, i) => {
      m3.push(`     ${i + 1}. ${esc(p.label)}`);
      m3.push(`         <i>เจอ ${p.n} ราย</i>`);
    });
  } else m3.push(`     <i>ไม่มีปัญหาระบบที่ลูกค้าแจ้งมา${dayWord}</i>`);
  m3.push("");
  m3.push("💬 <b>เสียงลูกค้าจริง (ตัวอย่าง)</b>");
  m3.push("");
  const voices = rows.filter((r) => r.customerSay && (r.problem || r.sentiment === "upset")).slice(0, 4);
  const voicesFallback = voices.length ? voices : rows.filter((r) => r.customerSay).slice(0, 4);
  for (const v of voicesFallback) {
    m3.push(`     🗣 “${esc((v.customerSay || "").slice(0, 160))}”`);
    if (v.adminSay) m3.push(`     ↳ แอดมิน: “${esc(v.adminSay.slice(0, 160))}”`);
    m3.push(`         <i>${SERVICE_LABEL[v.service || ""] || "-"} · ${v.admin || "ไม่ทราบผู้ดูแล"} · ${v.resolved ? "จบแล้ว" : "ยังไม่จบ"}</i>`);
    m3.push("");
  }
  m3.push("❓ <b>เรื่องที่ถามซ้ำบ่อยสุด</b>  <i>(จัดกลุ่มตามความหมาย)</i>");
  m3.push("");
  questionGroups.slice(0, 5).forEach((q, i) => {
    m3.push(`     ${i + 1}. ${esc(q.label)}`);
    m3.push(`         <i>${q.n} ราย (${pct(q.n, rows.length || 1)}% ของวัน)</i>`);
  });
  m3.push("");
  if (followUps.length) {
    m3.push("📌 <b>เคสที่ต้องตามต่อ (ยังไม่จบ)</b>");
    m3.push("");
    for (const f of followUps.slice(0, 8)) {
      m3.push(`     • ${esc(f.customer)} — ${f.service}`);
      m3.push(`         ${esc(f.question.slice(0, 90))}  <i>(${f.admin})</i>`);
    }
    m3.push("");
    m3.push("     <i>ดูลิงก์ทุกเคสได้ในไฟล์แนบ</i>");
    m3.push("");
  }

  // ================= ข้อความที่ 4: ทีม + ข้อเสนอ =================
  const m4: string[] = [];
  m4.push("👤 <b>ทีมแอดมิน</b>");
  m4.push("");
  for (const a of stats.admins) {
    m4.push(`     <b>${esc(a.name)}</b>  —  ${a.handled} เคส`);
    m4.push(`         ตอบดี ${pct(a.helpGood, a.handled)}%  ·  ปิดจบ ${pct(a.resolved, a.handled)}%${a.helpPoor ? `  ·  ต้องปรับ ${a.helpPoor} เคส` : ""}${a.upset ? `  ·  ลูกค้าไม่พอใจ ${a.upset}` : ""}`);
  }
  m4.push("");
  if (stats.helpPct && stats.tonePct) {
    m4.push("🎯 <b>คุณภาพรวมของทีม</b>");
    m4.push("");
    m4.push(`     ช่วยเหลือตรงจุด  —  ดี ${stats.helpPct.good}% · พอใช้ ${stats.helpPct.ok}% · ต้องปรับ ${stats.helpPct.poor}%`);
    m4.push(`     น้ำเสียง/สุภาพ  —  ดี ${stats.tonePct.good}% · พอใช้ ${stats.tonePct.ok}% · ต้องปรับ ${stats.tonePct.poor}%`);
    m4.push("");
  }
  if (feedback) {
    m4.push("🗣 <b>คำแนะนำถึงทีม</b>");
    m4.push("");
    for (const l of feedback.trim().split("\n").filter((x) => x.trim())) { m4.push(`${esc(l.trim().replace(/^-\s*/, "     ▪️ "))}`); m4.push(""); }
  }
  if (autoReplyRoi.length) {
    m4.push("💰 <b>ควรทำ auto-reply เรื่องไหนก่อน</b>");
    m4.push("");
    autoReplyRoi.forEach((a, i) => m4.push(`     ${i + 1}. ${esc(a.label)}  —  ${a.n} ราย (${a.share}% ของวัน)`));
    m4.push("");
  }
  if (stats.frequentCustomers.length) {
    m4.push("👥 <b>ลูกค้าที่ทักบ่อยผิดปกติ</b>  <i>(อาจมีปัญหาเรื้อรัง)</i>");
    m4.push("");
    for (const c of stats.frequentCustomers) m4.push(`     • ${esc(c.name)}  —  ${c.n} ครั้ง`);
    m4.push("");
  }
  m4.push(`📚 เก็บความรู้ใหม่ <b>${stats.faqNew}</b> เรื่อง  (เรื่องเดิมนับซ้ำ ${stats.faqDup})`);
  m4.push("");
  m4.push(LINE);
  m4.push("<i>📎 ไฟล์แนบมีครบทุกเคส + ลิงก์แชท + ภาพหน้าจอเคสเด่น</i>");

  // ================= ไฟล์ Markdown =================
  const highlights = rows.filter((r) => r.highlight);
  const md: string[] = [];
  md.push(`# รายงานแชทประจำวัน · ${bizDateLabel(bizDate)}`);
  md.push("");
  md.push(`> คุยกับลูกค้า **${rows.length}** เคส · ปิดจบ **${stats.resolvedRate ?? "-"}%** · ลูกค้าไม่พอใจ **${sentiment.upset}** เคส`);
  md.push("");
  if (story) { md.push(`## ${dayWord}เกิดอะไรขึ้นบ้าง`); md.push(""); md.push(story.trim()); md.push(""); }

  md.push("## สรุปตัวเลข");
  md.push("");
  md.push("| รายการ | จำนวน |");
  md.push("|---|---|");
  md.push(`| แชททั้งหมด | ${rows.length} |`);
  if (prevCount !== null) md.push(`| เมื่อวาน | ${prevCount} (${diffPct !== null ? (diffPct >= 0 ? "+" : "") + diffPct + "%" : "-"}) |`);
  md.push(`| ต่ออายุ | ${renew} |`);
  md.push(`| ติดตั้ง | ${install} |`);
  md.push(`| ปัญหาใช้งาน | ${issues} |`);
  md.push(`| ปิดเคสจบ | ${stats.resolvedRate ?? "-"}% |`);
  md.push(`| ลูกค้าไม่พอใจ | ${sentiment.upset} |`);
  md.push("");
  md.push("### แยกตามบริการ");
  md.push("");
  md.push("| บริการ | เคส |");
  md.push("|---|---|");
  for (const [k, v] of Object.entries(byService).sort((a, b) => b[1] - a[1])) md.push(`| ${SERVICE_LABEL[k] || k} | ${v} |`);
  md.push("");
  md.push("### ห้องมอนิเตอร์แชท");
  md.push("");
  md.push("| เหตุการณ์ | จำนวน |");
  md.push("|---|---|");
  md.push(`| ระบบเฝ้าหลุด (session) | ${monitor.dropped} |`);
  md.push(`| แชทค้างไม่มีคนรับ | ${monitor.waiting} |`);
  md.push(`| ลืมปิดแชท | ${monitor.forgot} |`);
  md.push(`| รับเคส/ดูแล | ${monitor.handled} |`);
  md.push(`| ลูกค้ารอนานสุด | ${monitor.maxWaitMin} นาที |`);
  md.push("");
  if (monitor.forgotByAdmin.length) {
    md.push("**ลืมปิดแชทบ่อยสุด:** " + monitor.forgotByAdmin.map((f) => `${f.name} (${f.n})`).join(" · "));
    md.push("");
  }
  if (stats.peakHours.length) {
    md.push("### ช่วงเวลาที่แชทเข้าเยอะ");
    md.push("");
    md.push("| ช่วงเวลา | เคส |");
    md.push("|---|---|");
    for (const p of stats.peakHours) md.push(`| ${String(p.hour).padStart(2, "0")}:00-${String((p.hour + 1) % 24).padStart(2, "0")}:00 | ${p.n} |`);
    md.push("");
  }

  md.push("## ลูกค้าแจ้งปัญหาอะไรมา");
  md.push("");
  if (problemGroups.length) {
    md.push("| ปัญหา | จำนวนราย |");
    md.push("|---|---|");
    for (const p of problemGroups) md.push(`| ${mdCell(p.label)} | ${p.n} |`);
  } else md.push(`_ไม่มีปัญหาระบบที่ลูกค้าแจ้ง${dayWord}_`);
  md.push("");
  if (stats.trend.newProblems.length) {
    md.push("**🆕 ปัญหาใหม่ที่ไม่เคยเจอเมื่อวาน:**");
    md.push("");
    for (const p of stats.trend.newProblems) md.push(`- ${p}`);
    md.push("");
  }

  md.push("## เรื่องที่ลูกค้าถามซ้ำบ่อย (จัดกลุ่มตามความหมาย)");
  md.push("");
  md.push("| เรื่อง | ราย | % ของวัน |");
  md.push("|---|---|---|");
  for (const q of questionGroups) md.push(`| ${mdCell(q.label)} | ${q.n} | ${pct(q.n, rows.length || 1)}% |`);
  md.push("");

  md.push("## เสียงลูกค้า + คำตอบแอดมิน (ทุกเคสที่มีคำพูดชัด)");
  md.push("");
  for (const r of rows.filter((x) => x.customerSay).slice(0, 40)) {
    md.push(`- **${mdCell(r.customer || "-")}** (${SERVICE_LABEL[r.service || ""] || "-"}) — [เปิดแชท](${roomLink(r.convId)})`);
    md.push(`  - ลูกค้า: “${mdCell(r.customerSay || "")}”`);
    if (r.adminSay) md.push(`  - แอดมิน (${mdCell(r.admin || "-")}): “${mdCell(r.adminSay)}”`);
    md.push(`  - ${r.resolved ? "✅ จบแล้ว" : "⏳ ยังไม่จบ"} · ${SENT_LABEL[r.sentiment || "neutral"] || ""}`);
    md.push("");
  }

  if (followUps.length) {
    md.push("## เคสที่ต้องตามต่อ (ยังไม่จบ)");
    md.push("");
    md.push("| ลูกค้า | บริการ | เรื่อง | ผู้ดูแล | ลิงก์ |");
    md.push("|---|---|---|---|---|");
    for (const f of followUps) md.push(`| ${mdCell(f.customer)} | ${f.service} | ${mdCell(f.question)} | ${mdCell(f.admin)} | [เปิด](${roomLink(f.convId)}) |`);
    md.push("");
  }

  md.push("## ทีมแอดมิน");
  md.push("");
  md.push("| แอดมิน | เคส | ตอบดี | น้ำเสียงดี | ปิดจบ | ต้องปรับ | ลูกค้าไม่พอใจ |");
  md.push("|---|---|---|---|---|---|---|");
  for (const a of stats.admins) {
    md.push(`| ${a.name} | ${a.handled} | ${pct(a.helpGood, a.handled)}% | ${pct(a.toneGood, a.handled)}% | ${pct(a.resolved, a.handled)}% | ${a.helpPoor} | ${a.upset} |`);
  }
  md.push("");
  if (feedback) { md.push("### คำแนะนำถึงทีม"); md.push(""); md.push(feedback.trim()); md.push(""); }

  // ---- เคสเด่น + ภาพหน้าจอ ----
  if (highlights.length) {
    md.push("## เคสเด่นที่ควรดู (พร้อมภาพหน้าจอ)");
    md.push("");
    for (const h of highlights) {
      md.push(`### ${mdCell(h.customer || "-")} — ${SERVICE_LABEL[h.service || ""] || h.service || "-"}`);
      md.push("");
      md.push(`- 🔗 **[เปิดแชทนี้ใน OHO](${roomLink(h.convId)})**`);
      md.push(`- ผู้ดูแล: ${mdCell(h.admin || "-")} · ${h.resolved ? "จบแล้ว" : "**ยังไม่จบ**"} · ${SENT_LABEL[h.sentiment || "neutral"] || ""}`);
      if (h.problem) md.push(`- ปัญหา: ${mdCell(h.problem)}`);
      if (h.customerSay) md.push(`- ลูกค้า: “${mdCell(h.customerSay)}”`);
      if (h.adminSay) md.push(`- แอดมิน: “${mdCell(h.adminSay)}”`);
      md.push("");
      // ใส่เป็น placeholder ก่อน — ไฟล์ .md จะแทนด้วยข้อความ (base64 ยาวมากจนอ่านไม่ได้ถ้าโปรแกรมไม่ render)
      // ส่วนไฟล์ .html จะแทนด้วยรูปจริง
      if (h.shotPath && fs.existsSync(h.shotPath)) { md.push(`[[SHOT:${h.convId}]]`); md.push(""); }
    }
  }

  md.push("## รายเคสทั้งหมด");
  md.push("");
  md.push("| # | บริการ | ลูกค้า | แอดมิน | หมวด | จบ | สรุป | ลิงก์ |");
  md.push("|---|---|---|---|---|---|---|---|");
  rows.forEach((r, i) => {
    md.push(`| ${i + 1} | ${SERVICE_LABEL[r.service || ""] || r.service || "-"} | ${mdCell(r.customer || "-")} | ${mdCell(r.admin || "-")} | ${r.topic || "-"} | ${r.resolved ? "✅" : "⏳"} | ${mdCell(r.summary || "")} | [เปิด](${roomLink(r.convId)}) |`);
  });
  md.push("");
  md.push("---");
  md.push(`_Thunder · น้องวาน · วิเคราะห์ในเครื่อง (Typhoon) + เรียบเรียงโดย Claude_`);

  const rawMd = md.join("\n");
  const shots = new Map<string, string>();
  for (const h of highlights) {
    if (h.shotPath && fs.existsSync(h.shotPath)) {
      try { shots.set(h.convId, fs.readFileSync(h.shotPath).toString("base64")); } catch { /* ข้าม */ }
    }
  }
  // .md = สะอาด อ่านเป็นข้อความได้ (ไม่ยัด base64)  ·  .html = เห็นภาพจริง
  const markdown = rawMd.replace(/\[\[SHOT:([a-z0-9]+)\]\]/gi, (_m, id) =>
    shots.has(id) ? `> 📸 _ภาพหน้าจอแชทนี้อยู่ในไฟล์ HTML (เปิดในเบราว์เซอร์เพื่อดูภาพ)_` : "");
  const html = renderHtml(rawMd, shots, bizDateLabel(bizDate));

  // กรอง lone surrogate ครั้งสุดท้ายที่ทุก output (กันพลาดจากจุดที่ไม่ผ่าน esc/mdCell เช่น story/feedback ของ Claude)
  const outMsgs = [m1.join("\n"), m2.join("\n"), m3.join("\n"), m4.join("\n")].map(noLoneSurrogate).filter((m) => m.trim().length > 20);
  return { stats, messages: outMsgs, markdown: noLoneSurrogate(markdown), html: noLoneSurrogate(html) };
}

// ---------- แปลง Markdown → HTML (พอสำหรับรายงานนี้: หัวข้อ/ตาราง/ลิสต์/ลิงก์/บล็อกอ้าง) ----------
function renderHtml(mdSrc: string, shots: Map<string, string>, dateLabel: string): string {
  const esc2 = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc2(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/_([^_\n]+)_/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  const out: string[] = [];
  const lines = mdSrc.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const shot = line.match(/^\[\[SHOT:([a-z0-9]+)\]\]$/i);
    if (shot) {
      const b64 = shots.get(shot[1]);
      if (b64) out.push(`<img class="shot" src="data:image/jpeg;base64,${b64}" alt="หน้าจอแชท"/>`);
      i++; continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const lv = h[1].length; out.push(`<h${lv}>${inline(h[2])}</h${lv}>`); i++; continue; }
    if (/^>\s?/.test(line)) { out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`); i++; continue; }
    if (/^---+$/.test(line)) { out.push("<hr/>"); i++; continue; }
    // ตาราง
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1])) {
      const head = line.split("|").slice(1, -1).map((c) => c.trim());
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) { body.push(lines[i].split("|").slice(1, -1).map((c) => c.trim())); i++; }
      out.push(`<div class="tw"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    // ลิสต์ (รองรับย่อย 1 ระดับ)
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const indent = (lines[i].match(/^\s*/) || [""])[0].length;
        items.push(`<li class="${indent >= 2 ? "sub" : ""}">${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (line.trim() === "") { i++; continue; }
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }

  return `<!doctype html><html lang="th"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>รายงานแชทประจำวัน · ${esc2(dateLabel)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system,"Noto Sans Thai","Sarabun",Helvetica,Arial,sans-serif; line-height:1.75;
         max-width: 880px; margin: 0 auto; padding: 28px 20px 80px; background:#fff; color:#1a1a1a; }
  h1 { font-size:28px; border-bottom:3px solid #4b78ff; padding-bottom:10px; }
  h2 { font-size:21px; margin-top:38px; color:#1b3a8f; border-left:5px solid #4b78ff; padding-left:10px; }
  h3 { font-size:17px; margin-top:26px; color:#333; }
  blockquote { background:#f3f6ff; border-left:4px solid #4b78ff; margin:14px 0; padding:10px 14px; border-radius:6px; }
  table { border-collapse:collapse; width:100%; margin:12px 0; font-size:14.5px; }
  th,td { border:1px solid #dde1e8; padding:7px 10px; text-align:left; vertical-align:top; }
  th { background:#f5f7fb; font-weight:700; }
  tr:nth-child(even) td { background:#fafbfd; }
  .tw { overflow-x:auto; }
  ul { padding-left:22px; } li { margin:5px 0; } li.sub { list-style:circle; margin-left:14px; }
  a { color:#2456d6; }
  .shot { max-width:100%; border:1px solid #d8dce4; border-radius:10px; margin:12px 0 26px;
          box-shadow:0 3px 14px rgba(0,0,0,.10); display:block; }
  hr { border:0; border-top:1px solid #e3e6ec; margin:28px 0; }
  @media (prefers-color-scheme: dark) {
    body { background:#15181d; color:#e6e9ee; }
    h2 { color:#8fb0ff; } th { background:#20242c; } td,th { border-color:#2c313a; }
    tr:nth-child(even) td { background:#1a1e25; } blockquote { background:#1c222f; }
    .shot { border-color:#2c313a; } a { color:#7ea6ff; }
  }
</style></head><body>
${out.join("\n")}
</body></html>`;
}

// เฟส 1: วิเคราะห์ + เติมแอดมิน + คัดเคสเด่น (ให้สคริปต์ไปแคปภาพ)
export async function analyzePhase(bizDate: string): Promise<{ analyzed: number; highlights: { convId: string; reason: string }[] }> {
  const { analyzePendingChats } = await import("@/lib/chat-analyze");
  const r = await analyzePendingChats(bizDate);
  await backfillAdmins(bizDate);
  const highlights = await pickHighlights(bizDate);
  return { analyzed: r.done, highlights };
}

// เฟส 2: สร้าง+เก็บรายงาน (หลังมีภาพแล้ว)
export async function generateAndSaveDailyReport(bizDate: string): Promise<{ messages: string[]; markdown: string; html: string; chatCount: number }> {
  const { stats, messages, markdown, html } = await buildDailyReport(bizDate);
  await db.dailyReport.upsert({
    where: { bizDate },
    update: { chatCount: stats.chatCount, stats: noLoneSurrogate(JSON.stringify(stats)), markdown, shortText: noLoneSurrogate(JSON.stringify(messages)) },
    create: { bizDate, chatCount: stats.chatCount, stats: noLoneSurrogate(JSON.stringify(stats)), markdown, shortText: noLoneSurrogate(JSON.stringify(messages)) },
  });
  return { messages, markdown, html, chatCount: stats.chatCount };
}

// ลบบทสนทนาดิบ + ภาพ ที่เก่ากว่า 90 วัน (PDPA)
export async function purgeOldChatLogs(days = 90): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86400_000);
  const old = await db.chatLog.findMany({ where: { createdAt: { lt: cutoff }, shotPath: { not: null } }, select: { shotPath: true } });
  for (const o of old) { try { if (o.shotPath) fs.unlinkSync(o.shotPath); } catch { /* ลบไม่ได้ก็ข้าม */ } }
  const r = await db.chatLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return r.count;
}
