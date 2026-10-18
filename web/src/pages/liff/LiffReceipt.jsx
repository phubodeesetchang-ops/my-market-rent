import { useParams } from 'react-router-dom'
import { bahtText } from '../../lib/bahttext'
import { formatBaht, formatDate, formatPeriod } from '../../lib/format'
import { PAYMENT_METHOD, label } from '../../lib/labels'
import { fetchReceipt } from '../../lib/liffData'
import { stallTitle } from '../../lib/stalls'
import { useLoader } from '../../lib/useLoader'
import { BackLink, ErrorBox, Loading } from './parts'

/** ใบเสร็จรับเงินแบบอ่านบนมือถือ (บันทึกภาพหน้าจอเก็บไว้ได้) */
export default function LiffReceipt() {
  const { id } = useParams()
  const { data: r, error, reload } = useLoader(() => fetchReceipt(Number(id)), id)
  const pay = r?.payments
  const inv = pay?.invoices
  const back = inv ? `/liff/bills/${inv.invoice_id}` : '/liff/bills'

  if (error && !r) {
    return (
      <>
        <BackLink to="/liff/bills">บิลทั้งหมด</BackLink>
        <ErrorBox message={error} onRetry={reload} />
      </>
    )
  }
  if (!r) return <Loading rows={2} />

  const contract = inv?.contracts
  const stall = contract?.stalls
  const voided = pay?.status === 'rejected'
  const partial = Number(r.amount) < Number(inv?.total_amount)
  const voidNote = voided ? (pay.note ?? '').split('\n').find((line) => line.startsWith('ยกเลิกใบเสร็จ')) : null

  return (
    <>
      <BackLink to={back}>บิลรอบ {formatPeriod(inv?.billing_period)}</BackLink>
      <article className="relative mt-1 overflow-hidden rounded-2xl border border-line bg-white" aria-label={`ใบเสร็จ ${r.receipt_no}`}>
        <header className="bg-leaf-700 px-5 py-4 text-white">
          <p className="text-sm text-leaf-100">{stall?.zones?.markets?.market_name}</p>
          <h1 className="text-xl font-semibold">ใบเสร็จรับเงิน</h1>
          <p className="tabular-nums">เลขที่ {r.receipt_no}</p>
        </header>
        {voided && (
          <p className="border-b border-[#f4c7c1] bg-danger-bg px-5 py-3 text-danger">
            <span className="font-semibold">ใบเสร็จนี้ถูกยกเลิกแล้ว</span> ใช้เป็นหลักฐานการชำระไม่ได้
            {voidNote ? <span className="block text-sm">{voidNote}</span> : null}
          </p>
        )}
        <div className="px-5 py-4">
          <p className="text-muted">ยอดรับชำระ</p>
          <p className={`text-[2rem] leading-tight font-bold tabular-nums ${voided ? 'text-muted line-through' : 'text-ink'}`}>{formatBaht(r.amount)}</p>
          <p className="text-sm text-muted">({bahtText(r.amount)})</p>

          <dl className="mt-4 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-line pt-4">
            {[
              ['วันที่', formatDate(r.receipt_date, { long: true })],
              ['ได้รับเงินจาก', contract?.tenants?.full_name],
              contract?.tenants?.business_name && ['ร้าน', contract.tenants.business_name],
              ['แผง', stall ? `${stallTitle(stall)} โซน ${stall.zones?.zone_name}` : '-'],
              ['รายการ', `ค่าเช่าและค่าบริการ รอบ ${formatPeriod(inv?.billing_period, { long: true })}${partial ? ' (ชำระบางส่วน)' : ''}`],
              ['ใบแจ้งหนี้', inv?.invoice_no],
              ['ชำระโดย', `${label(PAYMENT_METHOD, pay?.payment_method)} · ${formatDate(pay?.payment_date)}`],
              pay?.transaction_ref && ['เลขอ้างอิง', pay.transaction_ref],
              ['สัญญา', contract?.contract_no],
            ]
              .filter(Boolean)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="min-w-0 break-words text-ink">{v}</dd>
                </div>
              ))}
          </dl>
        </div>
      </article>
      <p className="mt-3 px-1 text-sm text-muted">ต้องการใบเสร็จฉบับพิมพ์ ขอได้ที่สำนักงานตลาด</p>
    </>
  )
}
