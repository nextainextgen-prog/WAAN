import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // อนุญาต dev resource ข้าม origin — จำเป็นเวลาเข้าเว็บผ่าน cloudflared tunnel (ไม่งั้น next dev บล็อก → หน้าไม่ hydrate กดไม่ติด)
  // ใช้ wildcard เพราะ quick tunnel เปลี่ยน subdomain ทุกครั้งที่รันใหม่
  allowedDevOrigins: ["*.trycloudflare.com", "localhost", "127.0.0.1"],
  turbopack: {
    root: path.resolve(__dirname),
  },
  // โหลดจาก node_modules ตรงๆ ไม่ให้ bundler ย้าย path ของไฟล์ข้อมูล (เช่น .afm ของ pdfkit)
  serverExternalPackages: ["pdfkit", "pptxgenjs", "pdfjs-dist", "pdf-lib", "mammoth", "playwright", "@napi-rs/canvas", "better-sqlite3", "sqlite-vec"],
};

export default nextConfig;
