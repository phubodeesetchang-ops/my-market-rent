// LINE LIFF + บัญชี Supabase ของผู้เช่า
//
// - หน้าผู้เช่าใช้ Supabase client แยกจากหน้าเจ้าหน้าที่ (เก็บ session คนละที่) → เปิดทั้งสองแบบในเครื่องเดียวกันได้
// - เข้าระบบ: LIFF ให้ ID token → Edge Function line-auth ตรวจกับ LINE แล้วออก session ให้
// - โหมดจำลอง (ไม่ต้องเปิดใน LINE): ใส่ ?liffMock=1 — ใช้ได้เฉพาะ npm run dev หรือ build ที่ตั้ง VITE_LIFF_MOCK=true
//   ใช้ทดสอบหน้าตาร่วมกับ backend จำลองเท่านั้น (ID token จำลองจะถูก Edge Function จริงปฏิเสธเสมอ เพราะ LINE ตรวจแล้วไม่ผ่าน)
import { createClient, FunctionsHttpError } from '@supabase/supabase-js'
import { functionUrl } from './supabase'

export const LIFF_ID = import.meta.env.VITE_LIFF_ID ?? ''
export const liffUrl = () => (LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : '')

let client = null
/** Supabase client ของผู้เช่า (สร้างเมื่อเปิดหน้า /liff เท่านั้น) */
export function liffSupabase() {
  client ??= createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'market-tenant-auth' },
  })
  return client
}

// โหมดจำลองเปิดได้เฉพาะตอนพัฒนา (npm run dev) หรือ build ที่ตั้ง VITE_LIFF_MOCK=true เท่านั้น
const MOCK_ALLOWED = import.meta.env.DEV || import.meta.env.VITE_LIFF_MOCK === 'true'

function mockToken() {
  if (!MOCK_ALLOWED) return ''
  const fromUrl = new URLSearchParams(window.location.search).get('liffMock')
  if (fromUrl) {
    try {
      sessionStorage.setItem('liffMock', fromUrl)
    } catch {
      // ไม่มี sessionStorage ก็ใช้ค่าจาก URL ครั้งนี้
    }
    return fromUrl
  }
  try {
    return sessionStorage.getItem('liffMock') || (import.meta.env.VITE_LIFF_MOCK === 'true' ? '1' : '')
  } catch {
    return import.meta.env.VITE_LIFF_MOCK === 'true' ? '1' : ''
  }
}

let starting = null
/**
 * เริ่ม LIFF → คืน { idToken, sub, name, picture, inClient, mock, liff }
 * คืน null ถ้ากำลังพาไปหน้า LINE Login (เปิดนอกแอป LINE ครั้งแรก)
 * เรียกซ้ำได้: ใช้ผลเดิม (liff.init ทำได้ครั้งเดียวต่อการเปิดหน้า) · ถ้าครั้งก่อนล้มเหลวจะเริ่มใหม่
 */
export function startLiff() {
  starting ??= initLiff().catch((e) => {
    starting = null
    throw e
  })
  return starting
}

async function initLiff() {
  const { default: liff } = await import('@line/liff')
  const mock = mockToken()
  if (mock) {
    const { LiffMockPlugin } = await import('@line/liff-mock')
    liff.use(new LiffMockPlugin())
    await liff.init({ liffId: LIFF_ID || 'mock-liff-id', mock: true })
    const token = mock === '1' ? 'mock-id-token' : mock
    liff.$mock.set((p) => ({
      ...p,
      isLoggedIn: true,
      isInClient: true,
      getIDToken: token,
      getDecodedIDToken: { sub: `Umock${token.replace(/\W/g, '')}`, name: 'ผู้เช่าทดลอง' },
      getProfile: { displayName: 'ผู้เช่าทดลอง', userId: `Umock${token.replace(/\W/g, '')}`, pictureUrl: '' },
    }))
  } else {
    if (!LIFF_ID) throw new Error('ยังไม่ได้ตั้งค่า VITE_LIFF_ID ในไฟล์ .env (ดู README ขั้นที่ 8)')
    await liff.init({ liffId: LIFF_ID })
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: window.location.href })
      return null
    }
  }
  const idToken = liff.getIDToken()
  const decoded = liff.getDecodedIDToken() ?? {}
  if (!idToken || !decoded.sub) throw new Error('ไม่ได้รับข้อมูลจาก LINE — ตรวจว่า LIFF app เปิด scope "openid" และ "profile"')
  return { idToken, sub: decoded.sub, name: decoded.name ?? '', picture: decoded.picture ?? '', inClient: liff.isInClient(), mock: Boolean(mock), liff }
}

/** อีเมลสมมติของบัญชี Supabase ที่ผูกกับ LINE (ต้องตรงกับ Edge Function line-auth) */
export const lineEmail = (sub) => `line_${String(sub).toLowerCase()}@line.local`

const unreachable = () =>
  `เรียก Edge Function "line-auth" ไม่ได้ — ตรวจว่า deploy แล้วและชื่อตรง (เปิด ${functionUrl('line-auth')} ในแท็บใหม่) ดู README ขั้นที่ 8`

/** เรียก Edge Function line-auth → { session, tenant, line, needs } · ไม่สำเร็จ throw Error ภาษาไทย */
export async function callLineAuth(body) {
  const { data, error } = await liffSupabase().functions.invoke('line-auth', { body })
  if (!error) return data
  if (error instanceof FunctionsHttpError) {
    let payload = null
    try {
      payload = await error.context.json()
    } catch {
      // ไม่ใช่ JSON
    }
    if (payload?.error) throw new Error(payload.error)
    if (error.context.status === 404) throw new Error(unreachable())
    throw new Error(`Edge Function ตอบกลับผิดพลาด (HTTP ${error.context.status})`)
  }
  throw new Error(unreachable())
}
