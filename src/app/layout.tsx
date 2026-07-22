import type { Metadata } from "next";
import { Noto_Sans_Thai, Poppins } from "next/font/google";
import "./globals.css";

// ฟอนต์ไทย + Latin body (ครอบคลุมทั้งไทยและอังกฤษ)
const notoThai = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-thai",
  display: "swap",
});

// Display/heading (Latin) — ใช้แทน Olimpico จนกว่าจะวางไฟล์ฟอนต์จริงใน /public/fonts
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Changoh System — ระบบบริหารทุนวิจัย",
  description: "ระบบบริหารทุนวิจัย OKR และเลขา AI สำหรับงานวิจัย มหาวิทยาลัยขอนแก่น",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" suppressHydrationWarning className={`${notoThai.variable} ${poppins.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
