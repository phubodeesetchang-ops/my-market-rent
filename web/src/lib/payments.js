// ตัวช่วยการชำระเงิน: ยอดคงค้าง, สถานะที่แสดง, อัปโหลด/เปิดดูสลิป
import { supabase } from './supabase'

/** การชำระพร้อมใบเสร็จ ใบแจ้งหนี้ (และการชำระอื่นของใบนั้น) ผู้เช่า แผง ตลาด — ใช้ในหน้าตรวจการชำระ */
export const PAYMENT_SELECT =
  'payment_id, invoice_id, payment_date, amount, payment_method, slip_image, transaction_ref, status, note, verified_at, created_at, ' +
  'receipts(receipt_id, receipt_no, receipt_date), ' +
  'invoices(invoice_id, invoice_no, billing_period, total_amount, status, due_date, payments(payment_id, amount, status), ' +
  'contracts(contract_no, tenants(tenant_id, full_name, business_name, phone), stalls(stall_code, unit_type, zones(zone_name, markets(market_id, market_name)))))'

export const SLIP_BUCKET = 'slips'
export const SLIP_MAX_BYTES = 5 * 1024 * 1024
const SLIP_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const money = (n) => Math.round(Number(n) * 100) / 100

/** ยอดที่ตรวจแล้ว / คงค้างของใบแจ้งหนี้ (ต้อง embed payments(amount, status) มาด้วย) */
export function paidOf(invoice) {
  return money((invoice.payments ?? []).filter((p) => p.status === 'verified').reduce((n, p) => n + Number(p.amount), 0))
}
export function outstandingOf(invoice) {
  if (invoice.status === 'cancelled') return 0
  return Math.max(0, money(Number(invoice.total_amount) - paidOf(invoice)))
}
export const pendingCountOf = (invoice) => (invoice.payments ?? []).filter((p) => p.status === 'pending').length

/**
 * สถานะที่แสดงของการชำระ: pending | verified | rejected | voided
 * voided = เคยตรวจผ่านและออกใบเสร็จแล้ว ผู้ดูแลระบบยกเลิกภายหลัง (ใบเสร็จยังอยู่)
 */
export function paymentState(p) {
  const receipt = Array.isArray(p.receipts) ? p.receipts[0] : p.receipts
  if (p.status === 'rejected' && receipt) return 'voided'
  return p.status
}
export const receiptOf = (p) => (Array.isArray(p.receipts) ? p.receipts[0] : p.receipts) ?? null

export const PAYMENT_STATE_LABEL = { pending: 'รอตรวจสอบ', verified: 'ตรวจแล้ว', rejected: 'ไม่ผ่าน', voided: 'ยกเลิกใบเสร็จ' }
export const PAYMENT_STATE_TONE = { pending: 'amber', verified: 'green', rejected: 'red', voided: 'gray' }

/** ตรวจไฟล์สลิปก่อนอัปโหลด */
export function slipProblem(file) {
  if (!file) return ''
  if (!SLIP_TYPES.includes(file.type)) return 'ไฟล์สลิปต้องเป็นรูป JPG, PNG หรือ WebP'
  return ''
}

/** ย่อรูปให้ด้านยาวไม่เกิน 1600px เป็น JPEG (รูปจากมือถือมักใหญ่ 3–5 MB) — ย่อไม่ได้ก็ส่งไฟล์เดิม */
async function shrinkImage(file) {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size <= 1024 * 1024) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    return blob && blob.size < file.size ? new File([blob], 'slip.jpg', { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

const STORAGE_MESSAGES = [
  [/row-level security|unauthorized|not authorized/i, 'ไม่มีสิทธิ์อัปโหลดสลิปของใบแจ้งหนี้นี้'],
  [/exceeded the maximum allowed size|too large|payload too large/i, 'ไฟล์สลิปใหญ่เกิน 5 MB'],
  [/mime type|invalid_mime_type/i, 'ไฟล์สลิปต้องเป็นรูป JPG, PNG หรือ WebP'],
  [/bucket not found/i, 'ยังไม่มีที่เก็บสลิป (bucket "slips") — รัน migration 007 ก่อน'],
]
export function storageError(error) {
  const msg = error?.message ?? String(error)
  return STORAGE_MESSAGES.find(([re]) => re.test(msg))?.[1] ?? `อัปโหลดสลิปไม่สำเร็จ: ${msg}`
}

/**
 * อัปโหลดสลิปไปที่ <tenant_id>/<invoice_id>/<สุ่ม>.<นามสกุล> → คืน path สำหรับเก็บใน payments.slip_image
 * client: หน้าผู้เช่า (LIFF) ส่ง Supabase client ของผู้เช่ามา · ไม่ส่ง = client ของเจ้าหน้าที่
 */
export async function uploadSlip(file, tenantId, invoiceId, client = supabase) {
  const small = await shrinkImage(file)
  if (small.size > SLIP_MAX_BYTES) throw new Error('ไฟล์สลิปใหญ่เกิน 5 MB')
  const ext = small.type === 'image/png' ? 'png' : small.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${tenantId}/${invoiceId}/${crypto.randomUUID()}.${ext}`
  const { error } = await client.storage.from(SLIP_BUCKET).upload(path, small, { contentType: small.type, upsert: false })
  if (error) throw new Error(storageError(error))
  return path
}

/** ลิงก์ชั่วคราว (10 นาที) สำหรับเปิดดูสลิปหลายรูปพร้อมกัน → { path: url } */
export async function slipUrls(paths, client = supabase) {
  const list = [...new Set(paths.filter(Boolean))]
  if (list.length === 0) return {}
  const { data, error } = await client.storage.from(SLIP_BUCKET).createSignedUrls(list, 600)
  if (error) throw error
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]))
}
