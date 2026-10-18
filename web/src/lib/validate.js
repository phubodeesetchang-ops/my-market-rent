// ตรวจรูปแบบข้อมูลที่กรอกในฟอร์ม (ฝั่งหน้าเว็บ) — คืนข้อความภาษาไทย หรือ '' ถ้าถูกต้อง

/** เก็บเฉพาะตัวเลข: '081-234 5678' → '0812345678' · เลขไทยจากแป้นพิมพ์ไทย '๐๘๑…' แปลงเป็นเลขอารบิกก่อน */
export const digitsOnly = (value) =>
  String(value ?? '')
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/\D/g, '')

/** เลขบัตรประชาชน 13 หลัก พร้อมตรวจหลักสุดท้าย (check digit) ตามสูตรของกรมการปกครอง */
export function isValidThaiId(value) {
  const d = digitsOnly(value)
  if (!/^\d{13}$/.test(d)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i)
  return (11 - (sum % 11)) % 10 === Number(d[12])
}

export function thaiIdProblem(value) {
  const d = digitsOnly(value)
  if (!d) return 'กรุณากรอกเลขบัตรประชาชน'
  if (d.length !== 13) return `เลขบัตรประชาชนต้องมี 13 หลัก (กรอกมา ${d.length} หลัก)`
  if (!isValidThaiId(d)) return 'เลขบัตรประชาชนไม่ถูกต้อง ตรวจสอบตัวเลขอีกครั้ง'
  return ''
}

/** เบอร์โทรไทย: มือถือ 10 หลัก หรือเบอร์บ้าน 9 หลัก ขึ้นต้นด้วย 0 */
export function phoneProblem(value, { required = true } = {}) {
  const d = digitsOnly(value)
  if (!d) return required ? 'กรุณากรอกเบอร์โทร' : ''
  if (!/^0\d{8,9}$/.test(d)) return 'เบอร์โทรต้องขึ้นต้นด้วย 0 และมี 9–10 หลัก'
  return ''
}

export function requiredProblem(value, label) {
  return String(value ?? '').trim() ? '' : `กรุณากรอก${label}`
}

/** จำนวนเงิน/ตัวเลข ≥ 0 (min) — ช่องว่างคืน null ถ้า optional */
export function numberProblem(value, label, { required = false, min = 0, positive = false } = {}) {
  const text = String(value ?? '').trim()
  if (!text) return required ? `กรุณากรอก${label}` : ''
  const n = Number(text.replaceAll(',', ''))
  if (!Number.isFinite(n)) return `${label}ต้องเป็นตัวเลข`
  if (positive && n <= 0) return `${label}ต้องมากกว่า 0`
  if (n < min) return `${label}ต้องไม่ติดลบ`
  return ''
}

/** แปลงข้อความในช่องตัวเลขเป็นค่าที่จะบันทึก ('' → null) */
export function toNumberOrNull(value) {
  const text = String(value ?? '').trim().replaceAll(',', '')
  return text === '' ? null : Number(text)
}

/** อีเมลรูปแบบพื้นฐาน (ตรงกับที่ Edge Function ตรวจ) */
export function emailProblem(value) {
  const v = String(value ?? '').trim()
  if (!v) return 'กรุณากรอกอีเมล'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'รูปแบบอีเมลไม่ถูกต้อง'
  return ''
}

/** ลบช่องที่ไม่มีปัญหาออก → {} แปลว่าผ่านทั้งหมด */
export function collectProblems(entries) {
  return Object.fromEntries(Object.entries(entries).filter(([, msg]) => msg))
}

/** ลบข้อความผิดพลาดของช่องที่ผู้ใช้กำลังแก้ (ใช้ใน setErrors) */
export function clearProblem(key) {
  return (errors) => {
    if (!errors[key]) return errors
    const next = { ...errors }
    delete next[key]
    return next
  }
}
