import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { thaiError } from '../../lib/errors'
import { formatBaht, formatDate, formatPeriod, todayISO } from '../../lib/format'
import { PAYMENT_METHOD } from '../../lib/labels'
import { outstandingOf, paidOf, slipProblem, uploadSlip } from '../../lib/payments'
import { clearProblem, collectProblems, numberProblem, toNumberOrNull } from '../../lib/validate'
import Modal, { DetailRows, ModalSection } from '../ui/Modal'
import { Field, FormActions, FormError, RadioGroup, TextArea, TextInput } from '../ui/form'

const METHODS = Object.entries(PAYMENT_METHOD).map(([value, label]) => ({ value, label }))

/**
 * รับชำระที่สำนักงาน (เงินสด หรือผู้เช่าโอนแล้วนำสลิปมาแสดง) → ตรวจแล้วทันที + ออกใบเสร็จ
 * invoice ต้องมี payments(amount, status) และ contracts.tenants.tenant_id
 * onDone({ receiptNo, receiptId, full }) — full = ชำระครบแล้ว
 */
export default function RecordPaymentDialog({ invoice, onClose, onDone }) {
  const outstanding = outstandingOf(invoice)
  const [form, setForm] = useState({ method: 'cash', amount: String(outstanding), date: todayISO(), ref: '', note: '' })
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const cash = form.method === 'cash'
  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e?.target ? e.target.value : e }))
    setErrors(clearProblem(key))
  }

  // คืนหน่วยความจำของรูปตัวอย่างเดิมเมื่อเปลี่ยนรูปหรือปิดหน้าต่าง
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    const amount = toNumberOrNull(form.amount)
    const problems = collectProblems({
      amount: numberProblem(form.amount, 'ยอดที่รับ', { required: true, positive: true }) || (amount > outstanding ? `เกินยอดค้างชำระ (ค้าง ${formatBaht(outstanding)})` : ''),
      date: !form.date ? 'กรุณาระบุวันที่รับเงิน' : form.date > todayISO() ? 'วันที่รับเงินต้องไม่เกินวันนี้' : '',
      file: cash ? '' : slipProblem(file),
    })
    setErrors(problems)
    if (Object.keys(problems).length > 0) return
    setBusy(true)
    try {
      const slip = !cash && file ? await uploadSlip(file, invoice.contracts.tenants.tenant_id, invoice.invoice_id) : null
      const { data, error } = await supabase.rpc('record_payment', {
        p_invoice_id: invoice.invoice_id,
        p_amount: amount,
        p_method: form.method,
        p_payment_date: form.date,
        p_transaction_ref: cash ? null : form.ref.trim() || null,
        p_slip_image: slip,
        p_note: form.note.trim() || null,
      })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      onDone({ receiptNo: row?.receipt_no, receiptId: row?.receipt_id, full: amount >= outstanding })
    } catch (err) {
      setFormError(thaiError(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="รับชำระ"
      subtitle={`${invoice.invoice_no} · รอบ ${formatPeriod(invoice.billing_period, { long: true })}`}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      initialFocus="field"
      closeOnBackdrop={false}
      footer={
        <>
          <FormError>{formError}</FormError>
          <FormActions onCancel={onClose} busy={busy} submitLabel="รับชำระและออกใบเสร็จ" busyLabel="กำลังบันทึก…" />
        </>
      }
    >
      <ModalSection>
        <DetailRows
          rows={[
            { label: 'ผู้เช่า', value: invoice.contracts?.tenants?.full_name ?? '-' },
            { label: 'ยอดใบแจ้งหนี้', value: formatBaht(invoice.total_amount) },
            paidOf(invoice) > 0 && { label: 'ชำระแล้ว', value: formatBaht(paidOf(invoice)) },
            { label: 'ค้างชำระ', value: <span className="font-semibold">{formatBaht(outstanding)}</span> },
          ]}
        />
      </ModalSection>
      <ModalSection>
        <div className="space-y-4">
          <RadioGroup legend="วิธีชำระ" name="method" value={form.method} onChange={set('method')} options={METHODS} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ยอดที่รับ (บาท)" error={errors.amount} hint="แบ่งจ่ายได้ — ใส่ยอดที่รับจริง">
              <TextInput value={form.amount} onChange={set('amount')} inputMode="decimal" autoComplete="off" className="text-right tabular-nums" />
            </Field>
            <Field label="วันที่รับเงิน" error={errors.date} hint={form.date ? formatDate(form.date, { long: true }) : undefined}>
              <TextInput type="date" value={form.date} max={todayISO()} onChange={set('date')} />
            </Field>
          </div>
          {!cash && (
            <>
              <Field label="เลขอ้างอิงธุรกรรม" optional hint="ดูได้ในสลิป ใช้ตรวจสลิปซ้ำ">
                <TextInput value={form.ref} onChange={set('ref')} maxLength={100} autoComplete="off" />
              </Field>
              <Field label="รูปสลิป" optional error={errors.file} hint="JPG, PNG หรือ WebP — รูปใหญ่จะถูกย่อให้อัตโนมัติ">
                <TextInput
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const picked = e.target.files?.[0] ?? null
                    setFile(picked)
                    setPreview(picked ? URL.createObjectURL(picked) : null)
                    setErrors(clearProblem('file'))
                  }}
                  className="py-1.5"
                />
              </Field>
              {preview && <img src={preview} alt="ตัวอย่างสลิปที่เลือก" className="max-h-48 rounded-lg border border-line" />}
            </>
          )}
          <Field label="หมายเหตุ" optional>
            <TextArea value={form.note} onChange={set('note')} rows={2} maxLength={300} />
          </Field>
        </div>
      </ModalSection>
    </Modal>
  )
}
