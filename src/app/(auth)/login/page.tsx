"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, LogIn, Eye, EyeOff, ShieldCheck, KanbanSquare, Bot } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "เข้าสู่ระบบไม่สำเร็จ");
        setLoading(false);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("เกิดข้อผิดพลาดในการเชื่อมต่อ");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Brand panel */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-primary text-primary-foreground relative overflow-hidden">
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-white/5 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid place-items-center h-11 w-11 rounded-xl bg-white/15 backdrop-blur">
            <GraduationCap className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <p className="font-display font-semibold text-lg">Changoh System</p>
            <p className="text-sm text-white/70">ระบบบริหารทุนวิจัย · มหาวิทยาลัยขอนแก่น</p>
          </div>
        </div>

        <div className="relative space-y-6">
          <h1 className="font-display text-3xl font-semibold leading-snug">
            บริหารทุนวิจัยทั้งหมด
            <br />
            ในที่เดียว
          </h1>
          <ul className="space-y-3 text-white/85">
            {[
              { icon: KanbanSquare, t: "ติดตามสถานะทุนวิจัยทุกทุนแบบ Kanban" },
              { icon: ShieldCheck, t: "แดชบอร์ด OKR เทียบเป้ากับผลจริง" },
              { icon: Bot, t: "เลขา AI ช่วยตอบ ตามงาน และสร้างสไลด์" },
            ].map(({ icon: Icon, t }) => (
              <li key={t} className="flex items-center gap-3">
                <span className="grid place-items-center h-8 w-8 rounded-lg bg-white/15">
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="text-sm">{t}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/50">© 2026 Changoh System</p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6 sm:p-12 bg-background">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <span className="grid place-items-center h-11 w-11 rounded-xl bg-primary text-primary-foreground">
              <GraduationCap className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <p className="font-display font-semibold text-lg text-foreground">Changoh System</p>
              <p className="text-xs text-muted-foreground">ระบบบริหารทุนวิจัย</p>
            </div>
          </div>

          <h2 className="font-display text-2xl font-semibold text-foreground">เข้าสู่ระบบ</h2>
          <p className="text-sm text-muted-foreground mt-1.5 mb-7">
            กรอกอีเมลและรหัสผ่านเพื่อเข้าใช้งาน
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="อีเมล" htmlFor="email" required>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@kku.ac.th"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>

            <Field label="รหัสผ่าน" htmlFor="password" required>
              <div className="relative">
                <Input
                  id="password"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                >
                  {show ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                </button>
              </div>
            </Field>

            {error && (
              <div
                role="alert"
                className="text-sm text-danger bg-danger-soft border border-danger/15 rounded-[11px] px-3.5 py-2.5"
              >
                {error}
              </div>
            )}

            <Button type="submit" size="lg" loading={loading} className="w-full mt-2">
              {!loading && <LogIn className="h-4.5 w-4.5" aria-hidden />}
              เข้าสู่ระบบ
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
