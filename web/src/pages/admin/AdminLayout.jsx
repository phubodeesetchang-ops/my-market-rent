import { Suspense, useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useLoader } from '../../lib/useLoader'
import { useLiveVersion } from '../../lib/notifications'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { useAuth } from '../../auth/AuthProvider'
import { can } from '../../auth/permissions'
import { ROLE } from '../../lib/labels'
import BrandMark from '../../components/BrandMark'
import { LoadingMark } from '../../components/LoadingScreen'
import MaterialIcon from '../../components/icons/MaterialIcon'
import NotificationProvider from '../../components/notifications/NotificationProvider'
import NotificationBell from '../../components/notifications/NotificationBell'

// เมนูแบ่งกลุ่มตามลักษณะงาน; `show` = เงื่อนไขการแสดงตามบทบาท (ไม่ระบุ = ทุกบทบาท)
// icon = ชื่อไอคอน Google Material Symbols (fonts.google.com/icons) — เมนูที่เลือกอยู่ใช้แบบทึบ
const NAV_GROUPS = [
  {
    items: [{ to: '/admin', label: 'ภาพรวม', icon: 'space_dashboard', end: true }],
  },
  {
    title: 'งานประจำ',
    items: [
      { to: '/admin/contracts', label: 'คำขอและสัญญาเช่า', icon: 'contract' },
      { to: '/admin/readings', label: 'จดมิเตอร์น้ำ-ไฟ', icon: 'electric_meter' },
      { to: '/admin/invoices', label: 'ใบแจ้งหนี้', icon: 'receipt_long' },
      { to: '/admin/payments', label: 'ตรวจการชำระเงิน', icon: 'payments' },
    ],
  },
  {
    title: 'ข้อมูลหลัก',
    items: [
      { to: '/admin/stalls', label: 'แผงค้า', icon: 'grid_view' },
      { to: '/admin/tenants', label: 'ผู้เช่า', icon: 'groups' },
      { to: '/admin/markets', label: 'ตลาดและอัตราค่าบริการ', icon: 'storefront' },
      { to: '/admin/users', label: 'ผู้ใช้ระบบ', icon: 'manage_accounts', show: (role) => can(role, 'manageUsers') },
    ],
  },
  {
    title: 'สรุปผล',
    items: [{ to: '/admin/reports', label: 'รายงาน', icon: 'bar_chart' }],
  },
]

/** จำนวนสลิปรอตรวจ (แสดงที่เมนู) — โหลดใหม่ทุกครั้งที่เปลี่ยนหน้า */
async function fetchPendingPayments() {
  const { count, error } = await supabase.from('payments').select('payment_id', { count: 'exact', head: true }).eq('status', 'pending')
  if (error) throw error
  return count ?? 0
}

function Navigation({ role, onNavigate, badges = {} }) {
  return (
    <nav aria-label="เมนูหลัก" className="space-y-4">
      {NAV_GROUPS.map((group, i) => {
        const items = group.items.filter((item) => !item.show || item.show(role))
        if (items.length === 0) return null
        return (
          <div key={group.title ?? i}>
            {group.title && <p className="mb-1 px-3 text-sm text-muted">{group.title}</p>}
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-lg px-3 py-1.5 font-medium ${
                        isActive ? 'bg-white text-leaf-800 ring-1 ring-leaf-300' : 'text-ink hover:bg-leaf-200/60'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <MaterialIcon name={item.icon} fill={isActive} className={`size-5 ${isActive ? 'text-leaf-700' : 'text-muted'}`} />
                        <span className="min-w-0 flex-1">{item.label}</span>
                        {badges[item.to] > 0 && (
                          <span className="rounded-full bg-stall-reserved px-2 text-sm font-semibold text-stall-reserved-ink tabular-nums">
                            {badges[item.to]}
                            <span className="sr-only"> รายการรอตรวจ</span>
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

function UserBox({ profile, role, onSignOut }) {
  return (
    <div className="flex items-end justify-between gap-3 border-t border-leaf-300/70 pt-3">
      <div className="min-w-0">
        <p className="truncate font-medium text-ink" title={profile?.full_name}>{profile?.full_name}</p>
        <p className="text-sm text-muted">{ROLE[role]}</p>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-leaf-300 bg-white py-1 pr-3 pl-2 text-sm font-medium text-leaf-800 hover:bg-leaf-50"
      >
        <MaterialIcon name="logout" className="size-4" />
        ออกจากระบบ
      </button>
    </div>
  )
}

/**
 * โครงหน้าเจ้าหน้าที่ + ศูนย์แจ้งเตือน
 * กดแจ้งเตือน → เปิดหน้าที่เกี่ยวข้อง (ติดป้าย fromNotification ไว้กับการเปลี่ยนหน้า
 * เพื่อให้หน้าเปิดใหม่ตามลิงก์ เช่น ?open=12 แม้อยู่หน้านั้นอยู่แล้ว)
 */
export default function AdminLayout() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const openLink = useCallback((link) => navigate(link, { state: { fromNotification: Date.now() } }), [navigate])
  const uid = profile?.user_id
  return (
    <NotificationProvider client={supabase} filter={uid ? `user_id=eq.${uid}` : null} scope={`staff:${uid}`} onOpen={openLink}>
      <AdminShell />
    </NotificationProvider>
  )
}

function AdminShell() {
  const { profile, role, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const { pathname } = location
  const live = useLiveVersion()
  const wide = useMediaQuery('(min-width: 1024px)') // กระดิ่งชุดเดียว: แถบข้าง (จอใหญ่) หรือแถบบน (มือถือ)

  // หน้าเปิดใหม่ทุกครั้งที่มาจากการกดแจ้งเตือน (คงค่าไว้แม้หน้าล้าง query/state ออกภายหลัง)
  const stamp = location.state?.fromNotification
  const [pageKey, setPageKey] = useState(stamp ?? 0)
  if (stamp && stamp !== pageKey) setPageKey(stamp)
  const pending = useLoader(fetchPendingPayments, `${pathname}:${live}`)
  const badges = { '/admin/payments': pending.data ?? 0 }

  // ปิดเมนูมือถือเมื่อกด Esc (ตอนกดเลือกเมนู Navigation เรียก onNavigate ปิดให้เอง)
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <div className="min-h-dvh bg-white lg:grid lg:grid-cols-[18rem_minmax(0,1fr)]">
      {/* แถบบนสำหรับมือถือ */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-leaf-300/70 bg-leaf-100 px-4 py-3 lg:hidden">
        <BrandMark compact />
        <div className="flex items-center gap-2">
          {!wide && <NotificationBell align="right" />}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            className="inline-flex items-center gap-1 rounded-lg border border-leaf-300 bg-white py-1.5 pr-3 pl-2 font-medium text-leaf-800"
          >
            <MaterialIcon name="menu" className="size-5" />
            เมนู
          </button>
        </div>
      </header>

      {/* เมนูด้านข้าง (จอใหญ่) */}
      <aside className="sticky top-0 hidden h-dvh flex-col justify-between gap-4 overflow-y-auto border-r border-leaf-300/70 bg-leaf-100 px-3 py-5 lg:flex">
        <div>
          <div className="mb-5 flex items-center justify-between gap-1 pl-3">
            <BrandMark />
            {wide && <NotificationBell align="left" compact />}
          </div>
          <Navigation role={role} badges={badges} />
        </div>
        <div className="px-3">
          <UserBox profile={profile} role={role} onSignOut={signOut} />
        </div>
      </aside>

      {/* เมนูแบบเลื่อนออก (มือถือ) */}
      {menuOpen && (
        <div className="fixed inset-0 z-30 lg:hidden" role="dialog" aria-modal="true" aria-label="เมนูหลัก">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30"
            aria-label="ปิดเมนู"
            onClick={() => setMenuOpen(false)}
          />
          <div id="mobile-menu" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col justify-between overflow-y-auto bg-leaf-100 px-3 py-5">
            <div>
              <div className="mb-6 flex items-center justify-between px-3">
                <BrandMark compact />
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-2 py-1 font-medium text-leaf-800 hover:bg-leaf-200"
                >
                  ปิด
                </button>
              </div>
              <Navigation role={role} badges={badges} onNavigate={() => setMenuOpen(false)} />
            </div>
            <div className="px-3 pt-6">
              <UserBox profile={profile} role={role} onSignOut={signOut} />
            </div>
          </div>
        </div>
      )}

      <main className="min-w-0 px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
        <Suspense
          fallback={
            <div className="grid place-items-center py-24" role="status" aria-label="กำลังเปิดหน้า">
              <LoadingMark size={64} />
            </div>
          }
        >
          <Outlet key={pageKey} />
        </Suspense>
      </main>
    </div>
  )
}
