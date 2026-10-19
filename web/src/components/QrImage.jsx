import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { GridIcon } from './BrandMark'

/**
 * QR สำหรับพิมพ์ (SVG คมชัด) · logo = วางโลโก้ระบบกลาง QR (ใช้ระดับแก้ผิด H สแกนได้แม้บังบางส่วน)
 */
export default function QrImage({ text, size, logo = true, alt }) {
  const [img, setImg] = useState({ text: null, src: null })
  useEffect(() => {
    let cancelled = false
    QRCode.toString(text, { type: 'svg', errorCorrectionLevel: logo ? 'H' : 'M', margin: 1, color: { dark: '#1e2b22', light: '#ffffff' } }).then(
      (svg) => !cancelled && setImg({ text, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` }),
    )
    return () => {
      cancelled = true
    }
  }, [text, logo])
  const src = img.text === text ? img.src : null
  if (!src) return <div style={{ width: size, height: size }} className="animate-pulse bg-leaf-50" />
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <img src={src} width={size} height={size} alt={alt ?? `QR ${text}`} />
      {logo && (
        <span className="absolute top-1/2 left-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[18%] bg-white" style={{ width: size * 0.25, height: size * 0.25 }}>
          <GridIcon style={{ width: size * 0.2, height: size * 0.2 }} />
        </span>
      )}
    </div>
  )
}
