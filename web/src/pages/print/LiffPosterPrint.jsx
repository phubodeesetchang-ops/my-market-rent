import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { LIFF_ID, liffUrl } from '../../lib/liff'
import { useLoader } from '../../lib/useLoader'
import PrintLayout from './PrintLayout'

function QrImage({ text, size }) {
  const [img, setImg] = useState({ text: null, src: null })
  useEffect(() => {
    let cancelled = false
    QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#1e2b22', light: '#ffffff' } }).then(
      (svg) => !cancelled && setImg({ text, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` }),
    )
    return () => {
      cancelled = true
    }
  }, [text])
  const src = img.text === text ? img.src : null
  return src ? <img src={src} width={size} height={size} alt={`QR เปิดหน้าผู้เช่าใน LINE ${text}`} /> : <div style={{ width: size, height: size }} className="animate-pulse bg-leaf-50" />
}

async function fetchMarketNames() {
  const { data, error } = await supabase.from('markets').select('market_name').eq('status', 'active').order('market_id')
  if (error) throw error
  return data.map((m) => m.market_name)
}

const STEPS = [
  ['สแกน QR', 'ด้วยกล้องมือถือหรือในแอป LINE แล้วกด "อนุญาต"'],
  ['ผูกบัญชีครั้งแรก', 'กรอกเลขบัตรประชาชนและเบอร์โทรที่ให้ไว้กับสำนักงาน · ผู้เช่าใหม่ติดต่อสำนักงานเพื่อเพิ่มข้อมูลก่อน'],
  ['ใช้งานได้ทันที', 'ดูบิล สแกนจ่ายพร้อมเพย์ ส่งสลิป ดูใบเสร็จ และขอเช่าแผงว่าง'],
]

/** ป้าย A5 ให้ผู้เช่าสแกนเปิดหน้าผู้เช่าใน LINE (ติดที่สำนักงาน/บอร์ดตลาด) */
export default function LiffPosterPrint() {
  const { data: markets } = useLoader(fetchMarketNames, 'markets')
  const url = liffUrl()
  const error = LIFF_ID ? null : 'ยังไม่ได้ตั้งค่า VITE_LIFF_ID (LIFF ID จาก LINE Developers) ในไฟล์ .env และใน Vercel — ดู README ขั้นที่ 8 แล้ว build/deploy ใหม่'

  return (
    <PrintLayout title="ป้าย QR ผู้เช่า" backTo="/admin/tenants" loading={false} error={error}>
      <div className="flex flex-col items-center text-center">
        <p className="text-[11pt] font-semibold text-leaf-800">{markets?.length ? markets.join(' · ') : 'ตลาด'}</p>
        <h1 className="mt-2 text-[22pt] leading-tight font-bold">ผู้เช่าแผง ดูบิลและจ่ายค่าเช่า ผ่าน LINE</h1>
        <p className="mt-1 text-[11pt] text-muted">ไม่ต้องเดินมาสำนักงาน ไม่ต้องจำรหัสผ่าน</p>

        <div className="mt-5 rounded-2xl border-[3px] border-leaf-700 p-3">
          <QrImage text={url} size={230} />
        </div>
        <p className="mt-2 font-semibold text-leaf-800">สแกนเลย</p>
        <p className="text-[9pt] break-all text-muted">{url}</p>

        <ol className="mt-5 w-full space-y-2 text-left">
          {STEPS.map(([title, detail], i) => (
            <li key={title} className="flex items-start gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-leaf-700 font-bold text-white">{i + 1}</span>
              <span className="min-w-0 leading-snug">
                <span className="block font-semibold">{title}</span>
                <span className="block text-[10pt] text-muted">{detail}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-[9pt] text-muted">สอบถามหรือเปลี่ยนมือถือ/บัญชี LINE ติดต่อสำนักงานตลาด</p>
      </div>
    </PrintLayout>
  )
}
