import { FunctionsHttpError } from '@supabase/supabase-js'
import { functionUrl, supabase } from './supabase'

// เบราว์เซอร์ไปไม่ถึงฟังก์ชัน หรือคำตอบไม่มี CORS (ไม่พบฟังก์ชัน / ฟังก์ชันพังตอนเริ่ม / ถูกปฏิเสธก่อนถึงฟังก์ชัน)
// หน้าเว็บอ่านสาเหตุจริงไม่ได้ จึงบอกที่อยู่ให้เปิดดูเองในแท็บใหม่
const unreachable = () =>
  `เรียก Edge Function "admin-users" ไม่ได้ — ตรวจโดยเปิด ${functionUrl('admin-users')} ในแท็บใหม่ แล้วดูตาราง "แก้ปัญหา" ใน README ขั้นที่ 4`

/**
 * เรียก Edge Function admin-users (สร้างบัญชีเจ้าหน้าที่ / ตั้งรหัสผ่านใหม่)
 * สำเร็จคืนข้อมูลที่ฟังก์ชันตอบ · ไม่สำเร็จ throw Error พร้อมข้อความภาษาไทย
 */
export async function callAdminUsers(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (!error) return data

  if (error instanceof FunctionsHttpError) {
    const response = error.context
    let payload = null
    try {
      payload = await response.json()
    } catch {
      // ไม่ใช่ JSON
    }
    // ข้อความภาษาไทยจากฟังก์ชันของเราเอง
    if (payload?.error) throw new Error(payload.error)
    if (response.status === 404) throw new Error(unreachable())
    if (response.status === 401) {
      throw new Error('Edge Function ปฏิเสธการเข้าถึง (401) — ลองออกจากระบบแล้วเข้าใหม่ ถ้ายังไม่ได้ ดู README ขั้นที่ 4 หัวข้อแก้ปัญหา')
    }
    throw new Error(`Edge Function ตอบกลับผิดพลาด (HTTP ${response.status})`)
  }
  // FunctionsFetchError / FunctionsRelayError: ไปไม่ถึงฟังก์ชัน
  throw new Error(unreachable())
}

/** รหัสผ่านชั่วคราวแบบสุ่ม 10 ตัว (ตัด 0 O 1 l I ที่อ่านสับสนออก) */
export function randomPassword(length = 10) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint32Array(length))
  return Array.from(bytes, (n) => chars[n % chars.length]).join('')
}
