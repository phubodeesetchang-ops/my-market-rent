import { useEffect, useState } from 'react'
import MaterialIcon from '../icons/MaterialIcon'
import Modal from '../ui/Modal'
import { formatBaht } from '../../lib/format'
import { paymentQrImage, saveImage } from '../../lib/qrCard'

/**
 * ปุ่ม "บันทึกรูป QR" (หน้าบิลของผู้เช่า)
 * สร้างรูปไว้ล่วงหน้าตั้งแต่เปิดหน้า → กดแล้วเปิดเมนูแชร์/ดาวน์โหลดได้ทันที
 * (เบราว์เซอร์บนมือถือยอมให้แชร์ไฟล์เฉพาะตอนที่เพิ่งกดปุ่มเท่านั้น จึงสร้างรูปตอนกดไม่ได้)
 * เบราว์เซอร์ในแอป LINE บางรุ่นบันทึกไฟล์ไม่ได้ → มี "ดูรูปเต็ม" ให้แตะค้างที่รูปเพื่อบันทึก
 */
export default function PaymentQrSave({ promptpayId, name, amount, invoiceNo, period, dueDate, place }) {
  const [image, setImage] = useState({ key: null, blob: null, url: null, error: '' })
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState(false)
  const key = [promptpayId, name, amount, invoiceNo, period, dueDate, place].join('|')

  useEffect(() => {
    let cancelled = false
    paymentQrImage({ promptpayId, name, amount, invoiceNo, period, dueDate, place })
      .then(async (blob) => {
        // รูปตัวอย่างใช้ data URL (แตะค้างบันทึกได้ในเบราว์เซอร์ทุกแบบ รวมถึงในแอป LINE)
        const url = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(blob)
        })
        if (!cancelled) setImage({ key, blob, url, error: '' })
      })
      .catch((e) => !cancelled && setImage({ key, blob: null, url: null, error: e.message }))
    return () => {
      cancelled = true
    }
    // key รวมทุกค่าที่ใช้วาดรูปแล้ว
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = image.key === key && image.blob
  const filename = `qr-${invoiceNo || 'promptpay'}.png`

  async function save() {
    if (!ready) return
    setStatus('')
    const result = await saveImage(image.blob, filename)
    if (result === 'downloaded') setStatus('บันทึกรูปแล้ว (ดูในรูปภาพ/ไฟล์ดาวน์โหลด) — ถ้าไม่พบรูป กด "ดูรูปเต็ม" แล้วแตะค้างที่รูป')
    if (result === 'shared') setStatus('เลือก "บันทึกรูปภาพ" ในเมนูแชร์ แล้วเปิดแอปธนาคารเพื่อสแกนจากรูป')
  }

  return (
    <div className="mt-3 flex w-full flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!ready}
          className="inline-flex items-center gap-1.5 rounded-lg bg-leaf-700 py-2 pr-4 pl-3 font-medium text-white hover:bg-leaf-800 disabled:opacity-60"
        >
          <MaterialIcon name="download" className="size-5" />
          {ready || image.error ? 'บันทึกรูป QR' : 'กำลังเตรียมรูป…'}
        </button>
        <button
          type="button"
          onClick={() => setPreview(true)}
          disabled={!ready}
          className="inline-flex items-center gap-1.5 rounded-lg border border-leaf-300 bg-white py-2 pr-4 pl-3 font-medium text-leaf-800 hover:bg-leaf-50 disabled:opacity-60"
        >
          <MaterialIcon name="qr_code_2" className="size-5" />
          ดูรูปเต็ม
        </button>
      </div>
      {image.error && <p className="text-sm text-danger">สร้างรูปไม่สำเร็จ: {image.error} · แตะค้างที่รูป QR ด้านบนเพื่อบันทึกแทน</p>}
      {status && (
        <p role="status" className="text-sm text-leaf-800">
          {status}
        </p>
      )}

      {preview && ready && (
        <Modal title="รูป QR สำหรับบันทึก" subtitle={`ยอด ${formatBaht(amount)}`} onClose={() => setPreview(false)}>
          <div className="flex flex-col items-center gap-3">
            <img src={image.url} alt={`รูป QR พร้อมเพย์ ยอด ${formatBaht(amount)}`} className="w-full max-w-xs rounded-lg border border-line" />
            <p className="text-center text-sm text-muted">แตะค้างที่รูป แล้วเลือก &quot;บันทึกรูปภาพ&quot; จากนั้นเปิดแอปธนาคาร เลือก &quot;สแกน&quot; และเลือกรูปนี้จากอัลบั้ม</p>
          </div>
        </Modal>
      )}
    </div>
  )
}
