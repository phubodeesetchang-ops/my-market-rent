// =====================================================================
//  Edge Function: line-auth
//  ผู้เช่าเข้าระบบด้วย LINE (LIFF) โดยไม่ต้องมีรหัสผ่าน
//
//  เรียกจากหน้า LIFF (ไม่ต้อง login Supabase มาก่อน):
//    supabase.functions.invoke('line-auth', { body: { action: 'login', id_token } })
//    supabase.functions.invoke('line-auth', { body: { action: 'connect', id_token, id_card, phone } })
//    supabase.functions.invoke('line-auth', { body: { action: 'register', id_token, full_name, id_card, phone, business_name, address } })
//  ตอบกลับ { session, tenant, line, needs } → หน้าเว็บเรียก supabase.auth.setSession(session)
//    needs = 'connect' (ยังไม่ผูก ให้กรอกเลขบัตร + เบอร์) | 'register' (ไม่พบในระบบ ให้ลงทะเบียน) | null
//
//  ขั้นตอน
//   1) ตรวจ ID token กับเซิร์ฟเวอร์ LINE (ปลอมไม่ได้: LINE เซ็นและตรวจว่าออกให้ช่องทางของเรา)
//   2) หา/สร้างบัญชี Supabase ของ LINE คนนั้น (อีเมลสมมติ line_<userId>@line.local ไม่มีการส่งอีเมล)
//   3) ออก session ให้ (generateLink + verify แบบ token_hash ฝั่งเซิร์ฟเวอร์)
//   4) ผูกกับข้อมูลผู้เช่า: login = ผูกไว้แล้ว · connect = เลขบัตร + เบอร์โทรตรงกับที่สำนักงานบันทึก
//      · register = ผู้เช่าใหม่ลงทะเบียนเอง
//
//  ตั้งค่า (Edge Functions → line-auth → Secrets): LINE_CHANNEL_ID = Channel ID ของช่องทาง LINE Login
//  ตั้งชื่อ (slug) ตอน deploy เป็น line-auth · ปิด "Verify JWT with legacy secret" (ผู้เรียกยังไม่ได้ login)
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const LINE_VERIFY_URL = Deno.env.get('LINE_VERIFY_URL') ?? 'https://api.line.me/oauth2/v2.1/verify'

class Problem extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

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
  throw new Problem(500, 'ไม่พบ secret key ใน Edge Function')
}

const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const digits = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '') : '')

function thaiIdOk(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i)
  return (11 - (sum % 11)) % 10 === Number(id[12])
}
const phoneOk = (p: string) => /^0\d{8,9}$/.test(p)

/** IP ของผู้เช่า (ตัวแรกใน x-forwarded-for) — ส่งต่อให้ Supabase Auth นับ rate limit ต่อผู้เช่า ไม่ใช่ต่อ IP ของ Edge Function */
function clientIp(req: Request): string {
  const first = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  return /^[0-9a-fA-F:.]{3,45}$/.test(first) ? first : ''
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'ใช้ได้เฉพาะ POST' })
  try {
    return await handle(req)
  } catch (e) {
    if (e instanceof Problem) return json(e.status, { error: e.message })
    console.error(e)
    return json(500, { error: `เกิดข้อผิดพลาดในระบบ: ${(e as Error).message}` })
  }
})

/** ตรวจ ID token กับ LINE → { sub, name, picture } */
async function verifyLine(idToken: string) {
  const channelId = Deno.env.get('LINE_CHANNEL_ID')
  if (!channelId) throw new Problem(500, 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ID ใน Secrets ของ Edge Function line-auth')
  if (!idToken) throw new Problem(400, 'ไม่มี ID token จาก LINE (ตรวจว่า LIFF app เปิด scope openid)')
  const res = await fetch(LINE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.sub) {
    const expired = /expired/i.test(data.error_description ?? '')
    throw new Problem(401, expired ? 'การเข้าสู่ระบบ LINE หมดอายุ กรุณาปิดแล้วเปิดใหม่' : 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ (ตรวจว่า LINE_CHANNEL_ID ตรงกับช่องทางของ LIFF app)')
  }
  return { sub: String(data.sub), name: text(data.name, 150), picture: text(data.picture, 500) }
}

async function handle(req: Request): Promise<Response> {
  const ip = clientIp(req)
  const body = await req.json().catch(() => ({}))
  const action = text(body.action)
  if (!['login', 'connect', 'register'].includes(action)) throw new Problem(400, 'action ต้องเป็น login, connect หรือ register')

  const line = await verifyLine(text(body.id_token, 4000))
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = secretKey()
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const email = `line_${line.sub.toLowerCase()}@line.local`

  // ---- 2) บัญชี Supabase ของ LINE คนนี้ (มีอยู่แล้วก็ใช้ต่อ) ----
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { line_user_id: line.sub },
    user_metadata: { line_name: line.name },
  })
  if (created.error && created.error.code !== 'email_exists' && created.error.status !== 422) {
    throw new Problem(500, `สร้างบัญชีไม่สำเร็จ: ${created.error.message}`)
  }
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error || !link.data?.user) throw new Problem(500, `ออก session ไม่สำเร็จ: ${link.error?.message ?? 'ไม่มีข้อมูลผู้ใช้'}`)
  const userId = link.data.user.id

  // ---- 4) ผูกกับข้อมูลผู้เช่า ----
  const cols = 'tenant_id, full_name, phone, status, line_user_id, auth_id'
  const byLine = await admin.from('tenants').select(cols).eq('line_user_id', line.sub).maybeSingle()
  if (byLine.error) throw byLine.error
  let tenant = byLine.data

  async function attach(t: { tenant_id: number }) {
    // auth_id ห้ามซ้ำ: ถ้าบัญชีนี้เคยผูกกับผู้เช่าอื่น (เช่น สำนักงานยกเลิกการผูกแล้วผูกใหม่) ให้ปลดของเดิมก่อน
    await admin.from('tenants').update({ auth_id: null }).eq('auth_id', userId).neq('tenant_id', t.tenant_id)
    const up = await admin.from('tenants').update({ line_user_id: line.sub, auth_id: userId }).eq('tenant_id', t.tenant_id).select(cols).single()
    if (up.error) throw up.error
    return up.data
  }

  if (tenant) {
    if (tenant.auth_id !== userId) tenant = await attach(tenant)
  } else if (action === 'connect' || action === 'register') {
    const idCard = digits(body.id_card)
    const phone = digits(body.phone)
    if (!thaiIdOk(idCard)) throw new Problem(400, 'เลขบัตรประชาชนไม่ถูกต้อง')
    if (!phoneOk(phone)) throw new Problem(400, 'เบอร์โทรต้องขึ้นต้นด้วย 0 และมี 9–10 หลัก')

    const byId = await admin.from('tenants').select(`${cols}, id_card`).eq('id_card', idCard).maybeSingle()
    if (byId.error) throw byId.error
    if (byId.data) {
      if (digits(byId.data.phone) !== phone) {
        throw new Problem(409, 'เลขบัตรนี้มีในระบบแล้ว แต่เบอร์โทรไม่ตรงกับที่สำนักงานบันทึกไว้ — ติดต่อสำนักงานตลาดเพื่อแก้เบอร์โทร')
      }
      if (byId.data.line_user_id && byId.data.line_user_id !== line.sub) {
        throw new Problem(409, 'ข้อมูลผู้เช่านี้ผูกกับ LINE บัญชีอื่นแล้ว — ติดต่อสำนักงานตลาดเพื่อยกเลิกการผูกเดิม')
      }
      tenant = await attach(byId.data)
    } else if (action === 'register') {
      const fullName = text(body.full_name, 150)
      const business = text(body.business_name, 150)
      const address = text(body.address, 500)
      if (!fullName || !business || !address) throw new Problem(400, 'กรุณากรอกชื่อ-นามสกุล ชื่อร้าน และที่อยู่ให้ครบ')
      await admin.from('tenants').update({ auth_id: null }).eq('auth_id', userId)
      const ins = await admin
        .from('tenants')
        .insert({ full_name: fullName, id_card: idCard, phone, business_name: business, address, line_user_id: line.sub, auth_id: userId, status: 'active' })
        .select(cols)
        .single()
      if (ins.error) {
        if (ins.error.code === '23505') throw new Problem(409, 'ข้อมูลนี้ถูกลงทะเบียนไปแล้ว ลองเปิดใหม่อีกครั้ง หรือติดต่อสำนักงาน')
        throw ins.error
      }
      tenant = ins.data
    }
    // connect แล้วไม่พบเลขบัตร → tenant = null หน้าเว็บจะให้กรอกข้อมูลลงทะเบียนต่อ
  }

  // ---- 3) ออก session (ทำท้ายสุด และเฉพาะเมื่อผูกกับผู้เช่าแล้ว — บัญชีที่ยังไม่ผูกไม่ต้องมี session) ----
  let session = null
  if (tenant) {
    // /auth/v1/verify จำกัด 30 ครั้ง/5 นาที ต่อ IP: ส่ง IP ผู้เช่าไปด้วย (ใช้ได้กับ secret key sb_secret_ และต้องเปิด
    // "IP Address Forwarding" ที่ Authentication → Rate Limits) ถ้าไม่ได้เปิด Supabase จะไม่สนใจ header นี้
    const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' }
    if (ip && key.startsWith('sb_secret_')) headers['Sb-Forwarded-For'] = ip
    const verify = await fetch(`${url}/auth/v1/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'magiclink', token_hash: link.data.properties.hashed_token }),
    })
    const s = await verify.json().catch(() => ({}))
    if (verify.status === 429) throw new Problem(429, 'มีผู้เข้าระบบพร้อมกันจำนวนมาก กรุณารอ 2–3 นาทีแล้วเปิดใหม่')
    if (!verify.ok || !s.access_token) throw new Problem(500, `ออก session ไม่สำเร็จ: ${s.msg ?? s.error_description ?? verify.status}`)
    session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: s.expires_at, token_type: s.token_type }
  }

  return json(200, {
    session,
    tenant: tenant ? { tenant_id: tenant.tenant_id, full_name: tenant.full_name, status: tenant.status } : null,
    line: { name: line.name, picture: line.picture },
    needs: tenant ? null : action === 'connect' ? 'register' : 'connect',
  })
}
