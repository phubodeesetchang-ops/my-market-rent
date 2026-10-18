// ตัวช่วยรอบบิลและใบแจ้งหนี้
import { todayISO } from './format'

export const isPeriod = (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p ?? '')

/** รอบบิลถัดไป/ก่อนหน้า '2026-12' → '2027-01' */
export function shiftPeriod(period, months) {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + months, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** วันครบกำหนดตั้งต้น: วันที่ 5 ของเดือนถัดจากรอบบิล ('2026-10' → '2026-11-05') */
export const DUE_DAY = 5
export function defaultDueDate(period) {
  return `${shiftPeriod(period, 1)}-${String(DUE_DAY).padStart(2, '0')}`
}

/** สถานะที่แสดง: ใบที่รอชำระและเลยวันครบกำหนดแล้ว = เกินกำหนด */
export function invoiceState(inv, today = todayISO()) {
  if (inv.status === 'unpaid' && inv.due_date < today) return 'overdue'
  return inv.status
}

/** หน่วยที่ใช้ × อัตรา (ปัดสตางค์แบบเดียวกับฐานข้อมูล) */
export function utilityCost(previous, current, rate) {
  if (previous === null || current === null || rate === null || current < previous) return null
  return Math.round((current - previous) * rate * 100) / 100
}
