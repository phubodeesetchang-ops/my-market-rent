import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { formatBaht } from '../../lib/format'
import { formatPromptPayId, promptPayPayload, promptPayProblem } from '../../lib/promptpay'

/**
 * QR พร้อมเพย์ (SVG คมชัดทั้งบนจอและตอนพิมพ์)
 * amount ไม่ใส่ = QR รับเงินทั่วไป (ใช้ทดสอบสแกนดูชื่อบัญชี)
 * png = ทำเป็นรูป PNG แทน (บนมือถือแตะค้างเพื่อบันทึกรูป แล้วเปิดในแอปธนาคารได้)
 */
export function PromptPayQR({ promptpayId, name, amount, size = 176, caption = true, png = false, className = '' }) {
  const valid = promptpayId && !promptPayProblem(promptpayId)
  const payload = valid ? promptPayPayload(promptpayId, amount) : null
  const [svg, setSvg] = useState({ payload: null, src: null })

  useEffect(() => {
    if (!payload) return
    let cancelled = false
    const colors = { dark: '#1e2b22', light: '#ffffff' }
    const make = png
      ? QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, width: size * 3, color: colors })
      : QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: colors }).then(
          (text) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`,
        )
    make
      .then((src) => !cancelled && setSvg({ payload, src }))
      .catch(() => !cancelled && setSvg({ payload, src: null }))
    return () => {
      cancelled = true
    }
  }, [payload, png, size])

  if (!valid) return null
  const src = svg.payload === payload ? svg.src : null
  return (
    <figure className={`inline-flex flex-col items-center gap-1.5 ${className}`}>
      <div className="rounded-lg border border-line bg-white p-1.5" style={{ width: size + 14, height: size + 14 }}>
        {src ? (
          <img src={src} width={size} height={size} alt={`QR พร้อมเพย์ ${formatPromptPayId(promptpayId)}${amount ? ` ยอด ${formatBaht(amount)}` : ''}`} />
        ) : (
          <div className="h-full w-full animate-pulse rounded bg-leaf-50" aria-hidden="true" />
        )}
      </div>
      {caption && (
        <figcaption className="text-center text-sm leading-snug">
          <span className="block font-semibold text-ink">พร้อมเพย์ {formatPromptPayId(promptpayId)}</span>
          {name && <span className="block text-muted">{name}</span>}
          {amount ? <span className="block font-semibold text-leaf-800 tabular-nums">ยอด {formatBaht(amount)}</span> : null}
        </figcaption>
      )}
    </figure>
  )
}
