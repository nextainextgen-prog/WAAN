// Seed: สร้างบัญชีผู้ใช้จริง + เป้า OKR ปีปัจจุบัน (ไม่มีข้อมูลทุนปลอม)
import { PrismaClient } from "../src/generated/prisma/index.js";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

const EMAIL = process.env.SEED_EMAIL || "aj.changoh@kku.ac.th";
const PASSWORD = process.env.SEED_PASSWORD || "changoh2026";
const NAME = process.env.SEED_NAME || "อาจารย์ช้างโอ๋";

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const user = await db.user.upsert({
    where: { email: EMAIL },
    update: { name: NAME },
    create: { email: EMAIL, name: NAME, passwordHash, role: "admin" },
  });

  const year = new Date().getFullYear();
  await db.okrTarget.upsert({
    where: { year },
    update: {},
    create: { year, targetAmount: 10_000_000 },
  });

  // Style Memory เริ่มต้น (อาจารย์แก้ผ่านแชทได้)
  const existingStyle = await db.styleMemory.findFirst({ where: { label: "default" } });
  if (!existingStyle) {
    await db.styleMemory.create({
      data: {
        label: "default",
        content:
          "สไลด์สไตล์ทางการ มืออาชีพ ใช้โทนสีน้ำเงินเข้ม (#1D4ED8) กับพื้นขาว หัวข้อใหญ่ชัดเจน หนึ่งประเด็นต่อสไลด์ เน้นตัวเลขสำคัญให้เด่น มีสรุปผลเป็น bullet สั้นๆ ไม่เกิน 5 ข้อต่อสไลด์ ใช้ภาษาไทยทางการ",
      },
    });
  }

  console.log("Seed สำเร็จ");
  console.log("  ผู้ใช้:", user.email, "(", user.name, ")");
  console.log("  รหัสผ่านเริ่มต้น:", PASSWORD);
  console.log("  เป้า OKR ปี", year, ": 10,000,000 บาท");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
