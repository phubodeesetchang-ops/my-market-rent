import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useLoader } from '../../lib/useLoader'
import { useAuth } from '../../auth/AuthProvider'
import { can } from '../../auth/permissions'
import { ROLE } from '../../lib/labels'
import BrandMark from '../../components/BrandMark'

// เมนูแบ่งกลุ่มตามลักษณะงาน; `show` = เงื่อนไขการแสดงตามบทบาท (ไม่ระบุ = ทุกบทบาท)
const NAV_GROUPS = [
  {
    items: [{ to: '/admin', label: 'ภาพรวม', end: true }],
  },
  {
    title: 'งานประจำ',
    items: [
      { to: '/admin/contracts', label: 'คำขอและสัญญาเช่า' },
      { to: '/admin/readings', label: 'จดมิเตอร์น้ำ-ไฟ' },
      { to: '/admin/invoices', label: 'ใบแจ้งหนี้' },
      { to: '/admin/payments', label: 'ตรวจการชำระเงิน' },
    ],
  },
  {
    title: 'ข้อมูลหลัก',
    items: [
      { to: '/admin/stalls', label: 'แผงค้า' },
      { to: '/admin/tenants', label: 'ผู้เช่า' },
      { to: '/admin/markets', label: 'ตลาดและอัตราค่าบริการ' },
      { to: '/admin/users', label: 'ผู้ใช้ระบบ', show: (role) => can(role, 'manageUsers') },
    ],
  },
  {
    title: 'สรุปผล',
    items: [{ to: '/admin/reports', label: 'รายงาน' }],
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
                      `block rounded-lg px-3 py-1.5 font-medium ${
                        isActive ? 'bg-white text-leaf-800 ring-1 ring-leaf-300' : 'text-ink hover:bg-leaf-200/60'
                      }`
                    }
                  >
                    <span className="flex items-center justify-between gap-2">
                      {item.label}
                      {badges[item.to] > 0 && (
                        <span className="rounded-full bg-stall-reserved px-2 text-sm font-semibold text-stall-reserved-ink tabular-nums">
                          {badges[item.to]}
                          <span className="sr-only"> รายการรอตรวจ</span>
                        </span>
                      )}
                    </span>
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
        className="shrink-0 rounded-lg border border-leaf-300 bg-white px-3 py-1 text-sm font-medium text-leaf-800 hover:bg-leaf-50"
      >
        ออกจากระบบ
      </button>
    </div>
  )
}

export default function AdminLayout() {
  const { profile, role, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const { pathname } = useLocation()
  const pending = useLoader(fetchPendingPayments, pathname)
  const badges = { '/admin/payments': pending.data ?? 0 }

  // ปิดเมนูมือถือเมื่อกด Esc (ตอนกดเลือกเมนู Navigation เรียก onNavigate ปิดให้เอง)
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <div className="min-h-dvh bg-white lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      {/* แถบบนสำหรับมือถือ */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-leaf-300/70 bg-leaf-100 px-4 py-3 lg:hidden">
        <BrandMark compact />
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          className="rounded-lg border border-leaf-300 bg-white px-3 py-1.5 font-medium text-leaf-800"
        >
          เมนู
        </button>
      </header>

      {/* เมนูด้านข้าง (จอใหญ่) */}
      <aside className="sticky top-0 hidden h-dvh flex-col justify-between gap-4 overflow-y-auto border-r border-leaf-300/70 bg-leaf-100 px-3 py-5 lg:flex">
        <div>
          <BrandMark className="mb-5 px-3" />
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
        <Outlet />
      </main>
    </div>
  )
}
