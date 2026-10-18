import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { currentPeriod, formatBaht, formatDate, formatDateTime, formatNumber, formatPeriod } from '../../lib/format'
import { isPeriod, shiftPeriod } from '../../lib/billing'
import { PAYMENT_METHOD, label } from '../../lib/labels'
import { PAYMENT_SELECT, outstandingOf, paymentState, receiptOf, slipUrls } from '../../lib/payments'
import { digitsOnly } from '../../lib/validate'
import { useLoader } from '../../lib/useLoader'
import { useAuth } from '../../auth/AuthProvider'
import { EmptyBox, LoadError, Notice, PageHeader } from '../../components/ui/feedback'
import { Field, SelectInput, TextInput } from '../../components/ui/form'
import { PeriodPicker } from '../../components/invoices/parts'
import PaymentDialog, { PaymentStateBadge } from '../../components/payments/PaymentDialog'
import { SlipThumb } from '../../components/payments/SlipImage'

const TABS = [
  { key: 'pending', label: 'รอตรวจสอบ' },
  { key: 'verified', label: 'ตรวจแล้ว' },
  { key: 'rejected', label: 'ไม่ผ่าน / ยกเลิก' },
]

const monthRange = (period) => [`${period}-01`, `${shiftPeriod(period, 1)}-01`]

async function fetchPayments(tab, month) {
  let q = supabase.from('payments').select(PAYMENT_SELECT).eq('status', tab)
  if (tab === 'pending') q = q.order('created_at', { ascending: true })
  else {
    const [from, to] = monthRange(month)
    q = q.gte('payment_date', from).lt('payment_date', to).order('verified_at', { ascending: false })
  }
  const { data, error } = await q
  if (error) throw error
  const urls = await slipUrls(data.map((p) => p.slip_image)).catch(() => ({}))
  return { rows: data, urls }
}

async function fetchPendingCount() {
  const { count, error } = await supabase.from('payments').select('payment_id', { count: 'exact', head: true }).eq('status', 'pending')
  if (error) throw error
  return count ?? 0
}

/** ค้นจากชื่อผู้เช่า ร้าน เลขใบแจ้งหนี้ เลขอ้างอิง เลขใบเสร็จ รหัสแผง หรือเบอร์โทร */
function matches(p, query) {
  const text = query.trim().toLowerCase()
  if (!text) return true
  const inv = p.invoices ?? {}
  const t = inv.contracts?.tenants ?? {}
  const fields = [t.full_name, t.business_name, inv.invoice_no, p.transaction_ref, receiptOf(p)?.receipt_no, inv.contracts?.stalls?.stall_code]
  if (fields.some((v) => v?.toLowerCase().includes(text))) return true
  const digits = digitsOnly(text)
  return digits.length >= 3 && digitsOnly(t.phone).includes(digits)
}

const marketOf = (p) => p.invoices?.contracts?.stalls?.zones?.markets

function PaymentRow({ p, url, onOpen }) {
  const inv = p.invoices ?? {}
  const t = inv.contracts?.tenants
  const s = inv.contracts?.stalls
  const receipt = receiptOf(p)
  const state = paymentState(p)
  const overpaid = state === 'pending' && Number(p.amount) > outstandingOf(inv)
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-leaf-50">
        <SlipThumb url={url} hasSlip={Boolean(p.slip_image)} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="truncate font-medium text-ink">{t?.full_name ?? '-'}</span>
            <span className="text-lg font-semibold text-ink tabular-nums">{formatBaht(p.amount)}</span>
          </span>
          <span className="block truncate text-sm text-muted">
            {s?.unit_type === 'room' ? 'ห้อง' : 'แผง'} {s?.stall_code} · {marketOf(p)?.market_name} · {inv.invoice_no} ({formatPeriod(inv.billing_period)})
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <PaymentStateBadge payment={p} />
            <span className="text-muted">
              {label(PAYMENT_METHOD, p.payment_method)} · ชำระ {formatDate(p.payment_date)}
              {state === 'pending' ? ` · แจ้งเมื่อ ${formatDateTime(p.created_at)}` : ''}
            </span>
            {receipt && <span className="text-muted">ใบเสร็จ {receipt.receipt_no}</span>}
            {overpaid && <span className="font-medium text-danger">ยอดเกินยอดค้าง</span>}
          </span>
        </span>
      </button>
    </li>
  )
}

export default function PaymentsPage() {
  const { role } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'pending'
  const month = isPeriod(params.get('month')) ? params.get('month') : currentPeriod()
  const { data, error, loading, reload } = useLoader(() => fetchPayments(tab, month), `${tab}:${month}`)
  const pendingCount = useLoader(fetchPendingCount, 'pending')
  const [query, setQuery] = useState('')
  const [marketId, setMarketId] = useState('all')
  const [openId, setOpenId] = useState(() => Number(params.get('open')) || null)
  const [notice, setNotice] = useState(null)

  const setParam = (changes) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }

  const rows = data?.rows ?? []
  const markets = [...new Map(rows.map((p) => [marketOf(p)?.market_id, marketOf(p)?.market_name])).entries()].filter(([id]) => id)
  const list = rows.filter((p) => (marketId === 'all' || String(marketOf(p)?.market_id) === marketId) && matches(p, query))
  const opened = openId ? rows.find((p) => p.payment_id === openId) : null
  const total = list.reduce((n, p) => n + Number(p.amount), 0)

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="ตรวจการชำระเงิน" description="ตรวจสลิปที่ผู้เช่าแจ้งโอน เทียบกับยอดในใบแจ้งหนี้ ผ่านแล้วระบบออกใบเสร็จให้ทันที · รับเงินสดที่สำนักงานได้จากหน้าใบแจ้งหนี้" />
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <div role="tablist" aria-label="สถานะการชำระ" className="mt-6 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const active = t.key === tab
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setParam({ tab: t.key === 'pending' ? null : t.key, open: null })
                setNotice(null)
              }}
              className={`rounded-lg px-4 py-2 font-medium ${active ? 'bg-leaf-700 text-white' : 'border border-line bg-white text-ink hover:bg-leaf-100'}`}
            >
              {t.label}
              {t.key === 'pending' && pendingCount.data > 0 && (
                <span className={`ml-2 rounded-full px-2 py-0.5 text-sm tabular-nums ${active ? 'bg-white/20' : 'bg-stall-reserved text-stall-reserved-ink'}`}>
                  {formatNumber(pendingCount.data)}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        {tab !== 'pending' && (
          <PeriodPicker label="เดือนที่ชำระ" className="w-60" value={month} onChange={(m) => setParam({ month: m })} />
        )}
        {markets.length > 1 && (
          <Field label="ตลาด" className="w-44">
            <SelectInput value={marketId} onChange={(e) => setMarketId(e.target.value)}>
              <option value="all">ทุกตลาด</option>
              {markets.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </SelectInput>
          </Field>
        )}
        <Field label="ค้นหา" className="min-w-0 flex-1 basis-48">
          <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ชื่อผู้เช่า เลขใบแจ้งหนี้ เลขอ้างอิง เลขใบเสร็จ หรือเบอร์โทร" />
        </Field>
      </div>

      {error && <LoadError what="รายการชำระเงิน" message={error} onRetry={reload} />}
      {!data && !error && <p className="mt-8 text-muted" aria-live="polite">กำลังโหลด…</p>}
      {data && (
        <>
          <p className="mt-5 mb-2 text-sm text-muted tabular-nums" aria-live="polite">
            {formatNumber(list.length)} รายการ · รวม {formatBaht(total)}
            {tab !== 'pending' && ` · ชำระใน${formatPeriod(month, { long: true })}`}
            {loading && ' · กำลังโหลดใหม่…'}
          </p>
          {list.length === 0 ? (
            <EmptyBox>
              {rows.length > 0
                ? 'ไม่พบรายการที่ตรงกับตัวกรอง'
                : tab === 'pending'
                  ? 'ไม่มีสลิปรอตรวจ — เมื่อผู้เช่าแจ้งโอนผ่าน LINE รายการจะขึ้นที่นี่'
                  : `ไม่มีรายการ${TABS.find((t) => t.key === tab).label}ที่ชำระใน${formatPeriod(month, { long: true })}`}
            </EmptyBox>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line" aria-label="รายการชำระเงิน">
              {list.map((p) => (
                <PaymentRow key={p.payment_id} p={p} url={data.urls[p.slip_image]} onOpen={() => setOpenId(p.payment_id)} />
              ))}
            </ul>
          )}
        </>
      )}

      {opened && (
        <PaymentDialog
          key={opened.payment_id}
          payment={opened}
          role={role}
          onClose={() => {
            setOpenId(null)
            if (params.get('open')) setParam({ open: null })
          }}
          onChanged={(text) => {
            setOpenId(null)
            if (params.get('open')) setParam({ open: null })
            setNotice({ tone: 'ok', text })
            reload()
            pendingCount.reload()
          }}
        />
      )}
    </div>
  )
}
