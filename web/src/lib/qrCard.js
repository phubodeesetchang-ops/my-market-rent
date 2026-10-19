import QRCode from 'qrcode'
import { formatBaht, formatDate, formatPeriod } from './format'
import { formatPromptPayId, promptPayPayload } from './promptpay'

// รูป QR พร้อมเพย์สำหรับบันทึกลงเครื่อง แล้วเปิดในแอปธนาคาร ("สแกน" → เลือกรูปจากอัลบั้ม)
// วาดบน canvas ในเครื่อง ไม่ส่งข้อมูลออกไปที่ไหน · QR อยู่บนพื้นขาวล้วน ขอบกว้าง แอปธนาคารอ่านง่าย

const W = 720
const H = 1040
const C = { green: '#2f7a3b', greenInk: '#245f2e', pale: '#e3f0e0', ink: '#1e2b22', muted: '#4b5e50', line: '#d9e6d5' }
const FONT = '"Sarabun", "Tahoma", sans-serif'

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** เขียนข้อความกึ่งกลาง ย่อขนาดลงถ้ายาวเกินความกว้าง */
function centerText(ctx, text, y, { size, weight = 400, color = C.ink, max = W - 80 }) {
  let px = size
  ctx.font = `${weight} ${px}px ${FONT}`
  while (ctx.measureText(text).width > max && px > 14) {
    px -= 1
    ctx.font = `${weight} ${px}px ${FONT}`
  }
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, W / 2, y)
}

async function loadFonts() {
  if (!document.fonts?.load) return
  try {
    await Promise.all([400, 600, 700].map((w) => document.fonts.load(`${w} 32px Sarabun`, 'ชำระ0')))
  } catch {
    // โหลดฟอนต์ไม่ได้ ใช้ฟอนต์ของเครื่องแทน (QR ยังสแกนได้ปกติ)
  }
}

/**
 * สร้างรูป PNG (Blob) ของ QR พร้อมเพย์พร้อมรายละเอียดบิล
 * @param {{ promptpayId: string, name?: string, amount: number, invoiceNo?: string, period?: string, dueDate?: string, place?: string }} p
 */
export async function paymentQrImage({ promptpayId, name, amount, invoiceNo, period, dueDate, place }) {
  const payload = promptPayPayload(promptpayId, amount)
  await loadFonts()

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // แถบหัว
  ctx.fillStyle = C.green
  ctx.fillRect(0, 0, W, 148)
  centerText(ctx, 'สแกนจ่ายค่าเช่าด้วยพร้อมเพย์', 72, { size: 40, weight: 700, color: '#ffffff' })
  if (place) centerText(ctx, place, 118, { size: 26, color: C.pale })

  // QR
  const size = 520
  const qr = document.createElement('canvas')
  await QRCode.toCanvas(qr, payload, { errorCorrectionLevel: 'M', margin: 2, width: size, color: { dark: C.ink, light: '#ffffff' } })
  const x = (W - size) / 2
  const y = 186
  roundRect(ctx, x - 14, y - 14, size + 28, size + 28, 22)
  ctx.lineWidth = 3
  ctx.strokeStyle = C.line
  ctx.stroke()
  ctx.drawImage(qr, x, y, size, size)

  // ยอดและรายละเอียด
  centerText(ctx, 'ยอดชำระ', 772, { size: 26, color: C.muted })
  centerText(ctx, formatBaht(amount), 834, { size: 58, weight: 700, color: C.greenInk })
  centerText(ctx, `พร้อมเพย์ ${formatPromptPayId(promptpayId)}${name ? ` · ${name}` : ''}`, 884, { size: 26, weight: 600 })
  const bill = [invoiceNo && `บิล ${invoiceNo}`, period && `รอบ ${formatPeriod(period)}`, dueDate && `ครบกำหนด ${formatDate(dueDate)}`]
    .filter(Boolean)
    .join(' · ')
  if (bill) centerText(ctx, bill, 926, { size: 23, color: C.muted })

  ctx.fillStyle = C.pale
  ctx.fillRect(0, H - 76, W, 76)
  centerText(ctx, 'เปิดแอปธนาคาร → สแกน → เลือกรูปนี้จากอัลบั้ม', H - 28, { size: 24, weight: 600, color: C.greenInk })

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('สร้างรูป QR ไม่สำเร็จ'))), 'image/png')
  })
}

/**
 * บันทึกรูปลงเครื่อง
 * มือถือที่แชร์ไฟล์ได้ → เปิดเมนูแชร์ (เลือก "บันทึกรูปภาพ") · ไม่ได้ → ดาวน์โหลดไฟล์
 * คืนค่า 'shared' | 'downloaded' | 'cancelled'
 */
export async function saveImage(blob, filename) {
  const file = typeof File === 'function' ? new File([blob], filename, { type: blob.type || 'image/png' }) : null
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled'
      // แชร์ไม่ได้ (เช่น เบราว์เซอร์ในแอปไม่อนุญาต) → ดาวน์โหลดแทน
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'downloaded'
}
