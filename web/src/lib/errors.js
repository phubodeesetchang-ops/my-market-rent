// แปลง error จาก Supabase เป็นข้อความภาษาไทยที่ผู้ใช้อ่านแล้วรู้ว่าต้องทำอะไรต่อ
//
// error ที่ฐานข้อมูลส่งมาจาก raise exception ใน migration 002 เป็นภาษาไทยอยู่แล้ว
// (เช่น "แผงนี้ไม่ว่าง (สถานะ: จอง)") จึงแสดงข้อความนั้นตรง ๆ

const AUTH_MESSAGES = {
  invalid_credentials: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  email_not_confirmed: 'บัญชีนี้ยังไม่ได้ยืนยันอีเมล ติดต่อผู้ดูแลระบบ',
  user_banned: 'บัญชีนี้ถูกระงับการใช้งาน',
  over_request_rate_limit: 'ลองเข้าสู่ระบบหลายครั้งเกินไป รอสักครู่แล้วลองใหม่',
  over_email_send_rate_limit: 'ส่งอีเมลบ่อยเกินไป รอสักครู่แล้วลองใหม่',
}

const PG_MESSAGES = {
  '23505': 'มีข้อมูลนี้อยู่แล้ว (ข้อมูลซ้ำ)',
  '23503': 'ข้อมูลนี้ถูกใช้อ้างอิงอยู่ จึงลบหรือแก้ไม่ได้',
  '23514': 'ข้อมูลไม่ถูกต้องตามเงื่อนไขของระบบ',
  '23502': 'ข้อมูลไม่ครบ กรุณากรอกช่องที่จำเป็นให้ครบ',
  '23P01': 'ช่วงวันที่ทับกับข้อมูลที่มีอยู่แล้ว',
  '42501': 'คุณไม่มีสิทธิ์ทำรายการนี้',
  PGRST301: 'การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่',
}

// ฐานข้อมูลยังไม่มีฟังก์ชัน/ตาราง/คอลัมน์ที่หน้าเว็บรุ่นนี้ใช้ = ยังไม่ได้รัน migration ล่าสุด
const OUTDATED_DB = new Set(['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703'])

const hasThai = (s) => /[฀-๿]/.test(s ?? '')

export function thaiError(error) {
  if (!error) return ''
  const message = error.message ?? String(error)

  // ข้อความภาษาไทยจากฐานข้อมูลของเราเอง
  if (hasThai(message)) return message

  if (error.code && AUTH_MESSAGES[error.code]) return AUTH_MESSAGES[error.code]
  if (/invalid login credentials/i.test(message)) return AUTH_MESSAGES.invalid_credentials

  if (OUTDATED_DB.has(error.code)) {
    return 'ฐานข้อมูลยังไม่ได้อัปเดตเป็นรุ่นล่าสุด — ให้ผู้ดูแลระบบรัน migration ใหม่ใน Supabase (ดู README)'
  }
  if (/row-level security/i.test(message)) return PG_MESSAGES['42501']
  if (error.code && PG_MESSAGES[error.code]) return PG_MESSAGES[error.code]

  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'
  }
  return `เกิดข้อผิดพลาด: ${message}`
}
