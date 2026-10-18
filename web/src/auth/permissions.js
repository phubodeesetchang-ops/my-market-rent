// สิทธิ์ฝั่งหน้าเว็บ ใช้ซ่อน/แสดงปุ่มและเมนูเท่านั้น
// การป้องกันจริงอยู่ที่ RLS ในฐานข้อมูล (migration 002) — ตารางนี้ต้องตรงกับ RLS

const RULES = {
  // ตลาด / โซน / อัตราน้ำไฟ / ค่าธรรมเนียม
  manageMarketSettings: ['admin'],
  // แผง, ผู้เช่า, สัญญา, จดมิเตอร์, ใบแจ้งหนี้, ตรวจสลิป, ออกใบเสร็จ
  manageOperations: ['admin', 'staff'],
  // ผู้ใช้ระบบ
  manageUsers: ['admin'],
  // ลบข้อมูล
  deleteRecords: ['admin'],
  // ดูเลขบัตรประชาชนผู้เช่า
  viewIdCard: ['admin', 'staff'],
}

export function can(role, action) {
  return Boolean(role && RULES[action]?.includes(role))
}
