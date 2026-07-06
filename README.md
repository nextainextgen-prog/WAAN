# Changoh System — ระบบบริหารทุนวิจัย & เลขา AI

ระบบบริหารทุนวิจัย OKR + เลขา AI สำหรับ **อาจารย์ช้างโอ๋** คณะบริหารธุรกิจ มหาวิทยาลัยขอนแก่น
ทำงานแบบ local-first บน Mac ใช้ **Claude ผ่าน Max subscription (ไม่ใช้ API key)**

โค้ดเนม Telegram bot: **น้องวาน (@nong_waan_bot)**

---

## ความสามารถ

| ส่วน | รายละเอียด |
|------|-----------|
| **OKR & Research Tracker** | Dashboard เป้า 10 ล้าน, Kanban ลากเปลี่ยนสถานะทุน, Timeline/Deadline, นำเข้า Excel/CSV ดิบ |
| **เลขา AI (สมองหลายโมเดล)** | แชทถาม-ตอบจากข้อมูลจริง, ร่างเอกสาร — เลือกสมองได้: **Claude / Gemini / Hermes** + อ่านความรู้จาก **Obsidian** |
| **Slide Generator** | สั่งผ่านแชท → ดึงข้อมูลจริง → สร้าง **.pptx + .pdf** ตาม Style Memory ที่สอนไว้ |
| **Document Pipeline** | เฝ้าดูโฟลเดอร์ → สรุปด้วย AI → อนุมัติ/ไม่อนุมัติ (เว็บหรือ Telegram) → **เซ็น PDF** อัตโนมัติ |
| **Telegram** | คุยกับเลขา, สั่งสไลด์, อนุมัติเอกสารด้วยปุ่ม, แจ้งเตือน deadline ทุกเช้า |
| **Obsidian** | เชื่อม vault เดิม — AI เขียนเฉพาะโฟลเดอร์ `AI-Changoh` (แยกจากงาน/ส่วนตัว) |

การออกแบบ: ธีมสว่าง "Trust & Authority" · ไอคอน lucide (ไม่มีอิโมจิ) · ฟอนต์ Noto Sans Thai + Sarabun (สไลด์/PDF)

---

## เริ่มใช้งาน

```bash
npm install
cp .env.example .env      # แล้วเติมค่า (ดูด้านล่าง)
npm run db:push           # สร้างฐานข้อมูล
npm run seed              # สร้างบัญชีผู้ใช้ + เป้า OKR
npm run dev               # เปิด http://localhost:3000
```

บัญชีเริ่มต้น: `aj.changoh@kku.ac.th` / `changoh2026` (เปลี่ยนได้ผ่าน env ตอน seed)

### ตั้งค่า `.env` ที่จำเป็น
- `AUTH_SECRET`, `INTERNAL_API_TOKEN` — ค่าสุ่มยาวๆ
- `TELEGRAM_BOT_TOKEN` — จาก @BotFather (ผูก chat ครั้งแรกด้วยการทัก `/start`)
- `OBSIDIAN_VAULT_PATH` — path ของ vault เดิม (ถ้าจะใช้)
- `HERMES_WEBHOOK_URL` — URL ของ Hermes agent เดิม (ถ้าจะใช้)

### ต้อง login CLI ก่อน (ใช้ subscription ไม่ใช้ API key)
```bash
claude          # login Claude Max
gemini          # (ถ้าใช้ Gemini) login Google
```

---

## รันบริการเสริม (แต่ละอันคนละ terminal)

```bash
npm run bot            # Telegram bot (long-polling)
npm run watch          # เฝ้าดูโฟลเดอร์เอกสาร (ตั้ง WATCH_FOLDER)
npm run reminders      # ส่งแจ้งเตือน deadline (ตั้ง cron ทุกเช้า)
node scripts/make-signature.mjs   # สร้างลายเซ็นตัวอย่าง (แทนที่ public/signature.png ด้วยของจริง)
```

---

## สแตก

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Prisma 6 + SQLite ·
Recharts · pptxgenjs · pdfkit · pdf-lib · pdfjs · Sarabun (ฟอนต์ไทยฝังในไฟล์)

> หมายเหตุ: ฟอนต์ Olimpico / Arrière Garde / Longhand LP Bold เป็นฟอนต์ลิขสิทธิ์
> วางไฟล์ `.woff2` ใน `public/fonts/` เพื่อเปิดใช้ (ระหว่างนี้ fallback อัตโนมัติ)
