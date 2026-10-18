// ตัวช่วยแสดงผลในหน้าผู้เช่า (LIFF)
import { todayISO } from './format'
import { outstandingOf, paidOf, pendingCountOf } from './payments'
import { stallTitle } from './stalls'

/** "ตลาดเย็น · แผง B002" */
export function stallLine(stall) {
  if (!stall) return '-'
  const market = stall.zones?.markets?.market_name
  return market ? `${market} · ${stallTitle(stall)}` : stallTitle(stall)
}

/** สถานะใบแจ้งหนี้ที่ผู้เช่าเห็น: paid | checking | overdue | partial | unpaid */
export function invoiceState(inv, today = todayISO()) {
  if (inv.status === 'paid') return 'paid'
  if (inv.status === 'cancelled') return 'cancelled'
  if (pendingCountOf(inv) > 0) return 'checking'
  if (inv.due_date < today) return 'overdue'
  if (paidOf(inv) > 0) return 'partial'
  return 'unpaid'
}

/** ใบแจ้งหนี้ที่ยังต้องจ่าย (รอชำระและยังมียอดคงค้าง) */
export const isOwing = (inv) => inv.status === 'unpaid' && outstandingOf(inv) > 0
