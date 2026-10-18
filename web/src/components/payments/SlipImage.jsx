import { slipUrls } from '../../lib/payments'
import { useLoader } from '../../lib/useLoader'

/** รูปสลิปขนาดเต็มในหน้าต่างตรวจ (ขอ signed URL เอง) — กดเพื่อเปิดรูปเต็มในแท็บใหม่ */
export function SlipViewer({ path, className = '' }) {
  const { data, error } = useLoader(() => slipUrls([path]), path ?? '')
  if (!path) {
    return (
      <div className={`flex min-h-40 items-center justify-center rounded-lg border border-dashed border-line bg-leaf-50 px-4 text-center text-muted ${className}`}>
        ไม่มีรูปสลิป
      </div>
    )
  }
  const url = data?.[path]
  if (error || (data && !url)) {
    return <p className={`rounded-lg bg-danger-bg px-3 py-2 text-danger ${className}`}>เปิดรูปสลิปไม่ได้{error ? `: ${error}` : ''}</p>
  }
  if (!url) return <div className={`min-h-64 animate-pulse rounded-lg bg-leaf-50 ${className}`} aria-label="กำลังโหลดรูปสลิป" />
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`block overflow-hidden rounded-lg border border-line bg-leaf-50 ${className}`} title="เปิดรูปเต็มในแท็บใหม่">
      <img src={url} alt="รูปสลิปการโอนเงิน" className="mx-auto max-h-[42vh] w-auto object-contain md:max-h-[60vh]" />
    </a>
  )
}

/** รูปย่อในรายการ (ใช้ URL ที่ขอไว้รวมกันทั้งหน้า) */
export function SlipThumb({ url, hasSlip }) {
  if (!hasSlip) {
    return (
      <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded border border-dashed border-line bg-leaf-50 text-center text-[11px] leading-tight text-muted">
        ไม่มีสลิป
      </span>
    )
  }
  return url ? (
    <img src={url} alt="" className="h-16 w-12 shrink-0 rounded border border-line bg-leaf-50 object-cover" />
  ) : (
    <span className="h-16 w-12 shrink-0 animate-pulse rounded bg-leaf-50" aria-hidden="true" />
  )
}
