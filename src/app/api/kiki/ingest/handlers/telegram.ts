import { userbotReady, findPeer, sendAsOwner, readChat, setPendingDm, getPendingDm, listDialogs, setAlias, getAliases, type PeerHit } from "@/lib/kiki-userbot";
import { askKiki, askExtractor, setSetting, addKikiChatId, rememberOwnerFact, kikiConversation, getSetting, sanitizeVexText, vexLine, setPendingFor, getPendingFor, pendingElsewhereNote } from "@/lib/kiki";
import { escHtml } from "../shared";
import type { Ctx, Handler } from "../types";
import { ok, type Send } from "../types";

export const dmConfirmHandler: Handler = async (ctx) => {
  const { text, msgId, channel, reply } = ctx;
  // ===== Telegram userbot: ยืนยัน/ยกเลิกการส่งที่ค้างอยู่ =====
  {
    const pending = await getPendingDm(channel);
    const confirming = /^\s*(ยืนยัน|ส่งเลย|ส่งได้|โอเค\s*ส่ง|เอาเลย)/.test(text);
    const canceling = /^\s*(ยกเลิก|ไม่ส่ง|ไม่เอา)/.test(text);
    // ร่างค้างอยู่คนละช่องทาง = ไม่ยืนยันให้เด็ดขาด (ส่งผิดตัวในนามเจ้าของคือความเสียหายที่ถอนไม่ได้)
    if (pending && !pending.sameChannel && (confirming || canceling)) {
      // canned-ok: ข้อความบอกว่า "ยังไม่ได้ทำ" ห้ามให้ AI เรียบเรียง — เคยแต่งกลับมาเป็น "ผมส่งให้ทาง Telegram แล้ว" ซึ่งไม่จริง
      return reply([{ kind: "text", text: pendingElsewhereNote(`ข้อความถึง ${pending.data.peerName}`, pending.channel), replyTo: msgId }]);
    }
    if (pending?.sameChannel && confirming) {
      await setPendingDm(null, channel);
      try {
        await sendAsOwner(pending.data.peerId, pending.data.message);
        return reply([{ kind: "text", text: await vexLine(`ส่งหา ${pending.data.peerName} แล้วครับ 📤 (ในนามบัญชีของโด้เอง)`), replyTo: msgId }]);
      } catch (e) {
        return reply([{ kind: "text", text: await vexLine(`ส่งไม่สำเร็จครับ ⚠️ (${e instanceof Error ? e.message.slice(0, 120) : "error"})`), replyTo: msgId }]);
      }
    }
    if (pending?.sameChannel && canceling) {
      await setPendingDm(null, channel);
      return reply([{ kind: "text", text: await vexLine("ยกเลิกแล้วครับ ✅ ไม่ส่ง"), replyTo: msgId }]);
    }
  }

  return null;
};

export const groupConfirmHandler: Handler = async (ctx) => {
  const { chatId, text, fromId, msgId, channel, reply } = ctx;
  // ===== สร้างกลุ่มใหม่: ยืนยัน/ยกเลิก (ปุ่มหรือพิมพ์) =====
  {
    const grpBox = await getPendingFor<{ title: string }>("kiki_pending_group", channel);
    const pendingGrp = grpBox?.sameChannel ? grpBox.data : null;
    // ร่างค้างคนละช่องทาง = บอกว่าอยู่ไหน ไม่สร้างให้ (สร้างกลุ่มจริงในนามเจ้าของ ถอนคืนไม่ได้)
    if (grpBox && !grpBox.sameChannel && /^\[ปุ่ม:(สร้างกลุ่ม|ยกเลิกกลุ่ม)\]$|^\s*(สร้างเลย|ลุยเลย|เอาเลย)\s*$/.test(text)) {
      // canned-ok: เหตุผลเดียวกัน — ห้ามให้ถ้อยคำกลายเป็นการเคลมว่าสร้างกลุ่มไปแล้ว
      return reply([{ kind: "text", text: pendingElsewhereNote(`กลุ่ม "${grpBox.data.title}"`, grpBox.channel), replyTo: msgId }]);
    }
    if (pendingGrp && text === "[ปุ่ม:ยกเลิกกลุ่ม]") {
      await setPendingFor("kiki_pending_group", channel, null);
      return reply([{ kind: "text", text: await vexLine("ยกเลิกแล้วครับ ✅ ไม่สร้างกลุ่ม"), replyTo: msgId }]);
    }
    if (pendingGrp && (text === "[ปุ่ม:สร้างกลุ่ม]" || /^\s*(สร้างเลย|ลุยเลย|เอาเลย)\s*$/.test(text))) {
      await setPendingFor("kiki_pending_group", channel, null);
      const { userbotReady: ubReady, createOwnerGroup } = await import("@/lib/kiki-userbot");
      if (!ubReady()) return reply([{ kind: "text", text: await vexLine(`บัญชี Telegram ยังไม่เชื่อมครับ ⚠️ รัน: npm run kiki:tg-auth ก่อน`), replyTo: msgId }]);
      try {
        const g = await createOwnerGroup(pendingGrp.title);
        await addKikiChatId(g.chatId);
        const sends: Send[] = [];
        if (g.botAdded) {
          // ทักในกลุ่มใหม่ + แท็กเจ้าของ (tg://user ใช้ได้แม้ไม่มี username)
          sends.push({
            kind: "text",
            chatId: g.chatId,
            parseMode: "HTML",
            text: `กลุ่ม "${escHtml(g.title)}" พร้อมใช้แล้วครับ <a href="tg://user?id=${fromId}">โด้</a> — ผมประจำการที่นี่แล้ว ใช้ได้ทุกความสามารถเหมือนกลุ่มหลักเลย 🎯`, // canned-ok: มีแท็ก HTML tg://user
          });
        }
        sends.push({
          kind: "text",
          text: await vexLine(`สร้างกลุ่ม "${g.title}" เสร็จแล้วครับ ✅ โด้เป็นเจ้าของกลุ่ม${g.botAdded ? " ผมเข้าไปประจำการ+ทักไว้ในนั้นแล้ว" : " ⚠️ แต่ดึงผมเข้าไม่สำเร็จ — เชิญ @kiki_lekha_bot เข้ากลุ่มให้หน่อยครับ"}\n\nเปิดดูในลิสต์แชท Telegram ได้เลย`),
          replyTo: msgId,
        });
        return reply(sends);
      } catch (e) {
        return reply([{ kind: "text", text: await vexLine(`สร้างกลุ่มไม่สำเร็จครับ ⚠️ ${e instanceof Error ? e.message.slice(0, 150) : "error"}`), replyTo: msgId }]);
      }
    }
  }

  return null;
};

export const createGroupHandler: Handler = async (ctx) => {
  const { text, msgId, is, channel, reply } = ctx;
  // ===== สร้างกลุ่มใหม่: รับคำสั่ง + ตั้งชื่อ + ปุ่มยืนยัน =====
  if (is("tg_create_group") && !text.startsWith("[ปุ่ม")) {
    const { userbotReady: ubReady } = await import("@/lib/kiki-userbot");
    if (!ubReady()) return reply([{ kind: "text", text: await vexLine(`สร้างกลุ่มต้องใช้บัญชี Telegram ของโด้ครับ ⚠️ รัน: npm run kiki:tg-auth ก่อน (ครั้งเดียว)`), replyTo: msgId }]);
    const nameM = text.match(/สร้างกลุ่ม.{0,8}(?:ชื่อ|ว่า)\s*["“']?([^"”'\n]{2,60})/);
    let title = nameM?.[1]?.trim() || "";
    if (!title) {
      // ไม่บอกชื่อ = ตั้งจากเรื่องที่คุยกันล่าสุด
      const convo = await kikiConversation(16);
      try {
        const rawT = await askExtractor(`${convo}\n\nคำสั่งเจ้าของ: """${text}"""`, {
          system: `ตั้งชื่อกลุ่ม Telegram จากโปรเจกต์/เรื่องที่เจ้าของกำลังคุย ตอบ JSON เท่านั้น: {"title":"ชื่อกลุ่ม สั้น อ่านรู้เรื่อง (ไทย/อังกฤษได้ ไม่ใส่อิโมจิ)"}`,
          timeoutMs: 60_000,
        });
        const mT = rawT.match(/\{[\s\S]*\}/);
        title = mT ? String((JSON.parse(mT[0]) as { title?: string }).title || "").trim() : "";
      } catch { /* ตกไปใช้ชื่อกลาง */ }
    }
    if (!title) title = `โปรเจกต์ใหม่ — โด้ x Vex`;
    await setPendingFor("kiki_pending_group", channel, { title });
    return reply([{
      kind: "text",
      text: await vexLine(`จะสร้างกลุ่ม "${title}" ผ่านบัญชีของโด้ (โด้เป็นเจ้าของกลุ่มอัตโนมัติ) แล้วดึงผมเข้าไปประจำการครับ\n\nถ้าอยากได้ชื่ออื่น พิมพ์ "สร้างกลุ่มชื่อ ..." มาใหม่ได้เลย`),
      replyTo: msgId,
      buttons: [[{ text: "✅ สร้างเลย", data: "kiki:grp:yes" }, { text: "❌ ยกเลิก", data: "kiki:grp:no" }]],
    }]);
  }

  return null;
};

export const listChatsHandler: Handler = async (ctx) => {
  const { text, msgId, is, reply } = ctx;
  // ===== Telegram userbot: ลิสต์รายชื่อแชทในบัญชีเจ้าของ =====
  if (is("tg_list_chats")) {
    if (!userbotReady()) return reply([{ kind: "text", text: await vexLine(`ยังไม่ได้เชื่อมบัญชี Telegram ครับ ⚠️ รัน: npm run kiki:tg-auth`), replyTo: msgId }]);
    const kind = /ไม่เอากลุ่ม|เฉพาะคน|แค่คน|คนอย่างเดียว/.test(text) ? "user" : /เฉพาะกลุ่ม|เอาแต่กลุ่ม|แค่กลุ่ม/.test(text) ? "group" : "all";
    try {
      const rows = await listDialogs(kind, 40);
      if (!rows.length) return reply([{ kind: "text", text: "ไม่เจอแชทเลยครับ 🎯", replyTo: msgId }]);
      await setSetting("kiki_last_dialog_list", JSON.stringify(rows));
      const aliases = await getAliases();
      const lines = rows.map((r, i) => {
        const al = aliases.find((a) => a.peerId === r.id);
        return `${i + 1}. ${r.name}${r.username ? ` (@${r.username})` : ""}${r.isGroup ? " · กลุ่ม" : ""}${al ? ` — เรียกว่า "${al.alias}"` : ""}`;
      });
      return reply([
        { kind: "text", text: `แชทล่าสุดในบัญชีของโด้ (${rows.length}${kind === "user" ? " · เฉพาะคน" : kind === "group" ? " · เฉพาะกลุ่ม" : ""}):\n\n${lines.join("\n")}`, replyTo: msgId }, // canned-ok: ลิสต์รายชื่อแชทจริง
        { kind: "text", text: await vexLine(`ตั้งชื่อเรียกเองได้เลยครับ เช่น "แชท 3 คืออั๋น แฟนผม" หรือ "แชท <ชื่อ> คือพี่ภูมิ" — ต่อไปสั่ง "ไปบอกอั๋นว่า..." ได้ทันที 🎯`) },
      ]);
    } catch (e) {
      return reply([{ kind: "text", text: await vexLine(`ดึงรายชื่อแชทไม่ได้ครับ ⚠️ (${e instanceof Error ? e.message.slice(0, 100) : "error"})`), replyTo: msgId }]);
    }
  }

  return null;
};

export const aliasHandler: Handler = async (ctx) => {
  const { text, msgId, reply } = ctx;
  // ===== Telegram userbot: ตั้งชื่อเรียกแชทเอง ("แชท 3 คืออั๋น แฟนผม" / "แชท Aun คือแฟนผม ชื่ออั๋น") =====
  const aliasM = text.match(/^แชท\s*(?:หมายเลข|เบอร์|ที่)?\s*(.{1,50}?)\s*(?:คือ|=)\s*(.{1,80})$/);
  if (aliasM && userbotReady()) {
    const ref = aliasM[1].trim();
    const desc = aliasM[2].trim();
    let peer: PeerHit | null = null;
    if (/^\d{1,2}$/.test(ref)) {
      try {
        const list = JSON.parse((await getSetting("kiki_last_dialog_list")) || "[]") as PeerHit[];
        peer = list[Number(ref) - 1] || null;
      } catch { peer = null; }
      if (!peer) return reply([{ kind: "text", text: await vexLine(`หมายเลข ${ref} ไม่อยู่ในลิสต์ล่าสุดครับ — พิมพ์ "ขอรายชื่อแชท" ก่อนแล้วค่อยอ้างเลขนะครับ`), replyTo: msgId }]);
    } else {
      const hits = await findPeer(ref).catch(() => []);
      if (!hits.length) return reply([{ kind: "text", text: await vexLine(`หาแชท "${ref}" ไม่เจอครับ — ลอง "ขอรายชื่อแชท" แล้วอ้างหมายเลขแทน`), replyTo: msgId }]);
      if (hits.length > 1) return reply([{ kind: "text", text: `เจอหลายแชท: ${hits.map((h) => h.name).join(" · ")} — ใช้ "ขอรายชื่อแชท" แล้วอ้างหมายเลขชัวร์กว่าครับ`, replyTo: msgId }]); // canned-ok: ลิสต์แชทให้เลือก
      peer = hits[0];
    }
    // ชื่อเรียก = คำแรกของคำอธิบาย (เก็บคำอธิบายเต็มไว้ใน note + ความจำ)
    const alias = desc.replace(/^(ชื่อ|คือ)\s*/, "").split(/\s+/)[0].replace(/[,.]$/, "");
    await setAlias({ alias, peerId: peer.id, peerName: peer.name, note: desc !== alias ? desc : undefined });
    await rememberOwnerFact(`"${alias}" ใน Telegram = แชท "${peer.name}"${desc !== alias ? ` (${desc})` : ""}`, { category: "คนรอบตัว", source: text });
    return reply([{ kind: "text", text: await vexLine(`จำแล้วครับ ✅ "${alias}" = แชท ${peer.name}${desc !== alias ? ` (${desc})` : ""}\n\nต่อไปสั่งได้เลย: "ไปบอก${alias}ว่า..." / "สรุปแชทกับ${alias}"`), replyTo: msgId }]);
  }

  return null;
};

export const groupPostHandler: Handler = async (ctx) => {
  const { chatId, text, fromId, msgId, is, reply } = ctx;
  // ===== ส่งข้อความ/ประกาศเข้ากลุ่มที่ Vex ประจำการ (ส่งเองผ่านบอท ไม่ต้องยืนยัน) =====
  // เคสจริง 3 ส.ค.: "ไปแจ้งข้อความในกลุ่ม..." ไม่มี intent → Vex รับปากลอย ๆ ว่าส่งแล้ว
  if (is("tg_group_post")) {
    let titles: Record<string, string> = {};
    try { titles = JSON.parse((await getSetting("kiki_chat_titles")) || "{}"); } catch { /* ว่างก็ได้ */ }
    const knownIds = (await (await import("@/lib/kiki")).getKikiChatIds()).filter((id) => id.startsWith("-"));
    const candidates = knownIds.filter((id) => id !== chatId);
    const lower = text.toLowerCase();
    // จับชื่อกลุ่มจากข้อความ → ไม่เจอ = กลุ่มที่เพิ่มล่าสุด (เคส "กลุ่มที่เพิ่งสร้าง")
    let target = candidates.find((id) => {
      const t = (titles[id] || "").toLowerCase();
      return t && (lower.includes(t) || t.split(/[\s—–-]+/).some((w) => w.length >= 3 && lower.includes(w)));
    });
    if (!target && candidates.length) target = candidates[candidates.length - 1];
    if (target) {
      const convo = await kikiConversation(16);
      const wantTag = /แท็ก|tag|เมนชั่น/i.test(text);
      const content = await askKiki(
        `[เขียนประกาศลงกลุ่ม "${titles[target] || target}"] เจ้าของสั่ง: """${text}"""\nเขียน "เนื้อหาที่จะโพสต์จริง" ตามคำสั่ง อิงเรื่องที่คุยกันในบริบท ตอบเฉพาะเนื้อหาที่จะส่ง ไม่ต้องเกริ่น ไม่ต้องถามกลับ`,
        convo,
      ).catch(() => "");
      if (!content.trim()) return reply([{ kind: "text", text: await vexLine(`เรียบเรียงเนื้อหาไม่สำเร็จครับ ⚠️ ลองสั่งใหม่อีกที`), replyTo: msgId }]);
      const clean = sanitizeVexText(content).text.replace(/<[^>]+>/g, "");
      const finalHtml = `${wantTag ? `<a href="tg://user?id=${fromId}">โด้</a>\n\n` : ""}${escHtml(clean)}`;
      return reply([
        { kind: "text", chatId: target, parseMode: "HTML", text: finalHtml },
        { kind: "text", text: `ส่งเข้ากลุ่ม "${titles[target] || target}" แล้วครับ ✅${wantTag ? " (แท็กโด้ไว้บรรทัดแรก)" : ""}\n\nเนื้อหาที่ส่ง:\n${clean.slice(0, 400)}${clean.length > 400 ? "..." : ""}`, replyTo: msgId }, // canned-ok: โควตเนื้อหาที่โพสต์เข้ากลุ่มจริง
      ]);
    }
    // ไม่รู้จักกลุ่มไหนเลย → ตกไปทาง userbot ข้างล่าง (กลุ่มนอกที่ Vex ไม่ได้อยู่)
  }

  return null;
};

export const dmHandler: Handler = async (ctx) => {
  const { text, msgId, is, channel, reply } = ctx;
  // ===== Telegram userbot: ส่งข้อความหาใครก็ได้ในนามเจ้าของ (ยืนยันก่อนส่งเสมอ) =====
  if (is("tg_dm")) {
    if (!userbotReady()) {
      return reply([{ kind: "text", text: await vexLine(`ยังไม่ได้เชื่อมบัญชี Telegram ของโด้ครับ ⚠️ รันในเทอร์มินัล: npm run kiki:tg-auth (ครั้งเดียว) แล้วผมส่งแทนโด้ได้เลย`), replyTo: msgId }]);
    }
    let dm: { target?: string; message?: string } | null = null;
    try {
      const raw = await askExtractor(`ข้อความเจ้าของ: """${text}"""`, {
        system: `แยกคำสั่งส่งข้อความ ตอบ JSON เท่านั้น: {"target":"ชื่อ/username คนหรือกลุ่มที่จะส่งหา","message":"ข้อความที่จะส่ง (เรียบเรียงจากที่เจ้าของสั่ง ให้เหมือนเจ้าของพิมพ์เอง ไม่ต้องแนะนำตัว)"}`,
        timeoutMs: 60_000,
      });
      const m = raw.match(/\{[\s\S]*\}/);
      dm = m ? (JSON.parse(m[0]) as { target?: string; message?: string }) : null;
    } catch { dm = null; }
    if (!dm?.target || !dm.message) return reply([{ kind: "text", text: await vexLine(`บอกใหม่อีกทีครับ ใครและข้อความว่าอะไร เช่น "ไปบอกแม่ว่า เดี๋ยวกลับดึก"`), replyTo: msgId }]);
    const hits = await findPeer(dm.target).catch(() => []);
    if (!hits.length) return reply([{ kind: "text", text: await vexLine(`หาแชท "${dm.target}" ในบัญชีของโด้ไม่เจอครับ 🎯 ลองบอกชื่อตามที่โชว์ใน Telegram หรือ @username`), replyTo: msgId }]);
    if (hits.length > 1) {
      return reply([{ kind: "text", text: `เจอหลายแชทครับ หมายถึงอันไหน:\n${hits.map((h, i) => `${i + 1}. ${h.name}${h.username ? ` (@${h.username})` : ""}${h.isGroup ? " · กลุ่ม" : ""}`).join("\n")}\n\nสั่งใหม่โดยระบุชื่อเต็ม/username ครับ`, replyTo: msgId }]); // canned-ok: ลิสต์แชทให้เลือก
    }
    await setPendingDm({ peerId: hits[0].id, peerName: hits[0].name, message: dm.message }, channel);
    return reply([{
      kind: "text",
      text: `จะส่งหา ${hits[0].name}${hits[0].username ? ` (@${hits[0].username})` : ""} ในนามบัญชีของโด้ ว่า:\n\n"${dm.message}"`, // canned-ok: ข้อความที่จะส่งในนามเจ้าของ ต้องตรงตัว
      replyTo: msgId,
      buttons: [[{ text: "✅ ส่งเลย", data: "kiki:dm:yes" }, { text: "❌ ไม่ส่ง", data: "kiki:dm:no" }]],
    }]);
  }

  return null;
};

export const chatSummaryHandler: Handler = async (ctx) => {
  const { text, msgId, is, arg, reply } = ctx;
  // ===== Telegram userbot: สรุปแชท/กลุ่มไหนก็ได้ที่เจ้าของอยู่ =====
  // เจตนา tg_chat_summary ไม่เคยมีตัวรับ — พูดว่า "อั๋นคุยอะไรกับผมไว้บ้าง" แล้วตกไปคุยเล่นแทน
  // ตัวอ่านเจตนาให้ชื่อคนมาใน args ได้ ถ้าไม่ให้ค่อยถามกลับ (ซ่อม 4 ส.ค. 2026)
  const chatSumM = text.match(/สรุปแชท(?:กับ|กลุ่ม)?\s*([^\n]{2,40}?)(?:ให้|หน่อย|ล่าสุด|วันนี้|$)/);
  if (!chatSumM && is("tg_chat_summary") && userbotReady()) {
    const who = arg("peer") || arg("query") || arg("name");
    if (!who) {
      return reply([{ kind: "text", text: await vexLine("อยากให้สรุปแชทกับใครครับ บอกชื่อมาได้เลย"), replyTo: msgId }]);
    }
    const hits = await findPeer(who).catch(() => []);
    if (hits.length !== 1) {
      return reply([{ kind: "text", text: await vexLine(hits.length ? `เจอหลายแชทที่ชื่อใกล้กับ "${who}" ครับ ระบุให้ชัดกว่านี้หน่อย` : `หาแชทชื่อ "${who}" ไม่เจอครับ`), replyTo: msgId }]);
    }
    const lines = await readChat(hits[0].id, 80).catch(() => []);
    if (!lines.length) return reply([{ kind: "text", text: await vexLine(`อ่านแชท ${hits[0].name} ไม่ได้/ไม่มีข้อความครับ`), replyTo: msgId }]);
    const sum = await askKiki(`สรุปบทสนทนานี้ให้เจ้าของ (แชทกับ ${hits[0].name}) — เอาสาระ ใครขออะไร ค้างอะไร:\n\n${lines.join("\n").slice(0, 12_000)}`);
    return reply([{ kind: "text", text: sum.slice(0, 3900), replyTo: msgId }]);
  }
  if (chatSumM && userbotReady() && !/ฟีด|เฟส|facebook/i.test(text)) {
    const hits = await findPeer(chatSumM[1].trim()).catch(() => []);
    if (hits.length === 1) {
      const lines = await readChat(hits[0].id, 80).catch(() => []);
      if (!lines.length) return reply([{ kind: "text", text: await vexLine(`อ่านแชท ${hits[0].name} ไม่ได้/ไม่มีข้อความครับ`), replyTo: msgId }]);
      const answer = await askKiki(
        `สรุปบทสนทนาในแชท "${hits[0].name}" ให้เจ้าของ: ประเด็นหลัก ใครพูดอะไรสำคัญ มีอะไรต้องทำ/ตอบไหม`,
        `=== ข้อความล่าสุดในแชท (เก่า→ใหม่) ===\n${lines.join("\n").slice(0, 12_000)}`,
      );
      return reply([{ kind: "text", text: answer.slice(0, 3900), replyTo: msgId }]);
    }
    if (hits.length > 1) return reply([{ kind: "text", text: `เจอหลายแชท: ${hits.map((h) => h.name).join(" · ")} — ระบุชื่อเต็มอีกทีครับ`, replyTo: msgId }]); // canned-ok: ลิสต์แชทให้เลือก
  }

  return null;
};
