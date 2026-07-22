// หน้าเว็บฟอร์มคืนเงิน — เปิดสาธารณะ (ไม่ต้อง login) เข้าถึงผ่านลิงก์ tunnel ได้ทุกคน
// แยกจากตัวแอปหลัก (ไม่มี Sidebar/Topbar) · การเข้าถึง = รู้ลิงก์ (แชร์ในกลุ่มแอดมิน)
export default function RefundLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background">{children}</div>;
}
