import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import MaterialIcon from '../icons/MaterialIcon'
import { TONE_CLASS, notificationLook, timeAgo, useNotifications } from '../../lib/notifications'

function Item({ n, onOpen }) {
  const { icon, tone } = notificationLook(n.kind)
  const unread = !n.read_at
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(n)}
        data-notification={n.kind}
        className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-leaf-50 ${unread ? 'bg-leaf-50/60' : ''}`}
      >
        <span className={`grid size-9 shrink-0 place-items-center rounded-full ${TONE_CLASS[tone]}`}>
          <MaterialIcon name={icon} className="size-5" />
        </span>
        <span className="min-w-0 flex-1 leading-snug">
          <span className={`block ${unread ? 'font-semibold text-ink' : 'font-medium text-ink/90'}`}>{n.title}</span>
          {n.body && <span className="mt-0.5 block text-sm break-words text-muted">{n.body}</span>}
          <span className="mt-1 block text-xs text-muted">{timeAgo(n.created_at)}</span>
        </span>
        {unread && (
          <span className="mt-2 size-2.5 shrink-0 rounded-full bg-leaf-700">
            <span className="sr-only">ยังไม่อ่าน</span>
          </span>
        )}
      </button>
    </li>
  )
}

/**
 * กระดิ่งแจ้งเตือน + รายการย้อนหลัง (ต้องอยู่ใน NotificationProvider)
 * compact = ปุ่มเล็กลงเล็กน้อย (แถบเมนูด้านข้าง)
 * align: ฝั่งที่กล่องรายการยื่นออก ('right' = ขอบขวาตรงกับกระดิ่ง, 'left' = ขอบซ้ายตรงกับกระดิ่ง) — มือถือเต็มความกว้างจอเสมอ
 */
export default function NotificationBell({ align = 'right', compact = false, className = '' }) {
  const ctx = useNotifications()
  const buttonRef = useRef(null)
  const panelRef = useRef(null)
  const [pos, setPos] = useState(null)
  const open = ctx?.panelOpen ?? false
  const setOpen = ctx?.setPanelOpen

  // วางกล่องแบบ fixed ใต้กระดิ่ง (ไม่ถูกแถบเมนูที่เลื่อนได้ตัดขอบ) · มือถือ = เต็มความกว้างจอ
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      const top = Math.round(rect.bottom + 8)
      if (window.innerWidth < 640) setPos({ top, left: 12, right: 12 })
      else if (align === 'left') setPos({ top, left: Math.round(rect.left), width: 384 })
      else setPos({ top, right: Math.round(window.innerWidth - rect.right), width: 384 })
    }
    place()
    panelRef.current?.focus()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, align])

  // ปิดเมื่อกด Esc หรือคลิกนอกกล่อง
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    const onDown = (e) => {
      // คลิกที่กระดิ่ง ในกล่อง หรือบนแจ้งเตือนเด้ง ไม่นับว่าคลิกนอก
      if (e.target.closest?.('[data-bell], [data-notification-panel], [data-toast]')) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open, setOpen])

  if (!ctx) return null
  const { items, unread, loaded } = ctx
  const label = unread > 0 ? `การแจ้งเตือน ยังไม่ได้อ่าน ${unread} รายการ` : 'การแจ้งเตือน'

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-bell
        className={`relative grid ${compact ? 'size-9' : 'size-10'} place-items-center rounded-full text-leaf-800 hover:bg-leaf-200/60`}
      >
        <MaterialIcon name={unread > 0 ? 'notifications_active' : 'notifications'} fill={open} className="size-6" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 min-w-5 rounded-full bg-danger px-1 text-center text-xs leading-5 font-semibold text-white tabular-nums"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="การแจ้งเตือน"
          data-notification-panel
          tabIndex={-1}
          style={pos ?? { visibility: 'hidden' }}
          className="fixed z-40 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-line bg-white text-left shadow-[0_10px_32px_rgba(30,43,34,0.18)] outline-none"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <h2 className="font-semibold text-ink">การแจ้งเตือน</h2>
            {unread > 0 && (
              <button type="button" onClick={ctx.markAllRead} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-medium text-leaf-700 hover:bg-leaf-100">
                <MaterialIcon name="done_all" className="size-4" />
                อ่านแล้วทั้งหมด
              </button>
            )}
          </div>
          {!loaded ? (
            <p className="px-4 py-6 text-center text-muted">กำลังโหลด…</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-muted">ยังไม่มีการแจ้งเตือน</p>
          ) : (
            <ul className="max-h-[min(28rem,70dvh)] divide-y divide-line overflow-y-auto overscroll-contain">
              {items.map((n) => (
                <Item key={n.notification_id} n={n} onOpen={ctx.open} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
