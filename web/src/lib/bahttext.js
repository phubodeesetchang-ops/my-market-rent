// จำนวนเงินเป็นตัวอักษรภาษาไทย สำหรับใบเสร็จ/ใบแจ้งหนี้ เช่น 585 → "ห้าร้อยแปดสิบห้าบาทถ้วน"

const DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน']

/** อ่านเลขไม่เกิน 6 หลัก · afterHigher = มีหลักล้านนำหน้า (1 ตัวท้ายอ่าน "เอ็ด") */
function readGroup(n, afterHigher) {
  const s = String(n)
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i])
    const place = s.length - 1 - i
    if (d === 0) continue
    if (place === 1) out += d === 1 ? 'สิบ' : d === 2 ? 'ยี่สิบ' : `${DIGITS[d]}สิบ`
    else if (place === 0) out += d === 1 && (s.length > 1 || afterHigher) ? 'เอ็ด' : DIGITS[d]
    else out += DIGITS[d] + PLACES[place]
  }
  return out
}

function readInteger(n, afterHigher = false) {
  if (n >= 1_000_000) {
    const high = Math.floor(n / 1_000_000)
    const low = n % 1_000_000
    return `${readInteger(high)}ล้าน${low ? readGroup(low, true) : ''}`
  }
  return readGroup(n, afterHigher)
}

export function bahtText(amount) {
  const satangTotal = Math.round(Math.abs(Number(amount) || 0) * 100)
  const baht = Math.floor(satangTotal / 100)
  const satang = satangTotal % 100
  if (baht === 0 && satang === 0) return 'ศูนย์บาทถ้วน'
  const bahtPart = baht ? `${readInteger(baht)}บาท` : ''
  return bahtPart + (satang ? `${readInteger(satang)}สตางค์` : 'ถ้วน')
}
