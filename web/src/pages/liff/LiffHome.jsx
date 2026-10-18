import { useState } from 'react'
import { Link } from 'react-router-dom'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { Badge } from '../../components/ui/feedback'
import { TimingBadge } from '../../components/contracts/TimingBadge'
import { contractTiming } from '../../lib/contracts'
import { formatBaht, formatDate, formatPeriod, todayISO } from '../../lib/format'
import { fetchContracts, fetchInvoices, fetchRecentReceipts } from '../../lib/liffData'
import { useLiff } from '../../lib/liffContext'
import { outstandingOf, pendingCountOf } from '../../lib/payments'
import { isOwing, stallLine } from '../../lib/tenantView'
import { useLoader } from '../../lib/useLoader'
import { Card, ErrorBox, Loading, SectionTitle } from './parts'

const PER = { monthly: 'เดือน', yearly: 'ปี' }

async function loadHome() {
  const [invoices, contracts, receipts] = await Promise.all([fetchInvoices(), fetchContracts(), fetchRecentReceipts(3)])
  return { invoices, contracts, receipts }
}

function BillSummary({ invoices }) {
  const today = todayISO()
  const owing = invoices.filter(isOwing)
  const total = owing.reduce((n, inv) => n + outstandingOf(inv), 0)
  const overdue = owing.filter((inv) => inv.due_date < today)
  const checking = invoices.reduce((n, inv) => n + pendingCountOf(inv), 0)
  const nextDue = owing.map((inv) => inv.due_date).sort()[0]

  if (owing.length === 0) {
    return (
      <Card className="border-leaf-300 bg-leaf-100">
        <p className="font-semibold text-leaf-800">ไม่มียอดค้างชำระ</p>
        <p className="text-sm text-muted">
          {checking > 0 ? `มีการแจ้งชำระรอเจ้าหน้าที่ตรวจสอบ ${checking} รายการ` : 'ขอบคุณที่ชำระตรงเวลา'}
        </p>
      </Card>
    )
  }
  return (
    <Card className={overdue.length ? 'border-[#f4c7c1]' : ''}>
      <p className="text-muted">ยอดค้างชำระ {owing.length} ใบ</p>
      <p className="text-[2rem] leading-tight font-bold text-ink tabular-nums" data-testid="owing-total">
        {formatBaht(total)}
      </p>
      <p className={`text-sm ${overdue.length ? 'font-medium text-danger' : 'text-muted'}`}>
        {overdue.length ? `เกินกำหนดชำระ ${overdue.length} ใบ` : `ครบกำหนด ${formatDate(nextDue)}`}
        {checking > 0 ? ` · รอตรวจสอบ ${checking} รายการ` : ''}
      </p>
      <Link to="/liff/bills" className="mt-3 flex w-full justify-center rounded-lg bg-leaf-700 px-4 py-2.5 font-semibold text-white">
        ดูบิลและชำระเงิน
      </Link>
    </Card>
  )
}

function ContractRow({ c, onCancel }) {
  const timing = contractTiming(c)
  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{stallLine(c.stalls)}</p>
          <p className="text-sm text-muted">
            {formatBaht(c.rent_amount)}
            {PER[c.rent_period] ? ` / ${PER[c.rent_period]}` : ''} · {formatDate(c.start_date)} – {formatDate(c.end_date)}
          </p>
        </div>
        {c.status === 'pending' ? <Badge tone="amber">รออนุมัติ</Badge> : <TimingBadge timing={timing} />}
      </div>
      {c.status === 'pending' && (
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <p className="text-sm text-muted">ส่งคำขอเมื่อ {formatDate(c.created_at)} · รอเจ้าหน้าที่ติดต่อกลับ</p>
          <button type="button" onClick={() => onCancel(c)} className="shrink-0 text-sm font-medium text-danger">
            ยกเลิกคำขอ
          </button>
        </div>
      )}
    </li>
  )
}

export default function LiffHome() {
  const { tenant, client } = useLiff()
  const { data, error, reload } = useLoader(loadHome, 'home')
  const [cancelling, setCancelling] = useState(null)
  const [notice, setNotice] = useState('')

  if (error && !data) return <ErrorBox message={error} onRetry={reload} />
  if (!data) return <Loading />

  const live = data.contracts.filter((c) => c.status === 'active' || c.status === 'pending')
  live.sort((a, b) => (a.status === b.status ? a.start_date.localeCompare(b.start_date) : a.status === 'active' ? -1 : 1))

  async function cancelRequest() {
    const { data: rows, error: e } = await client
      .from('contracts')
      .update({ status: 'cancelled' })
      .eq('contract_id', cancelling.contract_id)
      .select('contract_id')
    if (e) throw e
    if (!rows?.length) throw new Error('ยกเลิกไม่สำเร็จ คำขอนี้อาจได้รับการพิจารณาไปแล้ว')
    setNotice(`ยกเลิกคำขอเช่า ${stallLine(cancelling.stalls)} แล้ว`)
    setCancelling(null)
    reload()
  }

  return (
    <>
      <p className="mb-3 text-lg text-ink">
        สวัสดี <span className="font-semibold">คุณ{tenant.full_name.split(/\s+/)[0]}</span>
      </p>
      <BillSummary invoices={data.invoices} />

      {notice && (
        <p role="status" className="mt-4 rounded-lg bg-leaf-100 px-4 py-2.5 text-leaf-800">
          {notice}
        </p>
      )}

      <SectionTitle
        aside={
          <Link to="/liff/stalls" className="text-sm font-medium text-leaf-700">
            + ขอเช่าแผง
          </Link>
        }
      >
        แผงของฉัน
      </SectionTitle>
      {live.length === 0 ? (
        <Card className="border-dashed text-muted">
          ยังไม่มีแผงที่เช่าอยู่ ดูแผงว่างและส่งคำขอเช่าได้ที่เมนู{' '}
          <Link to="/liff/stalls" className="font-medium text-leaf-700 underline">
            เช่าแผง
          </Link>
        </Card>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white" aria-label="แผงของฉัน">
          {live.map((c) => (
            <ContractRow key={c.contract_id} c={c} onCancel={setCancelling} />
          ))}
        </ul>
      )}

      {data.receipts.length > 0 && (
        <>
          <SectionTitle>ใบเสร็จล่าสุด</SectionTitle>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
            {data.receipts.map((r) => (
              <li key={r.receipt_id}>
                <Link to={`/liff/receipts/${r.receipt_id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{r.receipt_no}</span>
                    <span className="block text-sm text-muted">
                      รอบ {formatPeriod(r.payments?.invoices?.billing_period)} · {formatDate(r.receipt_date)}
                      {r.payments?.status === 'rejected' ? ' · ยกเลิกแล้ว' : ''}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-ink">{formatBaht(r.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {cancelling && (
        <ConfirmDialog
          title="ยกเลิกคำขอเช่า"
          confirmLabel="ยกเลิกคำขอ"
          onConfirm={cancelRequest}
          onClose={() => setCancelling(null)}
        >
          <p>
            ยกเลิกคำขอเช่า <span className="font-semibold">{stallLine(cancelling.stalls)}</span>? แผงจะกลับเป็นว่างให้ผู้อื่นขอเช่าได้
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}
