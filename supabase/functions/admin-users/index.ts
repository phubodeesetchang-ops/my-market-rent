// =====================================================================
//  Edge Function: admin-users
//  สร้างบัญชีเจ้าหน้าที่ และตั้งรหัสผ่านใหม่ — เฉพาะผู้ดูแลระบบ (admin) ที่ใช้งานอยู่
//
//  เรียกจากหน้าเว็บ:
//    supabase.functions.invoke('admin-users', { body: { action: 'create', email, password, username, full_name, role, phone } })
//    supabase.functions.invoke('admin-users', { body: { action: 'set_password', user_id, password } })
//
//  ความปลอดภัย
//  - ตั้งชื่อ (slug) ตอน deploy เป็น admin-users — เปลี่ยนภายหลังไม่ได้
//  - ปิด "Verify JWT with legacy secret" (ตามที่ Dashboard แนะนำ) เพราะตรวจเฉพาะ token แบบเก่า
//  - ฟังก์ชันนี้ตรวจเองทุกครั้ง: ส่ง token ไปถาม Supabase Auth แล้วเช็กว่าเป็น admin ที่ใช้งานอยู่ในตาราง users
//  - ใช้ secret key (bypass RLS) เฉพาะในฟังก์ชันนี้เท่านั้น ห้ามนำไปใส่ในหน้าเว็บ
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ROLES = ['admin', 'staff', 'manager']

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/** secret key แบบใหม่ (sb_secret_...) ถ้ามี ไม่งั้นใช้ service_role รุ่นเก่า */
function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>
    const key = keys.default ?? Object.values(keys)[0]
    if (typeof key === 'string' && key.length > 0) return key
  } catch {
    // ไม่มีหรืออ่านไม่ได้ → ใช้คีย์รุ่นเก่า
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  throw new Error('ไม่พบ secret key ใน Edge Function')
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'ใช้ได้เฉพาะ POST' })
  try {
    return await handle(req)
  } catch (e) {
    // ตอบเป็น JSON พร้อม CORS เสมอ ไม่งั้นเบราว์เซอร์จะเห็นเป็น error เครือข่ายที่อ่านไม่ออก
    console.error(e)
    return json(500, { error: `เกิดข้อผิดพลาดในระบบ: ${(e as Error).message}` })
  }
})

async function handle(req: Request): Promise<Response> {

  let admin
  try {
    admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', secretKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  } catch (e) {
    return json(500, { error: (e as Error).message })
  }

  // 1) ผู้เรียกต้อง login และเป็น admin ที่ใช้งานอยู่
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: 'กรุณาเข้าสู่ระบบ' })
  const { data: caller, error: callerError } = await admin.auth.getUser(token)
  if (callerError || !caller?.user) return json(401, { error: 'การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่' })

  const { data: me } = await admin
    .from('users')
    .select('role, status')
    .eq('user_id', caller.user.id)
    .maybeSingle()
  if (!me || me.role !== 'admin' || me.status !== 'active') {
    return json(403, { error: 'เฉพาะผู้ดูแลระบบเท่านั้น' })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' })
  }

  // 2) สร้างบัญชีเจ้าหน้าที่: auth.users + public.users
  if (body.action === 'create') {
    const email = text(body.email).toLowerCase()
    const password = typeof body.password === 'string' ? body.password : ''
    const username = text(body.username)
    const fullName = text(body.full_name)
    const role = text(body.role)
    const phone = text(body.phone) || null

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'รูปแบบอีเมลไม่ถูกต้อง' })
    if (password.length < 8) return json(400, { error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' })
    if (!username) return json(400, { error: 'กรุณากรอกชื่อผู้ใช้' })
    if (!fullName) return json(400, { error: 'กรุณากรอกชื่อ-นามสกุล' })
    if (!ROLES.includes(role)) return json(400, { error: 'บทบาทไม่ถูกต้อง' })

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createError || !created?.user) {
      const exists = /already|registered|exists/i.test(createError?.message ?? '')
      return json(400, { error: exists ? 'อีเมลนี้มีบัญชีอยู่แล้ว' : `สร้างบัญชีไม่สำเร็จ: ${createError?.message}` })
    }

    const { error: insertError } = await admin
      .from('users')
      .insert({ user_id: created.user.id, username, full_name: fullName, role, phone, email })
    if (insertError) {
      // ย้อนกลับ: ลบบัญชี auth ที่เพิ่งสร้าง ไม่ให้เหลือบัญชีครึ่ง ๆ
      await admin.auth.admin.deleteUser(created.user.id)
      const duplicate = insertError.code === '23505'
      return json(400, { error: duplicate ? 'ชื่อผู้ใช้นี้มีอยู่แล้ว' : `บันทึกข้อมูลผู้ใช้ไม่สำเร็จ: ${insertError.message}` })
    }
    return json(200, { user_id: created.user.id })
  }

  // 3) ตั้งรหัสผ่านใหม่ให้เจ้าหน้าที่ (เฉพาะบัญชีที่อยู่ในตาราง users)
  if (body.action === 'set_password') {
    const userId = text(body.user_id)
    const password = typeof body.password === 'string' ? body.password : ''
    if (password.length < 8) return json(400, { error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' })
    if (!UUID.test(userId)) return json(404, { error: 'ไม่พบบัญชีเจ้าหน้าที่นี้' })

    const { data: target } = await admin.from('users').select('user_id').eq('user_id', userId).maybeSingle()
    if (!target) return json(404, { error: 'ไม่พบบัญชีเจ้าหน้าที่นี้' })

    const { error } = await admin.auth.admin.updateUserById(userId, { password })
    if (error) return json(400, { error: `ตั้งรหัสผ่านไม่สำเร็จ: ${error.message}` })
    return json(200, { ok: true })
  }

  return json(400, { error: 'ไม่รู้จักคำสั่งนี้' })
}
