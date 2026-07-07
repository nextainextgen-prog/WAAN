# คู่มือระบบ Changoh + น้องวาน (สรุปละเอียดทั้งหมด)

> เอกสารส่งต่อฉบับสมบูรณ์ — เจ้าของระบบ: **พี่โด้** (nextai.nextgen@gmail.com)
> Repo: https://github.com/nextainextgen-prog/WAAN.git (branch `main`)
> โฟลเดอร์: `/Users/mx/Projects/AITransformation/changoh-system`
> อัปเดตล่าสุด: 7 ก.ค. 2026

---

## 1. ภาพรวม

ระบบผู้ช่วย AI + ระบบหลังบ้าน ประกอบด้วย 2 ฝั่งที่เชื่อมกัน:
- **เว็บแอป** (Next.js) — Dashboard OKR, Kanban ทุนวิจัย, ทำสไลด์, จัดการเอกสาร, ตั้งค่า
- **น้องวาน** — บอท Telegram (@nong_waan_bot) เป็นหน้าบ้านหลักที่ทีมคุยด้วย สั่งงานได้ทุกอย่าง

หลักการสำคัญ:
- **Claude ผ่าน CLI (Max subscription) ไม่ใช้ API key** — เรียก `claude -p` เป็น subprocess
- **ภาษาไทยทั้งหมด** · เอกสาร/สไลด์ **ไม่มีอิโมจิ** (ใช้ไอคอน) · แชทน้องวาน **มีอิโมจิแนว Dev ได้**
- รัน local บนเครื่อง Mac

---

## 2. สิ่งที่ระบบทำได้ (ครบทุกฟีเจอร์)

### 2.1 OKR & ทุนวิจัย (เว็บ)
- **Dashboard OKR** — เป้า vs ผลจริง, %บรรลุ, กราฟ (gauge + bar), deadline ใกล้ถึง
- **Kanban** — ลากการ์ดเปลี่ยนสถานะทุน (ยื่นขอ→อนุมัติ→เบิกงวด→ดำเนินการ→ส่งรายงาน→ปิด), เพิ่ม/แก้/ลบ
- **Timeline** — deadline ทุกทุน เรียงตามวันที่ + แจ้งเลยกำหนด
- **นำเข้า Excel/CSV ดิบ** — แปลงเลข (`1,850,000 บาท`/`2.4M`/`850k`), สถานะไทย→key, พ.ศ.→ค.ศ., ข้ามแถวว่าง

### 2.2 น้องวาน (เลขา AI — เว็บ + Telegram)
- ถาม-ตอบจากข้อมูลจริง (ทุน/OKR/Obsidian)
- ร่างเอกสาร, สรุปงาน, เตือน deadline
- **สมองหลายโมเดล** สลับได้: Claude (หลัก) / Gemini / Hermes / อัตโนมัติ (หน้า Settings)
- อ่านความรู้จาก **Obsidian vault** (โฟลเดอร์งาน) เป็น second brain
- บุคลิก: เป็นกันเอง เรียกเจ้าของว่า "พี่โด้" เสนอไอเดีย ถามต่อ
- **ตอบสด**: หน่วง 2-3 วิ (พิมพ์อยู่) → ตอบรับตามชนิดงาน (📥) → อัปเดตสถานะระหว่างทำ (แก้ข้อความเดิม ไม่สแปม) → ส่งคำตอบ

### 2.3 Slide Generator (เด็ค HTML สไตล์ Thunder)
- สั่ง "สร้างสไลด์ ..." → Claude ดึงข้อมูลจริง → เด็ค HTML (navy CI, Archivo+IBM Plex Thai, ไอคอน SVG, **กราฟ Chart.js**, เลื่อนแนวนอน) + **PDF 16:9**
- layouts: ปก / KPI / กราฟ / ตาราง / bullets / คั่นหัวข้อ / ปิดท้าย
- ได้ทั้ง `.html` (เปิดเลื่อนดู) และ `.pdf` — ส่งเข้า Telegram/ดาวน์โหลดได้

### 2.4 Memo Generator (เอกสารคืนเงินหัก ณ ที่จ่าย)
- แอดมินส่ง **ข้อความ + ไฟล์แนบ** (รูป/PDF) เข้าน้องวาน
- Claude **อ่านข้อความดิบ → ดึงข้อมูล → ตรวจตัวเลขให้** (ยอดส่วนเกิน = ชำระ−สุทธิ)
- แปลง **PDF แนบ → ภาพ** (ไทยคมชัด) + เดาชื่อเอกสาร (หนังสือหัก/สลิป/บุ๊คแบงก์/ใบเสนอราคา)
- เรนเดอร์ PDF **ตรงเทมเพลตต้นฉบับเป๊ะ** (ฟอนต์ Sarabun 10pt, prose ย่อหน้า justify, กรอบเดียว, ผู้อนุมัติคอลัมน์ขวา, footer บริษัท, หน้า X/N) + หน้าแนบภาพ
- **ดราฟแรกยังไม่เซ็น** → มีปุ่ม **[เซ็นเลย]** (เติมลายเซ็นจิรภัทร์) / **[แก้ไข]**
- ผู้ลงนาม: จิรภัทร์ ภูครองหิน (หัวหน้าฝ่ายบริการลูกค้า, ลายเซ็นจริง) · ศิริลักษณ์ ชอบธรรม (ผจก.) · สมพร เสริฐศรี (ผู้อนุมัติ)

### 2.5 Document Pipeline + Google Drive
- **Google Drive จริง** (OAuth): วางไฟล์ในโฟลเดอร์ "Changoh - เอกสารเข้า" → น้องวานสรุปด้วย AI → แจ้ง Telegram ปุ่ม [อนุมัติ]/[ไม่อนุมัติ] → กดอนุมัติ → **เซ็น PDF** → อัปกลับโฟลเดอร์ "Changoh - เซ็นแล้ว"
- โฟลเดอร์ในเครื่อง (`~/Changoh-Inbox`) ก็ใช้ได้ (ทางเลือก)

### 2.6 Obsidian
- เชื่อม vault เดิม `/Users/mx/Documents/Obsidian Vault`
- AI **เขียนเฉพาะ** โฟลเดอร์ `AI-Changoh/` (memory/meetings/logs/slides) — แยกจากงาน/ส่วนตัว
- อ่านความรู้จากโฟลเดอร์งาน (01-sources, 10-companies, 40-playbooks, 50-decisions, 80-sheets, 90-meta)

### 2.7 Telegram — กลุ่ม + สิทธิ์ + ทีมงาน
- **แชทส่วนตัว**: เจ้าของทำได้ทุกอย่าง
- **กลุ่ม**: เจ้าของอยู่ในกลุ่ม = ผูกกลุ่มอัตโนมัติ · น้องวานตอบเมื่อ **ถูกเรียก** (มีคำว่า "น้องวาน" / ขึ้นต้น "วาน" / @nong_waan_bot / reply) เท่านั้น ไม่กวนกลุ่ม
- **สิทธิ์**: คนอื่นใช้ไม่ได้จนเจ้าของอนุญาต → เจ้าของ **reply ข้อความคนนั้น + พิมพ์ "ให้ตอบคนนี้ได้"** → อนุญาต+จำชื่อ (ยกเลิก: "ยกเลิกสิทธิ์")
- **จำทีมงาน**: reply + "จำไว้/นี่คือ/ตำแหน่ง..." → น้องวานจำชื่อ/ตำแหน่ง/ประวัติ, **แท็ก @username** และดึงประวัติมาใช้ได้

---

## 3. วิธีรัน (สำคัญ)

```bash
cd /Users/mx/Projects/AITransformation/changoh-system
npm install
npm run seed          # สร้างผู้ใช้เว็บ (ครั้งแรก)
npm run dev           # เว็บ + API (localhost:3000)   ← ต้องรันตลอด
npm run bot           # น้องวาน Telegram              ← ต้องรันตลอด
npm run drive:watch   # เฝ้า Google Drive             ← ถ้าใช้ Drive
npm run watch         # เฝ้าโฟลเดอร์ในเครื่อง (ทางเลือก)
npm run reminders     # แจ้งเตือน deadline (ตั้ง cron ทุกเช้า)
```

> ก่อนใช้ต้อง login CLI: `claude` (Max) และ `gemini` (ถ้าใช้) · Hermes ติดตั้งแล้วที่ `~/.local/bin/hermes`

**เว็บ login:** `aj.changoh@kku.ac.th` / `changoh2026`

---

## 4. ตั้งค่า (.env — ไม่ commit)

| ตัวแปร | ค่า/ความหมาย |
|--------|--------------|
| `TELEGRAM_BOT_TOKEN` | token น้องวาน (@nong_waan_bot) |
| `INTERNAL_API_TOKEN` | token ภายในให้ poller เรียก API |
| `CLAUDE_CLI_PATH` / `GEMINI_CLI_PATH` / `HERMES_CLI_PATH` | path CLI |
| `BRAIN_DEFAULT_MODEL` | claude/gemini/hermes/auto |
| `OBSIDIAN_VAULT_PATH` | `/Users/mx/Documents/Obsidian Vault` |
| `OBSIDIAN_AI_FOLDER` / `OBSIDIAN_WORK_FOLDERS` | โฟลเดอร์ AI / โฟลเดอร์งานที่อ่านได้ |
| `DRIVE_INBOX_FOLDER_ID` | `10ds_r5nSjeG55GNzXdJ30BaV4bi8Utka` (เอกสารเข้า) |
| `DRIVE_SIGNED_FOLDER_ID` | `1KYYFE44bkjU1g7H7KALNJeaDD2V-WWmC` (เซ็นแล้ว) |
| `WATCH_FOLDER` | `/Users/mx/Changoh-Inbox` |

**ไฟล์ที่ไม่ commit (อยู่ในเครื่อง):** `.env`, `credentials.json`, `.drive-token.json`, `public/signature.png` (ลายเซ็นจริงจิรภัทร์), `changoh.db`

---

## 5. สแตกและสถาปัตยกรรม

- **Next.js 16** (App Router, Turbopack) + React 19 + Tailwind v4 + TypeScript
- **Prisma 6 + SQLite** (`prisma/changoh.db`) — models: User, Grant, OkrTarget, StyleMemory, ChatMessage, Setting, TeamMember, Document
- **Claude/Gemini/Hermes ผ่าน CLI subprocess** — `src/lib/claude.ts` (รันใน cwd สะอาด + การ์ดกันบริบท Claude Code หลุด), `gemini.ts`, `hermes.ts`, รวมที่ `brain.ts`
- **HTML→PDF**: Playwright (headless Chromium) — `src/lib/html-pdf.ts`
- **เด็ค**: `deck-html.ts` (เทมเพลต) + `deck-generate.ts` (Claude→JSON→HTML+PDF)
- **เอกสาร**: `memo.ts` (เทมเพลต) + `memo-generate.ts` (สกัดข้อมูล) + `memo-store.ts` (draft/เซ็น) + `pdf-to-images.ts` (pdfjs+@napi-rs/canvas)
- **ทีม/สิทธิ์**: `team.ts` · **Telegram**: `telegram.ts` + `scripts/telegram-bot.mjs` (poller)
- ฟอนต์: Noto Sans Thai (เว็บ) · Sarabun ฝังในไฟล์ (เอกสาร/PDF)
- `serverExternalPackages`: pdfkit, pptxgenjs, pdfjs-dist, pdf-lib, mammoth, playwright, @napi-rs/canvas

---

## 6. ข้อมูล/บัญชีที่เกี่ยวข้อง

- **Telegram bot**: @nong_waan_bot · ผูกกับเจ้าของ chat id `7750653134` (พี่โด้)
- **Google Cloud**: project `gen-lang-client-0399784657` · OAuth client "Changoh Drive" (Desktop) · Drive API เปิดแล้ว
- **โฟลเดอร์ Drive**: เอกสารเข้า / เซ็นแล้ว ( id ตามตารางข้อ 4)
- **ต้องทำเองที่ BotFather** (ถ้าใช้กลุ่มด้วยคำเรียก): `/setprivacy` → เลือกบอท → **Disable**

---

## 7. Flow การใช้งานหลัก

**ออกเอกสารคืนเงิน (Telegram):**
```
แอดมิน: (ส่งข้อความรายละเอียด + แนบสลิป/หนังสือหัก/บุ๊คแบงก์/ใบเสนอราคา)
น้องวาน: 📥 โอเคค่ะ รับเรื่องออกเอกสารแล้ว... (อัปเดตสถานะ) → ส่งดราฟ PDF + ปุ่ม [เซ็นเลย]/[แก้ไข]
แอดมิน: กด [เซ็นเลย] → น้องวานเติมลายเซ็น ส่งฉบับเซ็นแล้วกลับ
```

**ทำสไลด์:** พิมพ์ "น้องวาน สร้างสไลด์สรุปเดือนนี้" → ได้ .html + .pdf

**อนุญาตทีม (กลุ่ม):** reply ข้อความคนนั้น + "ให้ตอบคนนี้ได้"

---

## 8. งานที่เหลือ/ปรับต่อได้

- ฟอนต์ลิขสิทธิ์ Olimpico/Arrière Garde/Longhand LP Bold — วาง `.woff2` ใน `public/fonts/` เพื่อเปิดใช้ (ตอนนี้ fallback)
- Hermes ต้อง config โมเดล/provider ของตัวเองถ้าจะใช้เต็มที่
- บริการรันในเซสชัน dev — ใช้จริง 24 ชม. ต้องรันเองใน Terminal (หรือทำเป็น service/pm2)
- Style Memory สไลด์ — สอนสไตล์ผ่านแชท/หน้า Settings ได้

---

## 9. Troubleshooting

- **น้องวานไม่ตอบในกลุ่ม** → เช็ก BotFather privacy = Disable, เรียกด้วย "น้องวาน..." , poller รันอยู่ไหม (`pgrep -f telegram-bot`)
- **PDF ภาษาไทยเป็นสี่เหลี่ยม** → pdf-to-images ใช้ `disableFontFace:true` แล้ว
- **claude หลุด system prompt** → แก้แล้ว (รันใน cwd สะอาด + การ์ด) ถ้ายังหลุด เช็ก `src/lib/claude.ts`
- **เอกสารส่งซ้ำ** → มี `memoInFlight` กันแล้ว + อย่ารัน poller ซ้อน
