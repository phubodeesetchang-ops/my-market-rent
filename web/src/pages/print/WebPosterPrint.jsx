import { supabase } from '../../lib/supabase'
import { SITE_QR_FILES, SITE_QR_MATCHES, SITE_URL } from '../../lib/site'
import { useLoader } from '../../lib/useLoader'
import { GridIcon } from '../../components/BrandMark'
import QrImage from '../../components/QrImage'
import PrintLayout from './PrintLayout'

async function fetchMarketNames() {
  const { data, error } = await supabase.from('markets').select('market_name').eq('status', 'active').order('market_id')
  if (error) throw error
  return data.map((m) => m.market_name)
}

const WHO = [
  ['ผู้เช่าแผง', 'กดปุ่ม "เข้าใช้งานด้วย LINE" แล้วผูกบัญชีครั้งแรกด้วยเลขบัตรประชาชน + เบอร์โทร ดูบิล จ่ายพร้อมเพย์ ส่งสลิป ขอเช่าแผง'],
  ['เจ้าหน้าที่ตลาด', 'เข้าสู่ระบบด้วยอีเมลและรหัสผ่านที่ผู้ดูแลระบบให้ไว้ ใช้ได้ทั้งมือถือและคอมพิวเตอร์'],
]

/** ป้าย A5: QR เข้าเว็บไซต์ของระบบ (ติดที่สำนักงาน/บอร์ดตลาด) + ไฟล์รูป QR ให้ดาวน์โหลด */
export default function WebPosterPrint() {
  const { data: markets } = useLoader(fetchMarketNames, 'markets')
  const host = SITE_URL.replace(/^https?:\/\//, '')

  return (
    <PrintLayout title="ป้าย QR เว็บไซต์" backTo="/admin/tenants" loading={false} error={null}>
      <div className="flex flex-col items-center text-center">
        <div className="flex items-center gap-2">
          <GridIcon className="size-8" />
          <p className="text-[11pt] font-semibold text-leaf-800">{markets?.length ? markets.join(' · ') : 'แผงค้าตลาด'}</p>
        </div>
        <h1 className="mt-3 text-[22pt] leading-tight font-bold">เว็บไซต์ระบบแผงค้าตลาด</h1>
        <p className="mt-1 text-[11pt] text-muted">สแกนเพื่อเปิดเว็บไซต์ ดูบิลและจัดการแผงได้จากมือถือ</p>

        <div className="mt-5 rounded-2xl border-[3px] border-leaf-700 p-3">
          <QrImage text={SITE_URL} size={230} alt={`QR เข้าเว็บไซต์ ${SITE_URL}`} />
        </div>
        <p className="mt-2 font-semibold text-leaf-800">สแกนเลย</p>
        <p className="text-[11pt] font-semibold break-all text-ink">{host}</p>

        <ul className="mt-5 w-full space-y-2 text-left">
          {WHO.map(([title, detail]) => (
            <li key={title} className="rounded-xl border border-line px-4 py-2.5">
              <span className="block font-semibold text-leaf-800">{title}</span>
              <span className="block text-[10pt] leading-snug text-muted">{detail}</span>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-[9pt] text-muted">สอบถามหรือลืมรหัสผ่าน ติดต่อสำนักงานตลาด</p>

        {SITE_QR_MATCHES && (
          <p className="mt-4 text-sm print:hidden">
            ไฟล์รูป QR สำหรับโพสต์/ทำป้ายเอง:{' '}
            <a href={SITE_QR_FILES.png} download className="font-medium text-leaf-700 underline">
              PNG
            </a>{' '}
            ·{' '}
            <a href={SITE_QR_FILES.svg} download className="font-medium text-leaf-700 underline">
              SVG
            </a>
          </p>
        )}
      </div>
    </PrintLayout>
  )
}
