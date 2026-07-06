import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { db } from "./db";

const COOKIE = "changoh_session";
const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET || "changoh-dev-secret-change-me",
);

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export async function createSession(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return {
      id: payload.id as string,
      email: payload.email as string,
      name: payload.name as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

// อ่าน session จาก cookie (ใช้ใน Server Components / Route Handlers)
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export const SESSION_COOKIE = COOKIE;

// ตรวจ service token สำหรับการเรียกภายใน (เช่น Telegram poller)
export function isServiceRequest(req: Request): boolean {
  const t = req.headers.get("x-internal-token");
  const secret = process.env.INTERNAL_API_TOKEN;
  return Boolean(t && secret && t === secret);
}

// อนุญาตถ้าเป็นผู้ใช้ที่ login หรือเป็น service ภายใน
export async function requireUserOrService(req: Request): Promise<boolean> {
  if (isServiceRequest(req)) return true;
  return Boolean(await getCurrentUser());
}
