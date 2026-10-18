// ป้ายภาษาไทยของค่า ENUM ในฐานข้อมูล (ต้องตรงกับ CHECK constraint ใน migration 001)

export const ROLE = {
  admin: 'ผู้ดูแลระบบ',
  staff: 'เจ้าหน้าที่',
  manager: 'ผู้บริหาร',
}

export const ACTIVE_STATUS = {
  active: 'ใช้งาน',
  inactive: 'ระงับ',
}

export const MARKET_TYPE = {
  market: 'ตลาดแผงค้า',
  building: 'อาคาร',
}

export const UNIT_TYPE = {
  stall: 'แผง',
  room: 'ห้อง',
}

export const RENT_PERIOD = {
  monthly: 'รายเดือน',
  yearly: 'รายปี',
}

export const STALL_STATUS = {
  vacant: 'ว่าง',
  reserved: 'จอง',
  rented: 'เช่า',
  maintenance: 'ซ่อมบำรุง',
}

// ลำดับที่ใช้แสดงในคำอธิบายสี
export const STALL_STATUS_ORDER = ['vacant', 'reserved', 'rented', 'maintenance']

export const CONTRACT_STATUS = {
  pending: 'รออนุมัติ',
  active: 'ใช้งาน',
  expired: 'สิ้นสุด',
  cancelled: 'ยกเลิก',
  rejected: 'ไม่อนุมัติ',
}

export const UTILITY_TYPE = {
  electricity: 'ไฟฟ้า',
  water: 'น้ำ',
}

export const FEE_PERIOD = {
  monthly: 'รายเดือน',
  yearly: 'รายปี',
  once: 'ครั้งเดียว',
}

export const INVOICE_STATUS = {
  unpaid: 'รอชำระ',
  paid: 'ชำระแล้ว',
  cancelled: 'ยกเลิก',
  overdue: 'เกินกำหนด', // ไม่ได้เก็บในฐานข้อมูล: คำนวณจาก unpaid + เลย due_date
}

export const PAYMENT_METHOD = {
  cash: 'เงินสด',
  transfer: 'โอนเงิน',
  promptpay: 'PromptPay',
}

export const PAYMENT_STATUS = {
  pending: 'รอตรวจสอบ',
  verified: 'ตรวจสอบแล้ว',
  rejected: 'ไม่ผ่าน',
}

export function label(map, value) {
  return map[value] ?? value ?? '-'
}
