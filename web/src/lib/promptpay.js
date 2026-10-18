// QR พร้อมเพย์ตามมาตรฐาน EMVCo (Thai QR Payment) — สร้างในเครื่อง ไม่ต้องเรียกบริการภายนอก
// แอปธนาคารทุกแห่งในไทยอ่านได้ · ถ้าใส่ยอดเงิน ยอดจะขึ้นในแอปให้เอง ผู้เช่าแก้ไม่ได้
import { digitsOnly } from './validate'

const AID_PROMPTPAY = 'A000000677010111'

/** ฟิลด์แบบ ID + ความยาว 2 หลัก + ค่า */
const tlv = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`

/** CRC-16/CCITT-FALSE (poly 0x1021, เริ่ม 0xFFFF) ตามที่มาตรฐานกำหนด */
export function crc16(text) {
  let crc = 0xffff
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** เบอร์มือถือ 10 หลัก (ขึ้นต้น 0) หรือเลขผู้เสียภาษี/บัตรประชาชน 13 หลัก — ต้องตรงกับ CHECK ในฐานข้อมูล */
export function promptPayProblem(value) {
  const d = digitsOnly(value)
  if (!d) return 'กรุณากรอกเลขพร้อมเพย์'
  if (/^0\d{9}$/.test(d) || /^\d{13}$/.test(d)) return ''
  return 'ใช้เบอร์มือถือ 10 หลัก (ขึ้นต้นด้วย 0) หรือเลขผู้เสียภาษี/บัตรประชาชน 13 หลัก'
}

/**
 * ข้อความที่อยู่ใน QR
 * @param {string} id  เบอร์มือถือหรือเลข 13 หลัก (มีขีดได้)
 * @param {number} [amount]  ยอดเงิน (ไม่ใส่ = ผู้โอนกรอกยอดเอง)
 */
export function promptPayPayload(id, amount) {
  const d = digitsOnly(id)
  if (promptPayProblem(d)) throw new Error('เลขพร้อมเพย์ไม่ถูกต้อง')
  const target = d.length === 10 ? tlv('01', `0066${d.slice(1)}`) : tlv('02', d)
  const hasAmount = amount !== undefined && amount !== null && Number(amount) > 0
  const body =
    tlv('00', '01') +
    tlv('01', hasAmount ? '12' : '11') +
    tlv('29', tlv('00', AID_PROMPTPAY) + target) +
    tlv('58', 'TH') +
    tlv('53', '764') +
    (hasAmount ? tlv('54', Number(amount).toFixed(2)) : '') +
    '6304'
  return body + crc16(body)
}

/** '0812345678' → "081-234-5678" · 13 หลัก → "0-9940-00123-45-6" */
export function formatPromptPayId(id) {
  const d = digitsOnly(id)
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 13) return `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`
  return id ?? ''
}
