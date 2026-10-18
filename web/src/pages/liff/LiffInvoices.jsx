import { Link } from 'react-router-dom'
import { formatBaht, formatDate, formatPeriod } from '../../lib/format'
import { fetchInvoices } from '../../lib/liffData'
import { outstandingOf, paidOf } from '../../lib/payments'
import { isOwing, stallLine } from '../../lib/tenantView'
import { useLoader } from '../../lib/useLoader'
import { Card, ErrorBox, InvoiceBadge, Loading, PageTitle, SectionTitle } from './parts'

function InvoiceItem({ inv }) {
  const owing = isOwing(inv)
  const paid = paidOf(inv)
  return (
    <li>
      <Link to={`/liff/bills/${inv.invoice_id}`} className="block px-4 py-3" aria-label={`บิลรอบ ${formatPeriod(inv.billing_period, { long: true })} ${stallLine(inv.contracts?.stalls)}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-ink">รอบ {formatPeriod(inv.billing_period, { long: true })}</p>
            <p className="truncate text-sm text-muted">{stallLine(inv.contracts?.stalls)}</p>
          </div>
          <InvoiceBadge invoice={inv} />
        </div>
        <div className="mt-1 flex items-end justify-between gap-3">
          <p className="text-sm text-muted">
            {owing ? `ชำระภายใน ${formatDate(inv.due_date)}` : inv.invoice_no}
            {owing && paid > 0 ? ` · จ่ายแล้ว ${formatBaht(paid)}` : ''}
          </p>
          <p className="shrink-0 text-right font-semibold whitespace-nowrap text-ink tabular-nums">
            {formatBaht(owing ? outstandingOf(inv) : inv.total_amount)}
          </p>
        </div>
      </Link>
    </li>
  )
}

export default function LiffInvoices() {
  const { data, error, reload } = useLoader(fetchInvoices, 'bills')
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />
  if (!data) return <Loading />

  const owing = data.filter(isOwing).sort((a, b) => a.due_date.localeCompare(b.due_date))
  const others = data.filter((inv) => !isOwing(inv))

  return (
    <>
      <PageTitle sub="แตะที่บิลเพื่อดูรายละเอียด สแกนจ่าย และส่งสลิป">บิลค่าเช่า</PageTitle>
      {data.length === 0 && <Card className="border-dashed text-muted">ยังไม่มีใบแจ้งหนี้</Card>}
      {owing.length > 0 && (
        <>
          <SectionTitle>ต้องชำระ</SectionTitle>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-white" aria-label="บิลที่ต้องชำระ">
            {owing.map((inv) => (
              <InvoiceItem key={inv.invoice_id} inv={inv} />
            ))}
          </ul>
        </>
      )}
      {others.length > 0 && (
        <>
          <SectionTitle>ประวัติ</SectionTitle>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-white" aria-label="ประวัติบิล">
            {others.map((inv) => (
              <InvoiceItem key={inv.invoice_id} inv={inv} />
            ))}
          </ul>
        </>
      )}
    </>
  )
}
