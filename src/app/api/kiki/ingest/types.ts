import { NextResponse } from "next/server";
import type { RouteResult } from "@/lib/kiki-router";

/**
 * รูปแบบข้อมูลขาออกของสมอง Vex — ไม่ผูกกับแพลตฟอร์ม
 * ท่อแต่ละทาง (kiki-bot.mjs ของ Telegram · ท่อ Discord ในเฟส 1) เอาไปแปลงเป็นรูปแบบของตัวเอง
 */
export interface Send {
  kind: "text" | "document" | "photo" | "voice" | "video";
  text?: string;
  filename?: string;
  caption?: string;
  dataBase64?: string;
  parseMode?: "HTML" | "Markdown";
  noPreview?: boolean; // ไม่ให้ Telegram เด้ง link preview (ลิงก์ Google Calendar ฯลฯ)
  // reply ไปที่ข้อความไหน — Telegram เป็นตัวเลข · Discord เป็น snowflake 19 หลักที่ต้องคงเป็นสตริง
  // (Number() จะทำให้ค่าเพี้ยนเพราะเกิน MAX_SAFE_INTEGER แล้ว reply ไปผิดข้อความ)
  replyTo?: number | string;
  buttons?: { text: string; data: string }[][]; // ปุ่มกดยืนยัน (แทนการพิมพ์ "ยืนยัน")
  chatId?: string; // ส่งไปแชทอื่น (เช่น ทักในกลุ่มที่เพิ่งสร้าง) — ไม่ใส่ = แชทเดิม
}

export const ok = (sends: Send[]) => NextResponse.json({ sends });

/**
 * บริบทของข้อความหนึ่งข้อความ — ส่งต่อให้ตัวจัดการทุกตัว
 *
 * ทำไมต้องมี: เดิม 56 สาขาอยู่ในฟังก์ชัน POST ก้อนเดียว 1,400 บรรทัด ใช้ตัวแปรร่วมกันผ่านสโคป
 * พอจะเพิ่มช่องทางที่สอง (Discord) + งานเชิงรุก การแก้อะไรก็ต้องไล่อ่านทั้งก้อน
 * Ctx ทำให้ตัวจัดการแต่ละตัวรับของที่ต้องใช้อย่างชัดเจน ย้ายไปอยู่ไฟล์ไหนก็ได้
 */
export interface Ctx {
  // ===== ข้อมูลขาเข้า =====
  chatId: string;
  text: string;
  fromId: string;
  fromName: string;
  platform: string; // ระบบบัญชี — ใช้เช็คสิทธิ์ (telegram | discord)
  channel: string; // สื่อ — ใช้ติดป้ายในประวัติ (telegram | discord | discord-voice)
  replyText: string;
  imageFiles: string[];
  audioFiles: { path: string; mime?: string }[];
  docFiles: { path: string; name: string }[];
  videoFiles: { path: string; name: string }[];
  msgId?: number | string;
  callbackData: string;
  voiceNote: string; // ข้อความที่ถอดมาจากเสียงที่เจ้าของอัดส่งมา (ว่าง = พิมพ์มา)
  /** กำลัง reply "ภาพหน้าจอเครื่อง" ที่ Vex แคปมาให้ — คำว่าห้อง/ช่อง/แท็บ หมายถึงของในภาพนั้น ไม่ใช่กลุ่มแชท */
  replyIsScreenshot: boolean;
  justBound: boolean; // เพิ่งผูกเจ้าของในข้อความนี้เอง

  // ===== ผลจากตัวอ่านเจตนา =====
  route: RouteResult;
  is: (id: string) => boolean; // เจตนาตรง + มั่นใจพอ
  arg: (k: string) => string; // ค่าที่ตัวอ่านเจตนาสกัดมาให้

  // ===== ของที่คำนวณไว้ให้ใช้ร่วมกัน =====
  urls: string[]; // ลิงก์ในข้อความ + ในข้อความที่ reply ถึง

  // ===== ตัวช่วย =====
  /** ส่งคำตอบกลับ — บันทึกประวัติ ซอยบับเบิล แนบเสียง และเติมงานที่ผูกเงื่อนไขให้เอง */
  reply: (sends: Send[]) => Promise<NextResponse>;
  /** เตือนงานที่ผูกเงื่อนไขไว้ — ต่อท้ายคำตอบของเส้นทางไหนก็ได้ */
  setTriggerNote: (note: string) => void;
}

/**
 * ตัวจัดการหนึ่งเส้นทาง
 * คืน NextResponse = รับงานนี้แล้ว จบ · คืน null = ไม่ใช่งานของฉัน ไปตัวถัดไป
 */
export type Handler = (ctx: Ctx) => Promise<NextResponse | null>;
