import { createContext, useContext } from 'react'
import { formatDate } from './format'

// การแจ้งเตือน (ตาราง notifications · migration 009) — ใช้ร่วมกันทั้งหน้าเจ้าหน้าที่และหน้าผู้เช่า
// RLS ให้เห็นเฉพาะของตัวเองอยู่แล้ว จึงไม่ต้องกรองผู้รับในคำสั่ง select

export const NOTIFICATION_COLS = 'notification_id, kind, title, body, link, read_at, created_at'
export const NOTIFICATION_LIMIT = 30

/** รายการล่าสุด + จำนวนที่ยังไม่อ่าน */
export async function fetchNotifications(client, limit = NOTIFICATION_LIMIT) {
  const [list, count] = await Promise.all([
    client.from('notifications').select(NOTIFICATION_COLS).order('notification_id', { ascending: false }).limit(limit),
    client.from('notifications').select('notification_id', { count: 'exact', head: true }).is('read_at', null),
  ])
  if (list.error) throw list.error
  if (count.error) throw count.error
  return { items: list.data ?? [], unread: count.count ?? 0 }
}

export async function markNotificationsRead(client, ids) {
  if (!ids.length) return
  const { error } = await client.from('notifications').update({ read_at: new Date().toISOString() }).in('notification_id', ids).is('read_at', null)
  if (error) throw error
}

export async function markAllNotificationsRead(client) {
  const { error } = await client.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
  if (error) throw error
}

// ไอคอน (Material Symbols) และโทนสีตามชนิด
const KIND = {
  payment_submitted: ['payments', 'amber'],
  payment_verified: ['check_circle', 'green'],
  payment_rejected: ['error', 'red'],
  receipt_voided: ['cancel', 'red'],
  invoice_issued: ['receipt_long', 'amber'],
  invoice_due_changed: ['event_available', 'amber'],
  invoice_cancelled: ['cancel', 'gray'],
  contract_requested: ['contract', 'amber'],
  contract_approved: ['handshake', 'green'],
  contract_created: ['handshake', 'green'],
  contract_rejected: ['cancel', 'red'],
  contract_cancelled: ['cancel', 'red'],
  contract_expired: ['event_busy', 'gray'],
  request_cancelled: ['undo', 'gray'],
  tenant_updated: ['person', 'gray'],
  line_linked: ['link', 'green'],
  welcome: ['check_circle', 'green'],
}

export function notificationLook(kind) {
  const [icon, tone] = KIND[kind] ?? ['notifications', 'gray']
  return { icon, tone }
}

export const TONE_CLASS = {
  green: 'bg-leaf-100 text-leaf-700',
  amber: 'bg-stall-reserved text-stall-reserved-ink',
  red: 'bg-danger-bg text-danger',
  gray: 'bg-stall-maint text-stall-maint-ink',
}

/** "เมื่อสักครู่" / "5 นาทีที่แล้ว" / "3 ชั่วโมงที่แล้ว" / "2 วันที่แล้ว" / "18 ต.ค. 2569" */
export function timeAgo(value, now = Date.now()) {
  const sec = Math.max(0, (now - new Date(value).getTime()) / 1000)
  if (sec < 60) return 'เมื่อสักครู่'
  if (sec < 3600) return `${Math.floor(sec / 60)} นาทีที่แล้ว`
  if (sec < 86400) return `${Math.floor(sec / 3600)} ชั่วโมงที่แล้ว`
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)} วันที่แล้ว`
  return formatDate(value)
}

// ---------------------------------------------------------------------
// context: NotificationProvider (components/notifications) เป็นผู้ให้ค่า
//   version  เพิ่มทุกครั้งที่มีแจ้งเตือนใหม่เข้ามา → หน้าที่ใช้ useLiveVersion() โหลดข้อมูลใหม่เอง
// ---------------------------------------------------------------------
export const NotificationContext = createContext(null)

export function useNotifications() {
  return useContext(NotificationContext)
}

/** ตัวเลขที่เปลี่ยนเมื่อมีแจ้งเตือนใหม่ (ใส่ใน key ของ useLoader) — นอก provider = 0 */
export function useLiveVersion() {
  return useContext(NotificationContext)?.version ?? 0
}
