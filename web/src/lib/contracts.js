// ตัวช่วยเรื่องสัญญาเช่า: ระยะสัญญาตั้งต้น, คำนวณวันที่, สถานะเวลา
import { todayISO } from './format'

/**
 * ระยะสัญญาตั้งต้นตามรอบค่าเช่าของแผง (ผู้ใช้กำหนด) — แก้ได้ทุกครั้งในฟอร์ม
 * รายปี (อาคาร OTOP) = 3 ปี · รายเดือน (ตลาด) = 1 ปี
 */
export const TERM_YEARS = { yearly: 3, monthly: 1 }

/** สัญญาที่เหลือไม่เกินกี่วันถือว่า "ใกล้หมดอายุ" */
export const EXPIRING_DAYS = 30

const toDate = (iso) => new Date(`${iso}T00:00:00Z`)
const toISO = (d) => d.toISOString().slice(0, 10)
export const isISODate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '') && !Number.isNaN(toDate(v).getTime())

/** '2026-10-31' + 1 วัน → '2026-11-01' */
export function addDays(iso, n) {
  const d = toDate(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return toISO(d)
}

/** จำนวนวันจาก a ถึง b (b - a) */
export function daysBetween(a, b) {
  return Math.round((toDate(b) - toDate(a)) / 86_400_000)
}

/** วันสิ้นสุดตั้งต้น: เริ่ม 1 พ.ย. 2569 + 3 ปี → 31 ต.ค. 2572 (วันก่อนครบรอบ) */
export function defaultEndDate(startISO, rentPeriod) {
  if (!isISODate(startISO)) return ''
  const years = TERM_YEARS[rentPeriod] ?? 1
  const [y, m, d] = startISO.split('-').map(Number)
  return addDays(toISO(new Date(Date.UTC(y + years, m - 1, d))), -1)
}

/** ระยะสัญญาเป็นคำ: "3 ปี", "1 ปี 6 เดือน", "6 เดือน", "45 วัน" */
export function termLabel(start, end) {
  if (!isISODate(start) || !isISODate(end) || end < start) return ''
  const next = addDays(end, 1)
  const [y1, m1, d1] = start.split('-').map(Number)
  const [y2, m2, d2] = next.split('-').map(Number)
  if (d1 === d2) {
    const months = (y2 - y1) * 12 + (m2 - m1)
    if (months > 0) {
      const y = Math.floor(months / 12)
      const m = months % 12
      return [y && `${y} ปี`, m && `${m} เดือน`].filter(Boolean).join(' ')
    }
  }
  return `${daysBetween(start, next)} วัน`
}

/**
 * สถานะเวลาของสัญญาที่ใช้งาน
 * upcoming = ยังไม่ถึงวันเริ่ม · running = ปกติ · expiring = เหลือ ≤ 30 วัน · overdue = เลยวันสิ้นสุดแล้ว (รอกดปิด)
 */
export function contractTiming(c, today = todayISO()) {
  if (c.status !== 'active') return null
  if (c.start_date > today) return { kind: 'upcoming', days: daysBetween(today, c.start_date) }
  if (c.end_date < today) return { kind: 'overdue', days: daysBetween(c.end_date, today) }
  const left = daysBetween(today, c.end_date)
  return { kind: left <= EXPIRING_DAYS ? 'expiring' : 'running', days: left }
}

/** สัญญาต่ออายุที่ยังมีผล (รออนุมัติ/ใช้งาน/สิ้นสุด) ของสัญญานี้ ถ้ามี */
export function liveRenewalOf(contract, all) {
  return all.find((c) => c.renewed_from_id === contract.contract_id && ['pending', 'active', 'expired'].includes(c.status)) ?? null
}

/** แปลง error ของฐานข้อมูลตอนบันทึกสัญญาเป็นข้อความที่บอกว่าต้องแก้อะไร */
export function contractProblem(error) {
  const text = `${error?.message ?? ''} ${error?.details ?? ''}`
  if (error?.code === '23P01') return 'ช่วงวันที่ทับกับสัญญาอื่นที่ใช้งานอยู่ของแผงนี้ ให้ปรับวันเริ่ม/วันสิ้นสุด'
  if (/contracts_one_pending_per_stall/.test(text)) return 'แผงนี้มีคำขอที่รออนุมัติอยู่แล้ว 1 รายการ ให้พิจารณาคำขอนั้นก่อน'
  if (/contracts_one_renewal_per_contract/.test(text)) return 'สัญญานี้มีคำขอต่ออายุหรือสัญญาต่ออายุอยู่แล้ว'
  if (/contracts_date_order/.test(text)) return 'วันสิ้นสุดต้องอยู่หลังวันเริ่มสัญญา'
  return null
}
