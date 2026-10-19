import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MaterialIcon from '../icons/MaterialIcon'
import {
  NotificationContext,
  TONE_CLASS,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  notificationLook,
} from '../../lib/notifications'

const TOAST_MS = 8000
const MAX_TOASTS = 3
const POLL_MS = 60000

function readFlag(key) {
  try {
    return sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
function writeFlag(key) {
  try {
    sessionStorage.setItem(key, '1')
  } catch {
    // เบราว์เซอร์ปิด storage (โหมดส่วนตัว) — แค่แสดงสรุปซ้ำได้ ไม่เป็นไร
  }
}

/** แจ้งเตือนเด้งมุมจอ: กดเพื่อเปิด · ปิดเองใน 8 วินาที (หยุดนับเมื่อชี้/โฟกัส) */
function Toast({ toast, onOpen, onDismiss }) {
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused) return
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_MS)
    return () => clearTimeout(timer)
  }, [paused, toast.id, onDismiss])

  const { icon, tone } = toast.summary ? { icon: 'notifications_active', tone: 'green' } : notificationLook(toast.kind)
  return (
    <div
      data-toast
      className="pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-line bg-white p-3 shadow-[0_6px_24px_rgba(30,43,34,0.16)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <button type="button" onClick={() => onOpen(toast)} className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left">
        <span className={`grid size-9 shrink-0 place-items-center rounded-full ${TONE_CLASS[tone]}`}>
          <MaterialIcon name={icon} className="size-5" />
        </span>
        <span className="min-w-0 leading-snug">
          <span className="block font-semibold text-ink">{toast.title}</span>
          {toast.body && <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{toast.body}</span>}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="-mt-1 -mr-1 shrink-0 rounded-lg p-1.5 text-muted hover:bg-leaf-50 hover:text-ink"
        aria-label="ปิดการแจ้งเตือนนี้"
      >
        <MaterialIcon name="close" className="size-5" />
      </button>
    </div>
  )
}

/**
 * ศูนย์การแจ้งเตือน: โหลดรายการ + ฟังแบบทันที (Supabase Realtime) + เด้งมุมจอ
 * - client  : Supabase client ที่ login แล้ว (เจ้าหน้าที่ = supabase, ผู้เช่า = liffSupabase())
 * - filter  : ตัวกรอง Realtime เช่น 'user_id=eq.<uuid>' / 'tenant_id=eq.12'
 * - scope   : ชื่อเฉพาะของผู้ใช้ (ใช้ตั้งชื่อช่อง Realtime และจำว่าแสดงสรุปไปแล้วในรอบนี้)
 * - onOpen  : เปิดลิงก์ของแจ้งเตือน (เช่น navigate)
 * ถ้า Realtime ใช้ไม่ได้ ยังโหลดใหม่ทุก 1 นาที และทุกครั้งที่กลับมาที่หน้าต่างนี้
 */
export default function NotificationProvider({ client, filter, scope, onOpen, children }) {
  const [state, setState] = useState({ items: [], unread: 0, loaded: false })
  const [toasts, setToasts] = useState([])
  const [version, setVersion] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)
  const [tick, setTick] = useState(0)
  const maxIdRef = useRef(null) // รหัสล่าสุดที่เคยเห็น (null = ยังไม่โหลดครั้งแรก)
  const onOpenRef = useRef(onOpen)
  useEffect(() => {
    onOpenRef.current = onOpen
  })

  const refresh = useCallback(() => setTick((n) => n + 1), [])
  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  // โหลดรายการ แล้วเด้งเฉพาะรายการที่ใหม่กว่าที่เคยเห็น
  useEffect(() => {
    let cancelled = false
    fetchNotifications(client).then(
      ({ items, unread }) => {
        if (cancelled) return
        const top = items[0]?.notification_id ?? 0
        const seen = maxIdRef.current
        let pop = []
        if (seen === null) {
          maxIdRef.current = top
          const flag = `notif-summary:${scope}`
          if (unread > 0 && !readFlag(flag)) {
            writeFlag(flag)
            pop = [{ id: `summary-${top}`, summary: true, title: `มีการแจ้งเตือนที่ยังไม่ได้อ่าน ${unread} รายการ`, body: 'แตะเพื่อดูทั้งหมด' }]
          }
        } else if (top > seen) {
          maxIdRef.current = top
          const fresh = items.filter((n) => n.notification_id > seen && !n.read_at).reverse()
          if (fresh.length) setVersion((v) => v + 1)
          pop = fresh.map((n) => ({ ...n, id: `n-${n.notification_id}` }))
          if (pop.length > MAX_TOASTS) {
            const extra = pop.length - (MAX_TOASTS - 1)
            pop = [
              ...pop.slice(-(MAX_TOASTS - 1)),
              { id: `summary-${top}`, summary: true, title: `และแจ้งเตือนใหม่อีก ${extra} รายการ`, body: 'แตะเพื่อดูทั้งหมด' },
            ]
          }
        }
        setState({ items, unread, loaded: true })
        if (pop.length) setToasts((list) => [...list.filter((t) => !pop.some((p) => p.id === t.id)), ...pop].slice(-MAX_TOASTS))
      },
      () => {
        // โหลดไม่สำเร็จ (เช่น ยังไม่ได้รัน migration 009 / เน็ตหลุด) — คงรายการเดิมไว้ ลองใหม่รอบหน้า
        if (!cancelled) setState((s) => ({ ...s, loaded: true }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [client, scope, tick])

  // แจ้งเตือนใหม่แบบทันที
  useEffect(() => {
    if (!filter) return
    const channel = client
      .channel(`notifications:${scope}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter }, refresh)
      .subscribe()
    return () => {
      client.removeChannel(channel)
    }
  }, [client, filter, scope, refresh])

  // สำรอง: โหลดใหม่เป็นระยะ และเมื่อกลับมาที่หน้าต่างนี้
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible'
    const timer = setInterval(() => visible() && refresh(), POLL_MS)
    const onShow = () => visible() && refresh()
    document.addEventListener('visibilitychange', onShow)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [refresh])

  const open = useCallback(
    (n) => {
      if (n.summary) {
        dismiss(n.id)
        setPanelOpen(true)
        return
      }
      dismiss(n.id ?? `n-${n.notification_id}`)
      setPanelOpen(false)
      if (n.notification_id && !n.read_at) {
        const now = new Date().toISOString()
        setState((s) => ({
          ...s,
          items: s.items.map((x) => (x.notification_id === n.notification_id ? { ...x, read_at: now } : x)),
          unread: Math.max(0, s.unread - 1),
        }))
        markNotificationsRead(client, [n.notification_id]).catch(() => refresh())
      }
      if (n.link) onOpenRef.current?.(n.link)
    },
    [client, dismiss, refresh],
  )

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString()
    setState((s) => ({ ...s, items: s.items.map((x) => (x.read_at ? x : { ...x, read_at: now })), unread: 0 }))
    markAllNotificationsRead(client).catch(() => refresh())
  }, [client, refresh])

  const value = useMemo(
    () => ({ ...state, version, panelOpen, setPanelOpen, open, markAllRead, refresh }),
    [state, version, panelOpen, open, markAllRead, refresh],
  )

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-label="การแจ้งเตือนล่าสุด"
        role="region"
        className="pointer-events-none fixed inset-x-3 top-3 z-50 mx-auto flex max-w-sm flex-col gap-2 sm:inset-x-auto sm:top-4 sm:right-4 sm:w-96 sm:max-w-none"
      >
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onOpen={open} onDismiss={dismiss} />
        ))}
      </div>
    </NotificationContext.Provider>
  )
}
