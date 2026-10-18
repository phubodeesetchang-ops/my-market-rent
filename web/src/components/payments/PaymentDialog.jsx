import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { thaiError } from '../../lib/errors'
import { formatBaht, formatDate, formatDateTime, formatPeriod, formatPhone } from '../../lib/format'
import { PAYMENT_METHOD, label } from '../../lib/labels'
import { PAYMENT_STATE_LABEL, PAYMENT_STATE_TONE, outstandingOf, paidOf, paymentState, receiptOf } from '../../lib/payments'
import { numberProblem, toNumberOrNull } from '../../lib/validate'
import { useLoader } from '../../lib/useLoader'
import { can } from '../../auth/permissions'
import Modal, { DetailRows, ModalSection } from '../ui/Modal'
import { Badge } from '../ui/feedback'
import { Button, Field, FormError, TextArea, TextInput } from '../ui/form'
import { SlipViewer } from './SlipImage'

/** การชำระอื่นที่ใช้เลขอ้างอิงเดียวกัน (กันสลิปซ้ำ) */
async function fetchSameRef(payment) {
  if (!payment.transaction_ref) return []
  const { data, error } = await supabase
    .from('payments')
    .select('payment_id, status, amount, invoices(invoice_no)')
    .eq('transaction_ref', payment.transaction_ref)
    .neq('payment_id', payment.payment_id)
    .neq('status', 'rejected')
  if (error) throw error
  return data
}

export function PaymentStateBadge({ payment }) {
  const state = paymentState(payment)
  return <Badge tone={PAYMENT_STATE_TONE[state]}>{PAYMENT_STATE_LABEL[state]}</Badge>
}

/** ช่องเหตุผล + ปุ่มยืนยัน (ไม่ผ่าน / ยกเลิกใบเสร็จ) */
function ReasonForm({ title, hint, confirmLabel, busy, maxLength, onBack, onConfirm }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  return (
    <div className="space-y-3">
      <Field label={title} hint={hint} error={error}>
        <TextArea
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
            setError('')
          }}
          rows={2}
          maxLength={maxLength}
        />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onBack} disabled={busy}>
          ย้อนกลับ
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => (reason.trim() ? onConfirm(reason.trim()) : setError('กรุณาระบุเหตุผล'))}>
          {busy ? 'กำลังบันทึก…' : confirmLabel}
        </Button>
      </div>
    </div>
  )
}

/**
 * ตรวจการชำระ: ดูสลิป เทียบยอด → ผ่าน (ออกใบเสร็จ) / ไม่ผ่าน · ใบที่ตรวจแล้ว: พิมพ์/ยกเลิกใบเสร็จ (admin)
 * onChanged(text) หลังทำรายการสำเร็จ
 */
export default function PaymentDialog({ payment, role, onClose, onChanged }) {
  const p = payment
  const inv = p.invoices
  const tenant = inv?.contracts?.tenants
  const stall = inv?.contracts?.stalls
  const state = paymentState(p)
  const receipt = receiptOf(p)
  const otherPaid = paidOf({ payments: (inv?.payments ?? []).filter((x) => x.payment_id !== p.payment_id) })
  const outstanding = inv ? Math.max(0, outstandingOf({ ...inv, payments: (inv.payments ?? []).filter((x) => x.payment_id !== p.payment_id) })) : 0
  const sameRef = useLoader(() => fetchSameRef(p), `${p.payment_id}:${p.transaction_ref ?? ''}`)
  const [amount, setAmount] = useState(String(Math.min(Number(p.amount), outstanding || Number(p.amount))))
  const [amountError, setAmountError] = useState('')
  const [mode, setMode] = useState(null) // 'reject' | 'void'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canOperate = can(role, 'manageOperations')
  const isAdmin = role === 'admin'

  async function run(fn, text) {
    setBusy(true)
    setError('')
    const { data, error: e } = await fn()
    setBusy(false)
    if (e) return setError(thaiError(e))
    onChanged(typeof text === 'function' ? text(data) : text)
  }

  function verify() {
    const n = toNumberOrNull(amount)
    const problem = numberProblem(amount, 'ยอดที่ได้รับ', { required: true, positive: true }) || (n > outstanding ? `เกินยอดค้างชำระ (ค้าง ${formatBaht(outstanding)})` : '')
    setAmountError(problem)
    if (problem) return
    run(
      () => supabase.rpc('verify_payment', { p_payment_id: p.payment_id, p_amount: n }),
      (no) => `ตรวจผ่านแล้ว ออกใบเสร็จ ${no}${n >= outstanding ? ` — ${inv.invoice_no} ชำระครบแล้ว` : ` — ${inv.invoice_no} ยังค้าง ${formatBaht(outstanding - n)}`}`,
    )
  }

  const footer = (() => {
    if (!canOperate) return null
    if (state === 'pending') {
      if (mode === 'reject') {
        return (
          <>
            <FormError>{error}</FormError>
            <ReasonForm
              title="เหตุผลที่ไม่ผ่าน"
              hint="ผู้เช่าจะเห็นข้อความนี้ทาง LINE (ขั้นที่ 8) เช่น ยอดในสลิปไม่ตรง, สลิปซ้ำ, ไม่พบเงินเข้าบัญชี"
              confirmLabel="ยืนยันไม่ผ่าน"
              maxLength={500}
              busy={busy}
              onBack={() => setMode(null)}
              onConfirm={(reason) => run(() => supabase.rpc('reject_payment', { p_payment_id: p.payment_id, p_reason: reason }), 'บันทึกว่าไม่ผ่านแล้ว')}
            />
          </>
        )
      }
      return (
        <>
          <FormError>{error}</FormError>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Field label="ยอดที่ได้รับจริง (บาท)" error={amountError} className="w-52" hint={`ค้างชำระ ${formatBaht(outstanding)}`}>
              <TextInput
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  setAmountError('')
                }}
                inputMode="decimal"
                className="text-right tabular-nums"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger-ghost" onClick={() => setMode('reject')} disabled={busy}>
                ไม่ผ่าน…
              </Button>
              <Button variant="primary" size="md" onClick={verify} disabled={busy || outstanding <= 0}>
                {busy ? 'กำลังบันทึก…' : 'ผ่าน — ออกใบเสร็จ'}
              </Button>
            </div>
          </div>
        </>
      )
    }
    if (state === 'verified' && isAdmin) {
      if (mode === 'void') {
        return (
          <>
            <FormError>{error}</FormError>
            <ReasonForm
              title={`เหตุผลที่ยกเลิกใบเสร็จ ${receipt?.receipt_no ?? ''}`}
              hint="ใบเสร็จยังเก็บไว้แต่ขึ้นว่ายกเลิก ใบแจ้งหนี้จะกลับเป็นรอชำระ (ยกเลิกแล้วกลับคืนไม่ได้)"
              confirmLabel="ยืนยันยกเลิกใบเสร็จ"
              maxLength={400}
              busy={busy}
              onBack={() => setMode(null)}
              onConfirm={(reason) => run(() => supabase.rpc('void_payment', { p_payment_id: p.payment_id, p_reason: reason }), `ยกเลิกใบเสร็จ ${receipt?.receipt_no ?? ''} แล้ว`)}
            />
          </>
        )
      }
      return (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">ตรวจผิด (ยอดผิด/สลิปปลอม)? ผู้ดูแลระบบยกเลิกใบเสร็จได้</p>
          <Button variant="danger-ghost" onClick={() => setMode('void')}>
            ยกเลิกใบเสร็จ…
          </Button>
        </div>
      )
    }
    return null
  })()

  return (
    <Modal
      title={tenant?.full_name ?? 'การชำระเงิน'}
      subtitle={inv ? `${inv.invoice_no} · รอบ ${formatPeriod(inv.billing_period, { long: true })}` : undefined}
      badge={<PaymentStateBadge payment={p} />}
      onClose={onClose}
      busy={busy}
      size="lg"
      footer={footer}
    >
      <ModalSection>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <SlipViewer path={p.slip_image} />
          <div className="min-w-0 space-y-4">
            <p className="text-3xl font-semibold text-ink tabular-nums">{formatBaht(p.amount)}</p>
            <DetailRows
              rows={[
                { label: 'วิธีชำระ', value: label(PAYMENT_METHOD, p.payment_method) },
                { label: 'วันที่ชำระ', value: formatDate(p.payment_date, { long: true }) },
                p.transaction_ref && { label: 'เลขอ้างอิง', value: <span className="break-all">{p.transaction_ref}</span> },
                { label: 'แจ้งเมื่อ', value: <span className="whitespace-nowrap">{formatDateTime(p.created_at)}</span> },
                p.verified_at && { label: state === 'verified' ? 'ตรวจผ่านเมื่อ' : 'ตรวจเมื่อ', value: <span className="whitespace-nowrap">{formatDateTime(p.verified_at)}</span> },
                tenant?.phone && { label: 'โทร', value: formatPhone(tenant.phone) },
                stall && { label: stall.unit_type === 'room' ? 'ห้อง' : 'แผง', value: `${stall.stall_code} · ${stall.zones?.markets?.market_name ?? ''}` },
              ]}
            />
            {sameRef.data?.length > 0 && (
              <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-danger">
                เลขอ้างอิงนี้เคยใช้แล้วใน {sameRef.data.map((x) => `${x.invoices?.invoice_no ?? '-'} (${PAYMENT_STATE_LABEL[x.status]})`).join(', ')} — อาจเป็นสลิปซ้ำ
              </p>
            )}
            {inv && (
              <div className="rounded-lg border border-line bg-leaf-50 px-4 py-3">
                <p className="mb-1 text-sm font-semibold text-leaf-800">ใบแจ้งหนี้ {inv.invoice_no}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 text-sm tabular-nums">
                  <dt className="text-muted">ยอดใบแจ้งหนี้</dt>
                  <dd className="text-right">{formatBaht(inv.total_amount)}</dd>
                  <dt className="text-muted">ชำระแล้ว (รายการอื่น)</dt>
                  <dd className="text-right">{formatBaht(otherPaid)}</dd>
                  <dt className="font-medium text-ink">ค้างชำระ</dt>
                  <dd className="text-right font-semibold">{formatBaht(outstanding)}</dd>
                </dl>
                {state === 'pending' && Number(p.amount) > outstanding && (
                  <p className="mt-2 text-sm font-medium text-danger">ยอดที่แจ้งมากกว่ายอดค้าง — ตรวจสลิปแล้วแก้เป็นยอดที่ถูกต้อง หรือกดไม่ผ่าน</p>
                )}
                {inv.status === 'cancelled' && <p className="mt-2 text-sm text-danger">ใบแจ้งหนี้นี้ถูกยกเลิกแล้ว</p>}
              </div>
            )}
            {receipt && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  ใบเสร็จ <span className="font-semibold">{receipt.receipt_no}</span>
                  <span className="text-muted"> · {formatDate(receipt.receipt_date)}</span>
                </span>
                <Link to={`/print/receipt/${receipt.receipt_id}`} target="_blank" className="font-medium text-leaf-700 hover:underline">
                  พิมพ์ใบเสร็จ
                </Link>
              </p>
            )}
            {p.note && (
              <div className={`rounded-lg px-3 py-2 text-sm whitespace-pre-line ${state === 'pending' || state === 'verified' ? 'bg-leaf-50 text-ink' : 'bg-danger-bg text-danger'}`}>
                {state === 'rejected' ? 'เหตุผลที่ไม่ผ่าน: ' : 'หมายเหตุ: '}
                {p.note}
              </div>
            )}
          </div>
        </div>
      </ModalSection>
    </Modal>
  )
}
