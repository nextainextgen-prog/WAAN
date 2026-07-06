import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // โหลดจาก node_modules ตรงๆ ไม่ให้ bundler ย้าย path ของไฟล์ข้อมูล (เช่น .afm ของ pdfkit)
  serverExternalPackages: ["pdfkit", "pptxgenjs", "pdfjs-dist", "pdf-lib", "mammoth"],
};

export default nextConfig;
