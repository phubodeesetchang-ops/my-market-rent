import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { thaiError } from '../../lib/errors'
import { formatBaht, formatDate, formatDateTime, formatNumber, formatPeriod, formatPhone } from '../../lib/format'
import { invoiceState } from '../../lib/billing'
import { PAYMENT_METHOD, RENT_PERIOD, label } from '../../lib/labels'
import { outstandingOf, paidOf, paymentState, receiptOf } from '../../lib/payments'
import { useLoader } from '../../lib/useLoader'
import { can } from '../../auth/permissions'
import Modal, { DetailRows, ModalSection } from '../ui/Modal'
import { Button, FormError } from '../ui/form'
import { PaymentStateBadge } from '../payments/PaymentDialog'
import { PromptPayQR } from '../payments/PromptPayQR'
import RecordPaymentDialog from '../payments/RecordPaymentDialog'
import { InvoiceStatusBadge } from './parts'

/** เลขมิเตอร์ที่อยู่ในใบนี้ + การชำระเงินของใบนี้ */
async function fetchDetail(invoiceId) {
  const [readings, payments] = await Promise.all([
    supabase
      .from('utility_readings')
      .select('reading_id, utility_type, previous_reading, current_reading, unit_used, rate_per_unit')
      .eq('invoice_id', invoiceId),
    supabase
      .from('payments')
      .select('payment_id, payment_date, amount, payment_method, status, note, transaction_ref, created_at, receipts(receipt_id, receipt_no)')
      .eq('invoice_id', invoiceId)
      .order('created_at'),
  ])
  if (readings.error) throw readings.error
  if (payments.error) throw payments.error
  return { readings: readings.data, payments: payments.data }
}

/** บรรทัดรายการในใบแจ้งหนี้ */
function Line({ title, detail, amount, strong = false }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${strong ? 'border-t border-line pt-2.5 text-lg font-semibold text-ink' : ''}`}>
      <div className="min-w-0">
        <p className={strong ? '' : 'text-ink'}>{title}</p>
        {detail && <p className="text-sm text-muted tabular-nums">{detail}</p>}
      </div>
      <p className="shrink-0 tabular-nums">{formatBaht(amount, { withUnit: strong })}</p>
    </div>
  )
}

function meterDetail(r) {
  if (!r) return 'ไม่ได้จดมิเตอร์ในรอบนี้'
  return `${formatNumber(r.previous_reading)} → ${formatNumber(r.current_reading)} = ${formatNumber(r.unit_used)} หน่วย × ${formatBaht(r.rate_per_unit, { withUnit: false })}`
}

/**
 * รายละเอียดใบแจ้งหนี้: รายการ, QR พร้อมเพย์ของยอดคงค้าง, การชำระ/ใบเสร็จ, รับชำระ, ยกเลิก
 * onChanged() หลังรับชำระ (ให้หน้าหลักโหลดใหม่ หน้าต่างยังเปิดอยู่) · onCancelled(text) หลังยกเลิกใบ
 */
export default function InvoiceDialog({ invoice, role, onClose, onChanged, onCancelled }) {
  const inv = invoice
  const contract = inv.contracts
  const tenant = contract?.tenants
  const stall = contract?.stalls
  const market = stall?.zones?.markets
  const detail = useLoader(() => fetchDetail(inv.invoice_id), inv.invoice_id)
  const [confirming, setConfirming] = useState(false)
  const [recording, setRecording] = useState(false)
  const [paidNotice, setPaidNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canOperate = can(role, 'manageOperations')
  const state = invoiceState(inv)

  const payments = detail.data?.payments ?? inv.payments ?? []
  const money = { ...inv, payments }
  const paid = paidOf(money)
  const outstanding = outstandingOf(money)
  const pending = payments.filter((p) => p.status === 'pending')
  const readingOf = (type) => detail.data?.readings.find((r) => r.utility_type === type)
  const rentDetail =
    contract?.rent_period === 'yearly'
      ? Number(inv.rent_amount) > 0
        ? 'ค่าเช่ารายปี (เดือนแรกของปีสัญญา)'
        : 'สัญญารายปี: เรียกเก็บค่าเช่าเฉพาะเดือนแรกของแต่ละปีสัญญา'
      : label(RENT_PERIOD, contract?.rent_period)
  const canCancel = canOperate && inv.status === 'unpaid' && paid === 0 && pending.length === 0

  async function cancel() {
    setBusy(true)
    setError('')
    const { data, error: e } = await supabase
      .from('invoices')
      .update({ status: 'cancelled' })
      .eq('invoice_id', inv.invoice_id)
      .eq('status', 'unpaid')
      .select('invoice_id')
    setBusy(false)
    if (e) return setError(thaiError(e))
    if (!data?.length) return setError('ยกเลิกไม่สำเร็จ ใบนี้อาจถูกชำระหรือยกเลิกไปแล้ว ลองปิดแล้วเปิดใหม่')
    onCancelled(`ยกเลิกใบแจ้งหนี้ ${inv.invoice_no} แล้ว — เลขมิเตอร์ของใบนี้แก้ไขได้อีกครั้ง และออกใบใหม่ได้จากปุ่ม "ออกใบแจ้งหนี้"`)
  }

  const footer =
    canOperate && inv.status === 'unpaid' ? (
      confirming ? (
        <div className="space-y-3">
          <p className="font-medium text-ink">
            ยกเลิกใบแจ้งหนี้ {inv.invoice_no}?{' '}
            <span className="font-normal text-muted">
              ยกเลิกแล้วกลับมาใช้ไม่ได้ เลขมิเตอร์ของใบนี้จะปลดล็อกให้แก้ แล้วออกใบใหม่แทนได้ (เลขที่ใบใหม่จะไม่ซ้ำเดิม)
            </span>
          </p>
          <FormError>{error}</FormError>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setConfirming(false)} disabled={busy}>
              ไม่ใช่
            </Button>
            <Button variant="danger" onClick={cancel} disabled={busy || detail.loading}>
              {busy ? 'กำลังยกเลิก…' : 'ยกเลิกใบแจ้งหนี้'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {canCancel ? (
            <Button variant="danger-ghost" onClick={() => setConfirming(true)} disabled={!detail.data}>
              ยกเลิกใบแจ้งหนี้
            </Button>
          ) : (
            <p className="text-sm text-muted">
              {pending.length > 0 ? 'มีสลิปรอตรวจ — ตรวจก่อนจึงยกเลิกใบได้' : paid > 0 ? 'มีการชำระแล้วบางส่วน จึงยกเลิกใบไม่ได้' : ''}
            </p>
          )}
          <Button variant="primary" size="md" onClick={() => setRecording(true)} disabled={!detail.data || outstanding <= 0}>
            รับชำระ
          </Button>
        </div>
      )
    ) : null

  return (
    <>
      <Modal
        title={inv.invoice_no}
        subtitle={`ใบแจ้งหนี้รอบ ${formatPeriod(inv.billing_period, { long: true })}`}
        badge={<InvoiceStatusBadge invoice={inv} />}
        onClose={onClose}
        busy={busy}
        size="lg"
        footer={footer}
      >
        {paidNotice && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 bg-leaf-100 px-6 py-3 text-leaf-800">
            <span>{paidNotice.text}</span>
            {paidNotice.receiptId && (
              <Link to={`/print/receipt/${paidNotice.receiptId}`} target="_blank" className="font-semibold underline">
                พิมพ์ใบเสร็จ
              </Link>
            )}
          </div>
        )}
        <ModalSection
          title="ข้อมูลใบแจ้งหนี้"
          aside={
            <Link to={`/print/invoice/${inv.invoice_id}`} target="_blank" className="text-sm font-medium text-leaf-700 hover:underline">
              พิมพ์ใบแจ้งหนี้
            </Link>
          }
        >
          <DetailRows
            rows={[
              { label: 'ผู้เช่า', value: tenant ? `${tenant.full_name}${tenant.business_name ? ` (${tenant.business_name})` : ''}` : '-' },
              tenant?.phone && { label: 'โทร', value: formatPhone(tenant.phone) },
              {
                label: stall?.unit_type === 'room' ? 'ห้อง' : 'แผง',
                value: stall ? `${stall.stall_code} · ${market?.market_name ?? ''} โซน ${stall.zones?.zone_name ?? ''}` : '-',
              },
              {
                label: 'สัญญา',
                value: (
                  <Link to={`/admin/contracts?tab=${contract?.status === 'active' ? 'active' : 'history'}&open=${inv.contract_id}`} className="font-medium text-leaf-700 hover:underline">
                    {contract?.contract_no ?? inv.contract_id}
                  </Link>
                ),
              },
              {
                label: 'ครบกำหนดชำระ',
                value: (
                  <span className={state === 'overdue' ? 'font-medium text-danger' : ''}>
                    {formatDate(inv.due_date, { long: true })}
                    {state === 'overdue' && ' (เลยกำหนดแล้ว)'}
                  </span>
                ),
              },
              { label: 'ออกเมื่อ', value: formatDateTime(inv.created_at) },
            ]}
          />
        </ModalSection>

        <ModalSection title="รายการ">
          {detail.error && <p className="mb-2 text-sm text-danger">โหลดรายละเอียดไม่สำเร็จ: {detail.error}</p>}
          <div className={inv.status === 'cancelled' ? 'text-muted line-through decoration-muted/50' : ''}>
            <Line title="ค่าเช่า" detail={rentDetail} amount={inv.rent_amount} />
            <Line title="ค่าน้ำ" detail={detail.data ? meterDetail(readingOf('water')) : '…'} amount={inv.water_amount} />
            <Line title="ค่าไฟฟ้า" detail={detail.data ? meterDetail(readingOf('electricity')) : '…'} amount={inv.electricity_amount} />
            <Line title="ค่าธรรมเนียม" detail="ค่าบริการส่วนกลางของตลาด" amount={inv.fee_amount} />
            <Line title="รวมทั้งสิ้น" amount={inv.total_amount} strong />
          </div>
          {inv.status === 'cancelled' && <p className="mt-2 text-sm text-muted">ใบนี้ถูกยกเลิกแล้ว ไม่ต้องชำระ</p>}
        </ModalSection>

        <ModalSection title="การชำระเงิน">
          {inv.status !== 'cancelled' && (
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
              <dl className="grid min-w-48 grid-cols-[auto_1fr] gap-x-6 gap-y-1 tabular-nums">
                <dt className="text-muted">ชำระแล้ว</dt>
                <dd className="text-right">{formatBaht(paid)}</dd>
                <dt className="font-medium text-ink">ค้างชำระ</dt>
                <dd className={`text-right font-semibold ${outstanding > 0 ? 'text-ink' : 'text-leaf-700'}`}>{formatBaht(outstanding)}</dd>
              </dl>
              {outstanding > 0 &&
                (market?.promptpay_id ? (
                  <PromptPayQR promptpayId={market.promptpay_id} name={market.promptpay_name} amount={outstanding} size={148} />
                ) : (
                  <p className="max-w-64 rounded-lg border border-dashed border-line bg-leaf-50 px-3 py-2 text-sm text-muted">
                    {market?.market_name ?? 'ตลาดนี้'}ยังไม่ได้ตั้งพร้อมเพย์ จึงยังไม่มี QR —{' '}
                    {role === 'admin' ? (
                      <Link to="/admin/markets" className="font-medium text-leaf-700 underline">
                        ตั้งที่หน้าตลาด
                      </Link>
                    ) : (
                      'แจ้งผู้ดูแลระบบให้ตั้งที่หน้าตลาด'
                    )}
                  </p>
                ))}
            </div>
          )}
          {!detail.data && !detail.error && <p className="mt-3 text-muted">กำลังโหลด…</p>}
          {detail.data && payments.length === 0 && inv.status !== 'cancelled' && <p className="mt-3 text-muted">ยังไม่มีการชำระ</p>}
          {payments.length > 0 && (
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {payments.map((p) => {
                const receipt = receiptOf(p)
                const st = paymentState(p)
                return (
                  <li key={p.payment_id} className="py-2">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                      <span>
                        {formatDate(p.payment_date)} · {label(PAYMENT_METHOD, p.payment_method)}
                        {receipt && <span className="text-muted"> · ใบเสร็จ {receipt.receipt_no}</span>}
                      </span>
                      <span className="flex items-center gap-2 tabular-nums">
                        <span className={st === 'verified' || st === 'pending' ? '' : 'text-muted line-through'}>{formatBaht(p.amount)}</span>
                        <PaymentStateBadge payment={p} />
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-4 text-sm">
                      {receipt && (
                        <Link to={`/print/receipt/${receipt.receipt_id}`} target="_blank" className="font-medium text-leaf-700 hover:underline">
                          พิมพ์ใบเสร็จ
                        </Link>
                      )}
                      {st === 'pending' && canOperate && (
                        <Link to={`/admin/payments?open=${p.payment_id}`} className="font-medium text-leaf-700 hover:underline">
                          ไปตรวจสลิป
                        </Link>
                      )}
                      {p.note && st !== 'verified' && <span className="text-muted whitespace-pre-line">{p.note}</span>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </ModalSection>
      </Modal>

      {recording && (
        <RecordPaymentDialog
          invoice={money}
          onClose={() => setRecording(false)}
          onDone={({ receiptNo, receiptId, full }) => {
            setRecording(false)
            setPaidNotice({ text: `รับชำระแล้ว ออกใบเสร็จ ${receiptNo}${full ? ' — ชำระครบแล้ว' : ''}`, receiptId })
            detail.reload()
            onChanged?.()
          }}
        />
      )}
    </>
  )
}
