import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { compareThai, currentPeriod, formatBaht, formatDate, formatNumber, formatPeriod } from '../../lib/format'
import { invoiceState, isPeriod } from '../../lib/billing'
import { INVOICE_STATUS } from '../../lib/labels'
import { outstandingOf, paidOf, pendingCountOf } from '../../lib/payments'
import { digitsOnly } from '../../lib/validate'
import { useLoader } from '../../lib/useLoader'
import { useAuth } from '../../auth/AuthProvider'
import { can } from '../../auth/permissions'
import { DataTable, EmptyBox, LoadError, Notice, PageHeader, Td, Th } from '../../components/ui/feedback'
import { Button, Field, SelectInput, TextInput } from '../../components/ui/form'
import { InvoiceStatusBadge, PeriodPicker } from '../../components/invoices/parts'
import InvoiceDialog from '../../components/invoices/InvoiceDialog'
import GenerateInvoicesDialog from '../../components/invoices/GenerateInvoicesDialog'

const INVOICE_SELECT =
  'invoice_id, invoice_no, contract_id, billing_period, rent_amount, water_amount, electricity_amount, fee_amount, total_amount, due_date, status, created_at, ' +
  'payments(payment_id, amount, status), ' +
  'contracts(contract_no, rent_period, status, tenants(tenant_id, full_name, business_name, phone), ' +
  'stalls(stall_id, stall_code, unit_type, zones(zone_name, markets(market_id, market_name, promptpay_id, promptpay_name))))'

async function fetchInvoices(period) {
  const { data, error } = await supabase.from('invoices').select(INVOICE_SELECT).eq('billing_period', period).order('invoice_no')
  if (error) throw error
  return data
}

const STATUS_FILTERS = [
  { value: 'all', label: 'ทั้งหมด ยกเว้นที่ยกเลิก' },
  { value: 'unpaid', label: 'รอชำระ (รวมเกินกำหนด)' },
  { value: 'overdue', label: INVOICE_STATUS.overdue },
  { value: 'paid', label: INVOICE_STATUS.paid },
  { value: 'cancelled', label: INVOICE_STATUS.cancelled },
]

function statusMatches(inv, filter) {
  if (filter === 'all') return inv.status !== 'cancelled'
  if (filter === 'overdue') return invoiceState(inv) === 'overdue'
  return inv.status === filter
}

/** ค้นจากเลขที่ใบแจ้งหนี้ ชื่อผู้เช่า ร้าน รหัสแผง หรือเบอร์โทร */
function matches(inv, query) {
  const text = query.trim().toLowerCase()
  if (!text) return true
  const c = inv.contracts ?? {}
  const t = c.tenants ?? {}
  if ([inv.invoice_no, c.contract_no, t.full_name, t.business_name, c.stalls?.stall_code].some((v) => v?.toLowerCase().includes(text))) return true
  const digits = digitsOnly(text)
  return digits.length >= 3 && digitsOnly(t.phone).includes(digits)
}

const stallOf = (inv) => inv.contracts?.stalls
const sum = (list, key) => list.reduce((n, i) => n + Number(i[key]), 0)
const byStall = (a, b) =>
  compareThai(stallOf(a)?.zones?.markets?.market_name, stallOf(b)?.zones?.markets?.market_name) || compareThai(stallOf(a)?.stall_code, stallOf(b)?.stall_code)

function TenantCell({ inv }) {
  const t = inv.contracts?.tenants
  const s = stallOf(inv)
  return (
    <div className="min-w-0">
      <p className="truncate font-medium text-ink">{t?.full_name ?? '-'}</p>
      <p className="truncate text-sm text-muted">
        {s?.unit_type === 'room' ? 'ห้อง' : 'แผง'} {s?.stall_code} · {s?.zones?.markets?.market_name}
      </p>
    </div>
  )
}

/** สถานะ + จ่ายบางส่วน + สลิปรอตรวจ */
function PayStatus({ inv }) {
  const part = inv.status === 'unpaid' ? paidOf(inv) : 0
  const waiting = pendingCountOf(inv)
  return (
    <div className="flex flex-col items-start gap-1">
      <InvoiceStatusBadge invoice={inv} />
      {part > 0 && <span className="text-xs text-muted tabular-nums">จ่ายแล้ว {formatBaht(part, { withUnit: false })}</span>}
      {waiting > 0 && <span className="text-xs font-medium text-stall-reserved-ink">สลิปรอตรวจ {formatNumber(waiting)}</span>}
    </div>
  )
}

const money = (v) => (Number(v) > 0 ? formatBaht(v, { withUnit: false }) : <span className="text-muted">-</span>)

export default function InvoicesPage() {
  const { role } = useAuth()
  const [params, setParams] = useSearchParams()
  const period = isPeriod(params.get('period')) ? params.get('period') : currentPeriod()
  const { data, error, loading, reload } = useLoader(() => fetchInvoices(period), period)
  const [status, setStatus] = useState('all')
  const [marketId, setMarketId] = useState('all')
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState(() => (Number(params.get('open')) ? { type: 'view', id: Number(params.get('open')) } : null))
  const [notice, setNotice] = useState(null)
  const canOperate = can(role, 'manageOperations')

  function changePeriod(p) {
    setParams({ period: p }, { replace: true })
    setNotice(null)
  }
  function closeDialog() {
    setDialog(null)
    if (params.get('open')) setParams({ period }, { replace: true })
  }

  const all = data ?? []
  const live = all.filter((i) => i.status !== 'cancelled')
  const markets = [...new Map(all.map((i) => [stallOf(i)?.zones?.markets?.market_id, stallOf(i)?.zones?.markets?.market_name])).entries()]
  const list = all
    .filter((i) => statusMatches(i, status) && (marketId === 'all' || String(stallOf(i)?.zones?.markets?.market_id) === marketId) && matches(i, query))
    .sort(byStall)
  const paid = live.filter((i) => i.status === 'paid')
  const unpaid = live.filter((i) => i.status === 'unpaid')
  const received = live.reduce((n, i) => n + paidOf(i), 0)
  const owed = (list) => list.reduce((n, i) => n + outstandingOf(i), 0)
  const overdue = unpaid.filter((i) => invoiceState(i) === 'overdue')
  const opened = dialog?.type === 'view' ? all.find((i) => i.invoice_id === dialog.id) : null

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="ใบแจ้งหนี้"
        description="ออกใบแจ้งหนี้รายเดือนจากสัญญาและเลขมิเตอร์ แล้วติดตามว่าใครชำระแล้ว"
        actions={
          canOperate && (
            <Button variant="primary" size="md" onClick={() => setDialog({ type: 'generate' })}>
              ออกใบแจ้งหนี้ {formatPeriod(period)}
            </Button>
          )
        }
      />
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <PeriodPicker className="w-60" value={period} onChange={changePeriod} />
        <Field label="สถานะ" className="w-60">
          <SelectInput value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </SelectInput>
        </Field>
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
          <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="เลขที่ ชื่อผู้เช่า รหัสแผง หรือเบอร์โทร" />
        </Field>
      </div>

      {error && <LoadError what="ใบแจ้งหนี้" message={error} onRetry={reload} />}
      {!data && !error && <p className="mt-8 text-muted" aria-live="polite">กำลังโหลดใบแจ้งหนี้…</p>}

      {data && (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={`สรุปรอบ ${formatPeriod(period, { long: true })}`}>
            {[
              ['ยอดเรียกเก็บ', formatBaht(sum(live, 'total_amount')), `${formatNumber(live.length)} ใบ`],
              ['รับชำระแล้ว', formatBaht(received), `ชำระครบ ${formatNumber(paid.length)} ใบ`],
              ['ค้างชำระ', formatBaht(owed(unpaid)), `${formatNumber(unpaid.length)} ใบ`],
              ['เกินกำหนด', `${formatNumber(overdue.length)} ใบ`, overdue.length ? `ค้าง ${formatBaht(owed(overdue))}` : 'ยังไม่มีใบที่เลยกำหนด'],
            ].map(([k, v, sub]) => (
              <div key={k} className="rounded-xl border border-line px-4 py-3">
                <dt className="text-sm text-muted">{k}</dt>
                <dd className={`text-xl font-semibold tabular-nums ${k === 'เกินกำหนด' && overdue.length ? 'text-danger' : 'text-ink'}`}>{v}</dd>
                <dd className="text-sm text-muted tabular-nums">{sub}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-5 mb-2 text-sm text-muted" aria-live="polite">
            แสดง {formatNumber(list.length)} จาก {formatNumber(all.length)} ใบ{loading && ' · กำลังโหลดใหม่…'}
          </p>

          {list.length === 0 ? (
            <EmptyBox>
              {all.length === 0 ? (
                <>
                  ยังไม่มีใบแจ้งหนี้รอบ {formatPeriod(period, { long: true })}
                  {canOperate && ' — จดมิเตอร์ให้ครบแล้วกดปุ่ม "ออกใบแจ้งหนี้" ด้านบน'}
                </>
              ) : (
                'ไม่พบใบแจ้งหนี้ที่ตรงกับตัวกรอง'
              )}
            </EmptyBox>
          ) : (
            <>
              {/* จอใหญ่: ตาราง */}
              <DataTable label="ใบแจ้งหนี้" className="hidden md:block">
                <thead>
                  <tr>
                    <Th>เลขที่</Th>
                    <Th>ผู้เช่า / แผง</Th>
                    <Th className="text-right">ค่าเช่า</Th>
                    <Th className="text-right">ค่าน้ำ</Th>
                    <Th className="text-right">ค่าไฟ</Th>
                    <Th className="text-right">ค่าธรรมเนียม</Th>
                    <Th className="text-right">รวม</Th>
                    <Th>ครบกำหนด</Th>
                    <Th>สถานะ</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((inv) => (
                    <tr key={inv.invoice_id} className={`hover:bg-leaf-50 ${inv.status === 'cancelled' ? 'text-muted' : ''}`}>
                      <Td>
                        <button type="button" className="font-medium text-leaf-700 hover:underline" onClick={() => setDialog({ type: 'view', id: inv.invoice_id })}>
                          {inv.invoice_no}
                        </button>
                      </Td>
                      <Td className="max-w-64">
                        <TenantCell inv={inv} />
                      </Td>
                      <Td className="text-right tabular-nums">{money(inv.rent_amount)}</Td>
                      <Td className="text-right tabular-nums">{money(inv.water_amount)}</Td>
                      <Td className="text-right tabular-nums">{money(inv.electricity_amount)}</Td>
                      <Td className="text-right tabular-nums">{money(inv.fee_amount)}</Td>
                      <Td className="text-right font-semibold tabular-nums">{formatBaht(inv.total_amount, { withUnit: false })}</Td>
                      <Td className="whitespace-nowrap">{formatDate(inv.due_date)}</Td>
                      <Td>
                        <PayStatus inv={inv} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>

              {/* มือถือ: การ์ด */}
              <ul className="space-y-2 md:hidden" aria-label="ใบแจ้งหนี้">
                {list.map((inv) => (
                  <li key={inv.invoice_id}>
                    <button
                      type="button"
                      onClick={() => setDialog({ type: 'view', id: inv.invoice_id })}
                      className="block w-full rounded-xl border border-line px-4 py-3 text-left hover:bg-leaf-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <TenantCell inv={inv} />
                        <PayStatus inv={inv} />
                      </div>
                      <div className="mt-1.5 flex items-baseline justify-between gap-3 text-sm text-muted">
                        <span>
                          {inv.invoice_no} · ครบกำหนด {formatDate(inv.due_date)}
                        </span>
                        <span className="shrink-0 text-base font-semibold whitespace-nowrap text-ink tabular-nums">{formatBaht(inv.total_amount)}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {opened && (
        <InvoiceDialog
          key={opened.invoice_id}
          invoice={opened}
          role={role}
          onClose={closeDialog}
          onChanged={reload}
          onCancelled={(text) => {
            closeDialog()
            setNotice({ tone: 'ok', text })
            reload()
          }}
        />
      )}
      {dialog?.type === 'generate' && (
        <GenerateInvoicesDialog
          period={period}
          onClose={() => setDialog(null)}
          onDone={(n) => {
            setDialog(null)
            setNotice({
              tone: 'ok',
              text: n > 0 ? `ออกใบแจ้งหนี้รอบ ${formatPeriod(period, { long: true })} แล้ว ${formatNumber(n)} ใบ` : 'ไม่มีใบแจ้งหนี้ที่ต้องออกเพิ่ม (ออกครบแล้ว)',
            })
            reload()
          }}
        />
      )}
    </div>
  )
}
