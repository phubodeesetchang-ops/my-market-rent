import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PromptPayQR } from '../../components/payments/PromptPayQR'
import { Badge } from '../../components/ui/feedback'
import { Button, Field, FormError, TextInput } from '../../components/ui/form'
import { thaiError } from '../../lib/errors'
import { formatBaht, formatDate, formatDateTime, formatNumber, formatPeriod, todayISO } from '../../lib/format'
import { PAYMENT_METHOD, label } from '../../lib/labels'
import { fetchInvoice } from '../../lib/liffData'
import { useLiff } from '../../lib/liffContext'
import {
  PAYMENT_STATE_LABEL,
  PAYMENT_STATE_TONE,
  outstandingOf,
  paidOf,
  paymentState,
  receiptOf,
  slipProblem,
  slipUrls,
  uploadSlip,
} from '../../lib/payments'
import { isOwing, stallLine } from '../../lib/tenantView'
import { useLoader } from '../../lib/useLoader'
import { clearProblem, collectProblems, numberProblem } from '../../lib/validate'
import { BackLink, Card, ErrorBox, InvoiceBadge, Loading, SectionTitle } from './parts'

const money = (n) => Math.round(Number(n) * 100) / 100
const amountText = (n) => (n > 0 ? n.toFixed(2).replace(/\.00$/, '') : '')

const meterText = (r) =>
  r ? `${formatNumber(r.previous_reading)} → ${formatNumber(r.current_reading)} = ${formatNumber(r.unit_used)} หน่วย × ${formatBaht(r.rate_per_unit, { withUnit: false })}` : null

function Breakdown({ invoice, readings }) {
  const reading = (type) => readings.find((r) => r.utility_type === type)
  const yearly = invoice.contracts?.rent_period === 'yearly'
  const rows = [
    ['ค่าเช่า', yearly ? 'ค่าเช่ารายปี' : 'รายเดือน', invoice.rent_amount],
    ['ค่าน้ำ', meterText(reading('water')), invoice.water_amount],
    ['ค่าไฟฟ้า', meterText(reading('electricity')), invoice.electricity_amount],
    ['ค่าธรรมเนียม', 'ค่าบริการส่วนกลาง', invoice.fee_amount],
  ].filter(([name, , amount]) => name === 'ค่าเช่า' || Number(amount) > 0)
  const paid = paidOf(invoice)

  return (
    <Card className="mt-3">
      <dl className="divide-y divide-line">
        {rows.map(([name, detail, amount]) => (
          <div key={name} className="flex items-start justify-between gap-3 py-2 first:pt-0">
            <dt className="min-w-0">
              <span className="block text-ink">{name}</span>
              {detail && <span className="block text-sm text-muted">{detail}</span>}
            </dt>
            <dd className="shrink-0 tabular-nums text-ink">{formatBaht(amount, { withUnit: false })}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 pt-2.5">
          <dt className="font-semibold text-ink">รวม</dt>
          <dd className="text-lg font-bold tabular-nums text-ink">{formatBaht(invoice.total_amount)}</dd>
        </div>
        {paid > 0 && invoice.status !== 'paid' && (
          <>
            <div className="flex justify-between gap-3 pt-1.5 text-muted">
              <dt>ชำระแล้ว</dt>
              <dd className="tabular-nums">{formatBaht(paid)}</dd>
            </div>
            <div className="flex justify-between gap-3 pt-1 font-semibold text-ink">
              <dt>คงค้าง</dt>
              <dd className="tabular-nums">{formatBaht(outstandingOf(invoice))}</dd>
            </div>
          </>
        )}
      </dl>
    </Card>
  )
}

/** ส่งสลิปแจ้งชำระ (สถานะรอตรวจสอบ เจ้าหน้าที่ตรวจแล้วจึงออกใบเสร็จ) */
function SlipForm({ invoice, maxAmount, onSent }) {
  const { tenant, client } = useLiff()
  const [values, setValues] = useState({ amount: amountText(maxAmount), date: todayISO(), ref: '' })
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  const set = (key) => (e) => {
    setValues((v) => ({ ...v, [key]: e.target.value }))
    setErrors(clearProblem(key))
  }

  async function submit(e) {
    e.preventDefault()
    const amount = money(String(values.amount).replaceAll(',', ''))
    const problems = collectProblems({
      amount: numberProblem(values.amount, 'ยอดที่โอน', { required: true, positive: true }) || (amount > maxAmount ? `ยอดที่โอนต้องไม่เกิน ${formatBaht(maxAmount)}` : ''),
      date: !values.date ? 'กรุณาเลือกวันที่โอน' : values.date > todayISO() ? 'วันที่โอนต้องไม่เกินวันนี้' : '',
      file: file ? slipProblem(file) : 'กรุณาแนบรูปสลิป',
    })
    setErrors(problems)
    if (Object.keys(problems).length) return

    setBusy(true)
    setError('')
    try {
      const path = await uploadSlip(file, tenant.tenant_id, invoice.invoice_id, client)
      const { error: e2 } = await client
        .from('payments')
        .insert({
          invoice_id: invoice.invoice_id,
          amount,
          payment_method: 'promptpay',
          payment_date: values.date,
          transaction_ref: values.ref.trim() || null,
          slip_image: path,
        })
        .select('payment_id')
        .single()
      if (e2) throw e2
      onSent(amount)
    } catch (err) {
      setError(thaiError(err))
      setBusy(false)
    }
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-4" aria-label="ส่งสลิป">
      <div>
        <span className="mb-1 block font-medium text-ink" aria-hidden="true">
          แนบรูปสลิป
        </span>
        {/* ปุ่มเลือกไฟล์ทำเอง: ปุ่มของเบราว์เซอร์เป็นภาษาอังกฤษในบางเครื่อง */}
        <label
          className={`flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 focus-within:ring-2 focus-within:ring-leaf-300 ${
            errors.file ? 'border-danger bg-danger-bg' : 'border-leaf-300 bg-leaf-50'
          }`}
        >
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="แนบรูปสลิป"
            aria-invalid={errors.file ? true : undefined}
            aria-describedby={errors.file ? 'slip-error' : undefined}
            className="sr-only"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null
              setFile(picked)
              setPreview(picked ? URL.createObjectURL(picked) : null)
              setErrors(clearProblem('file'))
            }}
          />
          <span className="shrink-0 rounded-lg border border-leaf-300 bg-white px-3 py-1.5 font-medium text-leaf-800">
            {file ? 'เปลี่ยนรูป' : 'เลือกรูปสลิป'}
          </span>
          <span className="min-w-0 truncate text-muted">{file ? file.name : 'จากอัลบั้มหรือถ่ายรูป'}</span>
        </label>
        {errors.file && (
          <p id="slip-error" className="mt-1 text-sm font-medium text-danger">
            {errors.file}
          </p>
        )}
      </div>
      {preview && <img src={preview} alt="สลิปที่เลือก" className="max-h-64 rounded-lg border border-line" />}
      <div className="grid grid-cols-2 gap-3">
        <Field label="ยอดที่โอน (บาท)" error={errors.amount}>
          <TextInput value={values.amount} onChange={set('amount')} inputMode="decimal" />
        </Field>
        <Field label="วันที่โอน" error={errors.date}>
          <TextInput type="date" value={values.date} max={todayISO()} onChange={set('date')} />
        </Field>
      </div>
      <Field label="เลขที่รายการในสลิป" optional>
        <TextInput value={values.ref} onChange={set('ref')} maxLength={100} autoComplete="off" />
      </Field>
      <FormError>{error}</FormError>
      <Button type="submit" variant="primary" size="md" className="w-full" disabled={busy}>
        {busy ? 'กำลังส่ง…' : 'ส่งสลิป'}
      </Button>
    </form>
  )
}

function PaymentHistory({ payments }) {
  const { client } = useLiff()
  const paths = payments.map((p) => p.slip_image).filter(Boolean)
  const { data: urls } = useLoader(() => slipUrls(paths, client), paths.join('|'))
  if (payments.length === 0) return null
  return (
    <>
      <SectionTitle>การชำระของบิลนี้</SectionTitle>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-white" aria-label="การชำระของบิลนี้">
        {payments.map((p) => {
          const state = paymentState(p)
          const receipt = receiptOf(p)
          const url = urls?.[p.slip_image]
          return (
            <li key={p.payment_id} className="flex gap-3 px-4 py-3">
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="shrink-0">
                  <img src={url} alt="สลิป" className="h-16 w-12 rounded border border-line object-cover" />
                </a>
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold tabular-nums text-ink">{formatBaht(p.amount)}</p>
                  <Badge tone={PAYMENT_STATE_TONE[state]}>{PAYMENT_STATE_LABEL[state]}</Badge>
                </div>
                <p className="text-sm text-muted">
                  {label(PAYMENT_METHOD, p.payment_method)} · {formatDate(p.payment_date)}
                </p>
                {state === 'pending' && <p className="text-sm text-muted">ส่งเมื่อ {formatDateTime(p.created_at)} · รอเจ้าหน้าที่ตรวจ</p>}
                {state === 'rejected' && p.note && <p className="text-sm text-danger">เหตุผล: {p.note}</p>}
                {receipt && (
                  <Link to={`/liff/receipts/${receipt.receipt_id}`} className="text-sm font-medium text-leaf-700 underline">
                    ใบเสร็จ {receipt.receipt_no}
                    {state === 'voided' ? ' (ยกเลิกแล้ว)' : ''}
                  </Link>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

export default function LiffInvoice() {
  const { id } = useParams()
  const { data, error, reload } = useLoader(() => fetchInvoice(Number(id)), id)
  const [sent, setSent] = useState(null)

  if (error && !data) {
    return (
      <>
        <BackLink to="/liff/bills">บิลทั้งหมด</BackLink>
        <ErrorBox message={error} onRetry={reload} />
      </>
    )
  }
  if (!data) return <Loading rows={2} />

  const { invoice, readings } = data
  const market = invoice.contracts?.stalls?.zones?.markets
  const outstanding = outstandingOf(invoice)
  const pending = money(invoice.payments.filter((p) => p.status === 'pending').reduce((n, p) => n + Number(p.amount), 0))
  const toPay = Math.max(0, money(outstanding - pending))
  const owing = isOwing(invoice)

  return (
    <>
      <BackLink to="/liff/bills">บิลทั้งหมด</BackLink>
      <Card className="mt-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-ink">บิลรอบ {formatPeriod(invoice.billing_period, { long: true })}</h1>
            <p className="text-muted">{stallLine(invoice.contracts?.stalls)}</p>
          </div>
          <InvoiceBadge invoice={invoice} />
        </div>
        <p className="mt-1 text-sm text-muted">เลขที่ {invoice.invoice_no}</p>
        <p className={owing ? 'font-medium text-ink' : 'text-sm text-muted'}>
          {owing ? 'ชำระภายใน' : 'ครบกำหนด'} {formatDate(invoice.due_date, { long: true })}
        </p>
      </Card>

      <Breakdown invoice={invoice} readings={readings} />

      {sent && (
        <p role="status" className="mt-4 rounded-lg bg-leaf-100 px-4 py-3 text-leaf-800">
          ส่งสลิปยอด {formatBaht(sent)} แล้ว เจ้าหน้าที่จะตรวจและออกใบเสร็จให้ ดูสถานะได้ที่หน้านี้
        </p>
      )}

      {owing && pending > 0 && !sent && (
        <p className="mt-4 rounded-lg bg-stall-reserved px-4 py-3 text-stall-reserved-ink">
          แจ้งชำระแล้ว {formatBaht(pending)} รอเจ้าหน้าที่ตรวจสอบ
          {toPay > 0 ? ` · ยังเหลือที่ต้องโอนอีก ${formatBaht(toPay)}` : ''}
        </p>
      )}

      {owing && toPay > 0 && (
        <>
          <SectionTitle>ชำระเงิน</SectionTitle>
          {market?.promptpay_id ? (
            <Card>
              <div className="flex flex-col items-center text-center">
                <PromptPayQR promptpayId={market.promptpay_id} name={market.promptpay_name} amount={toPay} size={208} png />
                <p className="mt-2 text-sm text-muted">
                  แตะค้างที่รูป QR เพื่อบันทึก แล้วเปิดแอปธนาคาร เลือก "สแกน" และเลือกรูปจากอัลบั้ม หรือใช้มือถืออีกเครื่องสแกน
                </p>
              </div>
              <hr className="my-4 border-line" />
              <h3 className="mb-3 font-semibold text-leaf-800">โอนแล้ว ส่งสลิปที่นี่</h3>
              <SlipForm
                key={toPay}
                invoice={invoice}
                maxAmount={toPay}
                onSent={(amount) => {
                  setSent(amount)
                  reload()
                }}
              />
            </Card>
          ) : (
            <Card className="text-muted">ตลาดยังไม่ได้ตั้งค่ารับชำระผ่านพร้อมเพย์ กรุณาชำระเงินสดที่สำนักงานตลาด</Card>
          )}
          <p className="mt-2 px-1 text-sm text-muted">ชำระเงินสดได้ที่สำนักงานตลาดเช่นกัน</p>
        </>
      )}

      <PaymentHistory payments={invoice.payments} />
    </>
  )
}
