// ตัวช่วยแสดงผลแบบไทย: วันที่ พ.ศ., รอบบิล, จำนวนเงิน

const TZ = 'Asia/Bangkok'

const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const MONTHS_LONG = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

const thaiCollator = new Intl.Collator('th')
/** เรียงข้อความภาษาไทยตามพจนานุกรม (สระหน้า เ แ โ ใ ไ ไม่ไปกองท้ายรายการ) */
export const compareThai = (a, b) => thaiCollator.compare(a ?? '', b ?? '')

const bahtFormatter =new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const numberFormatter = new Intl.NumberFormat('th-TH')

/** 1250.5 → "1,250.50 บาท" */
export function formatBaht(amount, { withUnit = true } = {}) {
  if (amount === null || amount === undefined || amount === '') return '-'
  const text = bahtFormatter.format(Number(amount))
  return withUnit ? `${text} บาท` : text
}

/** 1250 → "1,250" */
export function formatNumber(n) {
  if (n === null || n === undefined) return '-'
  return numberFormatter.format(Number(n))
}

/** แยกวันที่จากค่าของฐานข้อมูล ('2026-10-18' หรือ timestamptz) เป็น {y, m, d} ตามเวลาไทย */
function toThaiParts(value) {
  if (!value) return null
  // คอลัมน์ date ('YYYY-MM-DD') ไม่มีเวลา ห้ามแปลง timezone ไม่งั้นวันจะเลื่อน
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) return { y: +dateOnly[1], m: +dateOnly[2], d: +dateOnly[3] }
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(value))
  const get = (t) => +parts.find((p) => p.type === t).value
  return { y: get('year'), m: get('month'), d: get('day') }
}

/** '2026-10-18' → "18 ต.ค. 2569" (long: "18 ตุลาคม 2569") */
export function formatDate(value, { long = false } = {}) {
  const p = toThaiParts(value)
  if (!p) return '-'
  const months = long ? MONTHS_LONG : MONTHS_SHORT
  return `${p.d} ${months[p.m - 1]} ${p.y + 543}`
}

/** timestamptz → "18 ต.ค. 2569 14:05 น." */
export function formatDateTime(value) {
  if (!value) return '-'
  const time = new Intl.DateTimeFormat('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(value))
  return `${formatDate(value)} ${time} น.`
}

/** รอบบิล '2026-10' → "ต.ค. 2569" (long: "ตุลาคม 2569") */
export function formatPeriod(period, { long = false } = {}) {
  const m = /^(\d{4})-(\d{2})$/.exec(period ?? '')
  if (!m) return period ?? '-'
  const months = long ? MONTHS_LONG : MONTHS_SHORT
  return `${months[+m[2] - 1]} ${+m[1] + 543}`
}

/** วันนี้ตามเวลาไทย เป็นรูปแบบฐานข้อมูล 'YYYY-MM-DD' */
export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

/** รอบบิลปัจจุบัน 'YYYY-MM' */
export function currentPeriod() {
  return todayISO().slice(0, 7)
}

/** วันแรกของเดือนถัดไป 'YYYY-MM-01' (ค่าเริ่มต้นของวันเริ่มใช้อัตราใหม่) */
export function firstOfNextMonth() {
  const [y, m] = todayISO().split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/** เบอร์โทร '0812345678' → "081-234-5678", '021234567' → "02-123-4567" */
export function formatPhone(phone) {
  if (!phone) return '-'
  const d = String(phone).replace(/\D/g, '')
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 9 && d.startsWith('02')) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`
  if (d.length === 9) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
  return phone
}

/** เลขบัตรประชาชนเต็ม '1234567890123' → "1-2345-67890-12-3" */
export function formatIdCard(id) {
  if (!id) return '-'
  const s = String(id).replace(/\D/g, '')
  if (s.length !== 13) return id
  return `${s[0]}-${s.slice(1, 5)}-${s.slice(5, 10)}-${s.slice(10, 12)}-${s[12]}`
}

/** ปิดบังเลขบัตรประชาชน 1234567890123 → "1-2345-xxxxx-xx-3" */
export function maskIdCard(id) {
  if (!id) return '-'
  const s = String(id).replace(/\D/g, '')
  if (s.length !== 13) return 'x'.repeat(Math.max(0, s.length - 2)) + s.slice(-2)
  return `${s[0]}-${s.slice(1, 5)}-xxxxx-xx-${s[12]}`
}
