import { NextResponse } from "next/server";
import { isServiceRequest } from "@/lib/auth";
import { getAllowedChatId, getAllowedGroups, getManagerSigner } from "@/lib/telegram";
import { isOwner, isAuthorized } from "@/lib/team";
import { decideDocument } from "@/lib/documents";
import { setGroupFunc, getGroupFunc, GROUP_FUNCS, isGroupFunc, setTopicRole, ROLES, isRoleId, setOhoAlertChat } from "@/lib/roles";
import { readUsage, formatMonitorCard, monitorCardHtml } from "@/lib/usage";
import { renderHtmlToPng } from "@/lib/html-pdf";
import { executeExpiry } from "@/lib/thunder-expiry";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const maxDuration = 240; // automation Thunder ใช้เวลานาน

function escH(s: string): string {
  return String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

// รับ callback จากปุ่ม inline ของ Telegram (อนุมัติ/ไม่อนุมัติเอกสาร)
export async function POST(req: Request) {
  if (!isServiceRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = String(body.chatId || "");
  const fromId = String(body.fromId || "");
  const fromName = String(body.fromName || "");
  const dataStr = String(body.data || "");

  // อนุญาตให้ตรงกับตอน "ออกเอกสาร": ผู้กดเป็นเจ้าของ/ทีมที่อนุญาต หรือแชทที่ผูก/กลุ่มที่อนุญาต
  const allowed = await getAllowedChatId();
  const chatOk = !allowed || chatId === allowed || (await getAllowedGroups()).includes(chatId);
  const userOk = fromId ? (await isOwner(fromId)) || (await isAuthorized(fromId)) : false;
  if (!chatOk && !userOk) {
    return NextResponse.json({ answer: "ไม่ได้รับอนุญาต", sends: [] });
  }

  // ปุ่มเลือกหน้าที่ของกลุ่ม (gfunc:<id>[:<targetChatId>]) — เจ้าของเท่านั้น
  const gf = dataStr.match(/^gfunc:([a-z_]+)(?::(-?\d+))?$/);
  if (gf) {
    if (!(await isOwner(fromId))) return NextResponse.json({ answer: "เฉพาะเจ้าของค่ะ", sends: [] });
    const fn = gf[1];
    const targetChatId = gf[2] || chatId; // กลุ่มที่จะตั้งค่า (ฝังมาในปุ่ม) ไม่มี = กลุ่มที่กดปุ่ม
    if (!isGroupFunc(fn)) return NextResponse.json({ answer: "หน้าที่ไม่ถูกต้อง", sends: [] });
    await setGroupFunc(targetChatId, fn);
    const p = GROUP_FUNCS[fn];
    const extra =
      fn === "agent"
        ? "\nกลุ่มนี้เป็นทีม agent — สร้าง topic แล้วพิมพ์ในแต่ละห้องว่า \"ตั้งห้องนี้เป็น lead/po/pm/research/monitor\" ได้เลยค่ะ"
        : fn === "aff"
          ? "\nพร้อมตรวจเอกสาร AFF แล้ว ถ้าอยากให้แท็กใครตอนตรวจเสร็จ พิมพ์ \"ตรวจเสร็จให้แท็ก @ชื่อ\" ได้เลยค่ะ"
          : "";
    return NextResponse.json({
      answer: `ตั้งเป็น ${p.label} แล้ว`,
      sends: [{ kind: "text", text: `รับทราบค่ะ ตั้งกลุ่มนี้เป็น "${p.label}" ${p.emoji} เรียบร้อยแล้วค่ะ${extra}` }],
    });
  }

  // ปุ่มตั้ง "บทบาทห้อง" ให้ทั้งกลุ่มโดยตรง (setrole:<role>:<targetChatId>) — เช่น ตั้งกลุ่มเป็นห้อง Usage Monitor
  const sr = dataStr.match(/^setrole:([a-z]+)(?::(-?\d+))?$/);
  if (sr) {
    if (!(await isOwner(fromId))) return NextResponse.json({ answer: "เฉพาะเจ้าของค่ะ", sends: [] });
    const role = sr[1];
    const targetChatId = sr[2] || chatId;
    if (!isRoleId(role)) return NextResponse.json({ answer: "บทบาทไม่ถูกต้อง", sends: [] });
    await setTopicRole(targetChatId, "", role); // "" = ทั้งกลุ่ม (ไม่ผูก topic เฉพาะ)
    const p = ROLES[role];

    // เฉพาะ monitor: เปิดใช้งานทันที + โพสต์การ์ดตัวอย่างเข้ากลุ่มเป้าหมายเลย
    const sends: {
      kind: "text" | "photo";
      text?: string;
      dataBase64?: string;
      caption?: string;
      filename?: string;
      chatId?: string;
    }[] = [];
    if (role === "monitor") {
      const mins = Number(process.env.USAGE_MONITOR_MINUTES || 60);
      sends.push({
        kind: "text",
        text: `รับทราบค่ะ ตั้งกลุ่มนี้เป็นห้อง "Usage Monitor" ${p.emoji} เรียบร้อยแล้วค่ะ\nจะโพสต์การ์ดสรุปการใช้งาน token (Claude/Codex) เข้าห้องนี้อัตโนมัติทุก ${mins} นาทีค่ะ`,
      });
      // โพสต์การ์ดทันที (best-effort) เพื่อยืนยันว่าเปิดฟีเจอร์แล้ว
      try {
        const now = Date.now();
        const usages = readUsage(now);
        const nowLabel = new Date(now).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
        const png = await renderHtmlToPng(monitorCardHtml(usages, nowLabel, now), { width: 720, height: 40 });
        sends.push({ kind: "photo", dataBase64: png.toString("base64"), filename: "usage-monitor.png", chatId: targetChatId });
      } catch {
        // เรนเดอร์ไม่ได้ → ส่งเป็นข้อความสำรองเข้ากลุ่มเป้าหมาย
        const now = Date.now();
        const nowLabel = new Date(now).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
        const { text } = formatMonitorCard(readUsage(now), nowLabel);
        sends.push({ kind: "text", text, chatId: targetChatId });
      }
    } else {
      sends.push({ kind: "text", text: `รับทราบค่ะ ตั้งกลุ่มนี้เป็นห้อง "${p.label}" ${p.emoji} เรียบร้อยแล้วค่ะ` });
    }
    return NextResponse.json({ answer: `ตั้งเป็น ${p.label} แล้ว`, sends });
  }

  // ปุ่มตั้งกลุ่มเป็นห้อง "มอนิเตอร์แชท OHO" (ohomon:<targetChatId>) — เตือนแชทค้าง + แท็กเวร
  const om = dataStr.match(/^ohomon(?::(-?\d+))?$/);
  if (om) {
    if (!(await isOwner(fromId))) return NextResponse.json({ answer: "เฉพาะเจ้าของค่ะ", sends: [] });
    const targetChatId = om[1] || chatId;
    await setOhoAlertChat(targetChatId);
    return NextResponse.json({
      answer: "ตั้งเป็นห้องมอนิเตอร์แชทแล้ว",
      sends: [
        {
          kind: "text",
          text: `รับทราบค่ะ ตั้งกลุ่มนี้เป็นห้อง "มอนิเตอร์แชท OHO" 📟 เรียบร้อยแล้วค่ะ\nถ้ามีลูกค้าทักแล้วค้างเกิน 3 นาทียังไม่มีคนรับ วานจะแคปหน้าจอแชทมาเตือนในห้องนี้ พร้อมแท็กแอดมินเวรตอนนั้น (+ ผู้จัดการ + พี่โด้) ให้เลยค่ะ`,
          chatId: targetChatId,
        },
      ],
    });
  }

  // ปุ่มยืนยันปรับวันหมดอายุ Thunder (texp:ok[:expired|all]:<username> | texp:cancel)
  const texp = dataStr.match(/^texp:(ok|cancel)(?::(expired|all))?(?::(.+))?$/);
  if (texp) {
    if (!((await isOwner(fromId)) || (await isAuthorized(fromId)))) return NextResponse.json({ answer: "ไม่ได้รับอนุญาต", sends: [] });
    if (texp[1] === "cancel") return NextResponse.json({ answer: "ยกเลิกแล้ว", sends: [{ kind: "text", text: "ยกเลิกการปรับวันหมดอายุแล้วค่ะ" }] });
    const scope = texp[2] === "all" ? "all" : "expired"; // ไม่ระบุ (back-compat) = expired
    const username = (texp[3] || "").trim();
    if (!username) return NextResponse.json({ answer: "ข้อมูลไม่ครบ", sends: [] });
    const res = await executeExpiry(username, scope);
    if (!res.ok) {
      const msg =
        res.error === "no_session" || res.error === "session_expired"
          ? "session ระบบหลังบ้าน Thunder หมดอายุค่ะ รบกวนพี่โด้รัน `npm run thunder:auth` แล้วสั่งใหม่นะคะ"
          : res.error === "no_row_updated"
            ? "ไม่มีสาขาหลักที่หมดอายุให้ปรับค่ะ (ลองกด \"ปรับทุกสาขา\" ถ้าต้องการปรับทั้งหมด)"
            : `ปรับวันหมดอายุไม่สำเร็จค่ะ (${res.error || "unknown"})`;
      const sends: { kind: string; text?: string; dataBase64?: string; caption?: string }[] = [{ kind: "text", text: msg }];
      if (res.shotLeftBase64) sends.push({ kind: "photo", dataBase64: res.shotLeftBase64, caption: "หน้าจอระบบหลังบ้าน" });
      return NextResponse.json({ answer: "ไม่สำเร็จ", sends });
    }
    await logActivity({
      source: "thunder",
      kind: "expiry",
      customer: username,
      requestedBy: fromName || fromId || undefined,
      outcome: `updated ${res.updated}`,
      summary: `ปรับวันหมดอายุ Thunder ของ ${username} ${res.updated} สาขาหลัก (${scope === "all" ? "ทุกสาขา" : "เฉพาะที่หมดอายุ"}) ตามที่ ${fromName || "แอดมิน"} สั่ง`,
    });
    const tag = fromName ? `<a href="tg://user?id=${fromId}">${escH(fromName)}</a> ` : "";
    const sends: { kind: string; text?: string; parseMode?: string; dataBase64?: string; caption?: string }[] = [
      { kind: "text", text: `${tag}✅ แก้ไขวันหมดอายุของ <b>${escH(username)}</b> เรียบร้อยแล้วค่ะ (${res.updated} สาขาหลัก · ตั้งเป็นวัน/เวลาปัจจุบัน)`, parseMode: "HTML" },
    ];
    if (res.shotLeftBase64) sends.push({ kind: "photo", dataBase64: res.shotLeftBase64, caption: "ยูสเซอร์/สาขาที่ปรับ" });
    if (res.shotRightBase64) sends.push({ kind: "photo", dataBase64: res.shotRightBase64, caption: "วันหมดอายุใหม่ + สถานะ" });
    return NextResponse.json({ answer: "เรียบร้อย", sends });
  }

  // ปุ่มร่างเอกสาร (memo) — เซ็นเลย / แก้ไข
  const memo = dataStr.match(/^memo:(sign|revise):(.+)$/);
  if (memo) {
    const [, action, id] = memo;
    // บังคับลำดับ: เฉพาะเจ้าของ (โด้) เท่านั้นที่กดเซ็น/แก้ไขร่างได้ คนอื่นกดไม่ผ่าน
    if (!(await isOwner(fromId))) {
      return NextResponse.json({ answer: "ให้พี่โด้ตรวจและเซ็นก่อนนะคะ 🙏", sends: [] });
    }
    if (action === "sign") {
      const { signMemo, memoFilename } = await import("@/lib/memo-store");
      const res = await signMemo(id);
      if (!res.ok || !res.data) {
        return NextResponse.json({ answer: "ไม่พบร่าง", sends: [{ kind: "text", text: "ขออภัยค่ะ หาไฟล์ร่างไม่เจอ ลองออกเอกสารใหม่อีกครั้งนะคะ" }] });
      }
      const mgr = await getManagerSigner();
      const mention = mgr || undefined; // ให้บอทแท็กผู้จัดการที่ {{MENTION}}
      return NextResponse.json({
        answer: "เซ็นแล้วค่ะ",
        sends: [
          {
            kind: "text",
            text: "เซ็นเอกสารเรียบร้อยแล้วค่ะ ต่อไปรบกวน {{MENTION}} (ผู้จัดการ) เซ็นต่ออีกท่านนะคะ",
            mention,
          },
          {
            kind: "document",
            url: `/api/memo/${id}/pdf`,
            filename: memoFilename(res.data, true),
            caption: "เอกสารคืนเงิน (โด้เซ็นแล้ว) รบกวน {{MENTION}} เซ็นต่อ แล้วส่งต่อให้พี่บ๊อบบี้ได้เลยนะคะ\n🔒 ไฟล์ล็อกรหัสไว้ค่ะ (รหัสตามที่ทีมทราบ)",
            mention,
          },
        ],
      });
    }
    return NextResponse.json({
      answer: "รอรายละเอียดการแก้ไข",
      sends: [{ kind: "text", text: "ได้เลยค่ะ พิมพ์บอกได้เลยว่าอยากแก้ตรงไหน (เช่น ยอดเงิน วันที่ ชื่อบัญชี หรือข้อความ) เดี๋ยววานออกร่างใหม่ให้ค่ะ" }],
    });
  }

  const m = dataStr.match(/^doc:(approve|reject):(.+)$/);
  if (!m) return NextResponse.json({ answer: "คำสั่งไม่ถูกต้อง", sends: [] });

  const [, decision, id] = m;
  const result = await decideDocument(id, decision as "approve" | "reject");

  const sends: { kind: "text"; text: string }[] = [{ kind: "text", text: result.message }];
  return NextResponse.json({ answer: result.ok ? "บันทึกแล้ว" : "ไม่สำเร็จ", sends });
}
