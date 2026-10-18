import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { thaiError } from '../lib/errors'
import BrandMark from '../components/BrandMark'
import { StallCell } from '../components/MarketMap'
import { liffUrl } from '../lib/liff'
import LoadingScreen from '../components/LoadingScreen'

// ลายแผนผังตลาดฝั่งซ้ายของหน้า login (ตกแต่งเท่านั้น ไม่ใช่ข้อมูลจริง)
const PATTERN = [
  'vrrvvrrrvv',
  'rrvrrvvrrr',
  'vvrrxrrvrr',
  'rrrvvrrrvv',
  'vrrrrvvrsr',
  'rvvrrrrvrr',
]
const STATUS_OF = { v: 'vacant', r: 'rented', s: 'reserved', x: 'maintenance' }
const ZONES = ['A', 'B', 'C', 'D', 'E', 'F']

function DecorativeMarket() {
  return (
    <div aria-hidden="true" className="space-y-1.5">
      {PATTERN.map((row, i) => (
        <div key={ZONES[i]} className="flex items-center gap-1.5">
          <span className="w-5 text-sm font-semibold text-leaf-800/70">{ZONES[i]}</span>
          {row.split('').map((c, j) => (
            <StallCell key={j} code={`${ZONES[i]}${String(j + 1).padStart(3, '0')}`} status={STATUS_OF[c]} showCode={false} />
          ))}
        </div>
      ))}
    </div>
  )
}

export default function LoginPage() {
  const { session, role, checking, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // login อยู่แล้ว → ไปหน้าแอดมิน (RequireStaff จะตรวจสิทธิ์ต่อเอง)
  if (!checking && session && role) {
    return <Navigate to={location.state?.from ?? '/admin'} replace />
  }
  // กำลังตรวจ session เดิม (เปิดเว็บครั้งแรก) → หน้าโหลด แทนการเห็นฟอร์มแวบหนึ่งแล้วเด้งเข้าระบบ
  if (checking) return <LoadingScreen />

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    const { error: signInError } = await signIn(email.trim(), password)
    setSubmitting(false)
    if (signInError) {
      setError(thaiError(signInError))
      return
    }
    navigate(location.state?.from ?? '/admin', { replace: true })
  }

  return (
    <main className="grid min-h-dvh bg-white lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {/* ฝั่งซ้าย: แผนผังตลาด */}
      <section className="flex flex-col justify-between gap-5 bg-leaf-100 px-6 py-7 sm:px-10 lg:gap-10 lg:px-14 lg:py-12">
        <BrandMark />
        <div className="hidden lg:block">
          <DecorativeMarket />
        </div>
        <p className="max-w-xl text-leaf-800">
          จัดการแผงค้า สัญญาเช่า ค่าน้ำค่าไฟ และ<span className="whitespace-nowrap">ตรวจการชำระเงิน</span>ของตลาด
        </p>
      </section>

      {/* ฝั่งขวา: ฟอร์มเข้าสู่ระบบ */}
      <section className="flex items-center px-6 py-10 sm:px-10 lg:px-16">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold text-ink">เข้าสู่ระบบเจ้าหน้าที่</h1>
          <p className="mt-1 text-muted">ใช้อีเมลและรหัสผ่านที่ผู้ดูแลระบบสร้างให้</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
            <div>
              <label htmlFor="email" className="mb-1.5 block font-medium text-ink">อีเมล</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-ink placeholder:text-muted/60 focus:border-leaf-700 focus:outline-none focus:ring-2 focus:ring-leaf-300"
                placeholder="name@example.com"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <label htmlFor="password" className="font-medium text-ink">รหัสผ่าน</label>
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="text-sm font-medium text-leaf-700 hover:underline"
                  aria-controls="password"
                >
                  {showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                </button>
              </div>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-ink focus:border-leaf-700 focus:outline-none focus:ring-2 focus:ring-leaf-300"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-danger-bg px-3.5 py-2.5 text-danger">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !email || !password}
              className="w-full rounded-lg bg-leaf-700 px-4 py-2.5 font-semibold text-white hover:bg-leaf-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
            </button>
          </form>
          <p className="mt-3 text-sm text-muted">ลืมรหัสผ่าน ติดต่อผู้ดูแลระบบให้ตั้งรหัสใหม่</p>

          {/* ผู้เช่าเข้าผ่าน LINE (LIFF) — บนมือถือเปิดในแอป LINE, บนคอมจะให้ login LINE ทางเว็บก่อน */}
          <div className="mt-8 border-t border-line pt-6">
            <p className="mb-3 font-medium text-ink">ผู้เช่าแผง</p>
            <a
              href={liffUrl() || '/liff'}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#06C755] px-4 py-2.5 font-semibold text-white hover:bg-[#05b34c] focus-visible:outline-[#06C755]"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
                <path d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.5s5.9-3.5 8-5.9c1.5-1.6 2-3.2 2-4.9C22 6.6 17.5 3 12 3Z" />
              </svg>
              เข้าใช้งานด้วย LINE
            </a>
            <p className="mt-2 text-sm text-muted">ดูบิล ส่งสลิป และขอเช่าแผง ไม่ต้องใช้รหัสผ่าน</p>
          </div>
        </div>
      </section>
    </main>
  )
}
