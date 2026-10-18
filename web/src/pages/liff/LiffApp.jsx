import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { GridIcon } from '../../components/BrandMark'
import LoadingScreen from '../../components/LoadingScreen'
import { Button } from '../../components/ui/form'
import { thaiError } from '../../lib/errors'
import { callLineAuth, lineEmail, liffSupabase, startLiff } from '../../lib/liff'
import { fetchMe } from '../../lib/liffData'
import { LiffContext } from '../../lib/liffContext'
import ConnectPage from './ConnectPage'
import LiffHome from './LiffHome'
import LiffInvoices from './LiffInvoices'
import LiffInvoice from './LiffInvoice'
import LiffStalls from './LiffStalls'
import LiffProfile from './LiffProfile'
import LiffReceipt from './LiffReceipt'

// ---------------------------------------------------------------------
// การเข้าระบบ
//   1) เริ่ม LIFF ได้ ID token ของ LINE
//   2) มี session เดิมของ LINE คนเดียวกันและยังเห็นข้อมูลผู้เช่า → ใช้ต่อเลย (ไม่ต้องเรียก Edge Function)
//   3) ไม่มี → Edge Function line-auth (action login) → ได้ session หรือ needs = 'connect'
// ---------------------------------------------------------------------

/** นำผลจาก line-auth มาใช้: ตั้ง session แล้วคืนสถานะหน้าจอถัดไป */
async function applyAuth(line, res) {
  const client = liffSupabase()
  if (res.session) {
    const { error } = await client.auth.setSession({ access_token: res.session.access_token, refresh_token: res.session.refresh_token })
    if (error) throw error
  }
  const info = { ...line, name: res.line?.name || line.name, picture: res.line?.picture || line.picture }
  if (res.tenant && res.tenant.status !== 'active') return { phase: 'inactive', line: info, tenant: res.tenant }
  if (res.tenant) {
    const me = await fetchMe()
    if (!me) throw new Error('เข้าระบบแล้วแต่ยังโหลดข้อมูลผู้เช่าไม่ได้ ลองปิดแล้วเปิดใหม่อีกครั้ง')
    return { phase: 'ready', line: info, tenant: me }
  }
  return { phase: 'connect', line: info, needs: res.needs ?? 'connect' }
}

async function boot() {
  const line = await startLiff()
  if (!line) return { phase: 'redirecting' }
  const client = liffSupabase()
  const { data } = await client.auth.getSession()
  const session = data.session
  if (session) {
    if (session.user?.email === lineEmail(line.sub)) {
      const me = await fetchMe().catch(() => null)
      if (me) return { phase: 'ready', line, tenant: me }
    }
    // session ของ LINE คนอื่น / ถูกยกเลิกการผูก / ถูกระงับ → เริ่มใหม่
    await client.auth.signOut({ scope: 'local' })
  }
  return applyAuth(line, await callLineAuth({ action: 'login', id_token: line.idToken }))
}

function Screen({ title, children }) {
  return (
    <main className="min-h-dvh bg-leaf-50 px-5 pt-14 pb-10">
      <div className="mx-auto max-w-md">
        <GridIcon className="size-10" />
        <h1 className="mt-5 text-xl font-semibold text-ink" aria-live="polite">
          {title}
        </h1>
        {children}
      </div>
    </main>
  )
}

const NAV = [
  { to: '/liff', end: true, label: 'หน้าแรก', icon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z' },
  { to: '/liff/bills', label: 'บิล', icon: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4' },
  { to: '/liff/stalls', label: 'เช่าแผง', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
  { to: '/liff/me', label: 'ข้อมูลของฉัน', icon: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM3.5 21a8.5 8.5 0 0 1 17 0' },
]

function BottomNav() {
  return (
    <nav aria-label="เมนูหลัก" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {NAV.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-xs font-medium ${isActive ? 'text-leaf-700' : 'text-muted'}`
              }
            >
              {({ isActive }) => (
                <>
                  <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={isActive ? 2.2 : 1.7} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
                    <path d={item.icon} />
                  </svg>
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function Shell({ ctx }) {
  return (
    <LiffContext.Provider value={ctx}>
      <div className="min-h-dvh bg-leaf-50 pb-24">
        {ctx.line.mock && (
          <p className="bg-stall-reserved px-4 py-1 text-center text-sm text-stall-reserved-ink">โหมดจำลอง — ไม่ได้เปิดผ่าน LINE</p>
        )}
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-2.5">
            <GridIcon className="size-8 shrink-0" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate font-semibold text-ink">{ctx.tenant.business_name || ctx.tenant.full_name}</p>
              <p className="truncate text-sm text-muted">{ctx.tenant.business_name ? ctx.tenant.full_name : 'ผู้เช่าแผง'}</p>
            </div>
            {ctx.line.picture && <img src={ctx.line.picture} alt="" className="size-9 shrink-0 rounded-full border border-line" />}
          </div>
        </header>
        <main className="mx-auto max-w-md px-4 pt-4">
          <Routes>
            <Route index element={<LiffHome />} />
            <Route path="bills" element={<LiffInvoices />} />
            <Route path="bills/:id" element={<LiffInvoice />} />
            <Route path="stalls" element={<LiffStalls />} />
            <Route path="me" element={<LiffProfile />} />
            <Route path="receipts/:id" element={<LiffReceipt />} />
            <Route path="*" element={<Navigate to="/liff" replace />} />
          </Routes>
        </main>
        <BottomNav />
      </div>
    </LiffContext.Provider>
  )
}

/** หน้าผู้เช่าทั้งหมด (/liff/*) — เปิดผ่าน LINE */
export default function LiffApp() {
  const [round, setRound] = useState(0)
  const [state, setState] = useState({ round: -1, phase: 'booting' })
  const current = state.round === round ? state : { phase: 'booting' }

  useEffect(() => {
    let cancelled = false
    boot().then(
      (next) => !cancelled && setState({ ...next, round }),
      (e) => !cancelled && setState({ phase: 'error', message: thaiError(e), round }),
    )
    return () => {
      cancelled = true
    }
  }, [round])

  // ระหว่างใช้งาน session หมดอายุและต่ออายุไม่ได้ (เช่น สำนักงานยกเลิกการผูก LINE) → เข้าระบบใหม่
  const phaseRef = useRef(current.phase)
  useEffect(() => {
    phaseRef.current = current.phase
  })
  useEffect(() => {
    const { data } = liffSupabase().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && phaseRef.current === 'ready') setRound((n) => n + 1)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const retry = useCallback(() => setRound((n) => n + 1), [])
  const refreshTenant = useCallback(async () => {
    const me = await fetchMe()
    if (me) setState((s) => ({ ...s, tenant: me }))
    return me
  }, [])

  const ctx = useMemo(
    () =>
      current.phase === 'ready'
        ? { tenant: current.tenant, line: current.line, client: liffSupabase(), refreshTenant }
        : null,
    [current.phase, current.tenant, current.line, refreshTenant],
  )

  if (current.phase === 'booting' || current.phase === 'redirecting') {
    return <LoadingScreen label={current.phase === 'redirecting' ? 'กำลังไปหน้าเข้าสู่ระบบ LINE…' : 'กำลังเปิด…'} />
  }

  if (current.phase === 'error') {
    return (
      <Screen title="เปิดไม่สำเร็จ">
        <p role="alert" className="mt-3 rounded-lg bg-danger-bg px-4 py-3 text-danger">
          {current.message}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" size="md" onClick={retry}>
            ลองใหม่
          </Button>
        </div>
        <p className="mt-6 text-sm text-muted">ถ้ายังไม่ได้ ให้ปิดหน้านี้แล้วเปิดใหม่จาก LINE ของตลาด หรือติดต่อสำนักงานตลาด</p>
      </Screen>
    )
  }

  if (current.phase === 'inactive') {
    return (
      <Screen title="บัญชีผู้เช่าถูกระงับชั่วคราว">
        <p className="mt-2 text-muted">
          คุณ{current.tenant?.full_name} ยังเข้าดูบิลและแจ้งชำระผ่าน LINE ไม่ได้ในตอนนี้ กรุณาติดต่อสำนักงานตลาด
        </p>
        <Button className="mt-5" size="md" onClick={retry}>
          ตรวจอีกครั้ง
        </Button>
      </Screen>
    )
  }

  if (current.phase === 'connect') {
    return (
      <ConnectPage
        line={current.line}
        onLinked={async (res) => {
          const next = await applyAuth(current.line, res)
          setState({ ...next, round })
        }}
      />
    )
  }

  return <Shell ctx={ctx} />
}
