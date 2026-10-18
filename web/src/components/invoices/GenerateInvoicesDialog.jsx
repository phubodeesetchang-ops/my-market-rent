import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { thaiError } from '../../lib/errors'
import { compareThai, formatBaht, formatDate, formatNumber, formatPeriod } from '../../lib/format'
import { defaultDueDate } from '../../lib/billing'
import { useLoader } from '../../lib/useLoader'
import Modal, { ModalSection } from '../ui/Modal'
import { Badge } from '../ui/feedback'
import { Button, Field, FormError, TextInput } from '../ui/form'

async function fetchPreview(period) {
  const { data, error } = await supabase.rpc('preview_invoices', { p_period: period })
  if (error) throw error
  return data
}

const byStall = (a, b) => compareThai(a.market_name, b.market_name) || compareThai(a.stall_code, b.stall_code)

/** แผงนี้ยังจดมิเตอร์ไม่ครบ (เฉพาะสัญญาที่ได้ค่าน้ำไฟของแผง) */
function missingMeters(row) {
  if (!row.gets_utility) return []
  return [!row.has_electricity && 'ไฟ', !row.has_water && 'น้ำ'].filter(Boolean)
}

function amounts(row) {
  return [
    ['เช่า', row.rent_amount],
    ['น้ำ', row.water_amount],
    ['ไฟ', row.electricity_amount],
    ['ค่าธรรมเนียม', row.fee_amount],
  ]
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => `${k} ${formatBaht(v, { withUnit: false })}`)
    .join(' · ')
}

function RowText({ row }) {
  return (
    <span className="min-w-0">
      <span className="font-medium text-ink">
        {row.unit_type === 'room' ? 'ห้อง' : 'แผง'} {row.stall_code}
      </span>{' '}
      <span className="text-muted">{row.market_name}</span> · {row.tenant_name}
      <span className="block text-sm text-muted tabular-nums">{amounts(row) || 'ไม่มียอดเรียกเก็บ'}</span>
    </span>
  )
}

/**
 * ออกใบแจ้งหนี้ประจำรอบ: ดูตัวอย่างยอดทุกสัญญาก่อน เลือกได้ว่าจะออกใบไหน
 * onDone(จำนวนใบที่ออก)
 */
export default function GenerateInvoicesDialog({ period, onClose, onDone }) {
  const preview = useLoader(() => fetchPreview(period), period)
  const [excluded, setExcluded] = useState(() => new Set()) // contract_id ที่ไม่ต้องการออก
  const [dueDate, setDueDate] = useState(() => defaultDueDate(period))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const rows = [...(preview.data ?? [])].sort(byStall)
  const ready = rows.filter((r) => !r.invoice_id && Number(r.total_amount) > 0)
  const issued = rows.filter((r) => r.invoice_id)
  const zero = rows.filter((r) => !r.invoice_id && Number(r.total_amount) <= 0)
  const chosen = ready.filter((r) => !excluded.has(r.contract_id))
  const chosenTotal = chosen.reduce((n, r) => n + Number(r.total_amount), 0)
  const missing = ready.filter((r) => missingMeters(r).length > 0)
  const allChosen = chosen.length === ready.length

  function toggle(id) {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!dueDate) return setError('กรุณาระบุวันครบกำหนดชำระ')
    if (chosen.length === 0) return setError('ยังไม่ได้เลือกใบแจ้งหนี้ที่จะออก')
    setBusy(true)
    const { data, error: err } = await supabase.rpc('generate_invoices', {
      p_period: period,
      p_due_date: dueDate,
      p_contract_ids: allChosen ? null : chosen.map((r) => r.contract_id),
    })
    setBusy(false)
    if (err) return setError(thaiError(err))
    onDone(data ?? 0)
  }

  return (
    <Modal
      title="ออกใบแจ้งหนี้"
      subtitle={`รอบบิล ${formatPeriod(period, { long: true })}`}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      size="lg"
      footer={
        preview.data && (
          <>
            <FormError>{error}</FormError>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <Field label="วันครบกำหนดชำระ" className="w-52" hint={dueDate ? formatDate(dueDate, { long: true }) : undefined}>
                <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button onClick={onClose} disabled={busy}>
                  ยกเลิก
                </Button>
                <Button type="submit" variant="primary" disabled={busy || chosen.length === 0}>
                  {busy ? 'กำลังออกใบแจ้งหนี้…' : `ออก ${formatNumber(chosen.length)} ใบ · ${formatBaht(chosenTotal)}`}
                </Button>
              </div>
            </div>
          </>
        )
      }
    >
      {preview.error && (
        <ModalSection>
          <p role="alert" className="text-danger">
            โหลดตัวอย่างใบแจ้งหนี้ไม่สำเร็จ: {preview.error}
          </p>
        </ModalSection>
      )}
      {!preview.data && !preview.error && (
        <ModalSection>
          <p className="text-muted">กำลังคำนวณยอดของทุกสัญญา…</p>
        </ModalSection>
      )}

      {preview.data && rows.length === 0 && (
        <ModalSection>
          <p className="text-muted">ไม่มีสัญญาที่ต้องเรียกเก็บในรอบนี้</p>
        </ModalSection>
      )}

      {preview.data && ready.length > 0 && (
        <ModalSection
          title={`พร้อมออก ${formatNumber(ready.length)} ใบ`}
          aside={
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-leaf-700"
                checked={allChosen}
                onChange={() => setExcluded(allChosen ? new Set(ready.map((r) => r.contract_id)) : new Set())}
              />
              เลือกทั้งหมด
            </label>
          }
        >
          {missing.length > 0 && (
            <p role="note" className="mb-3 rounded-lg bg-stall-reserved/70 px-3 py-2 text-stall-reserved-ink">
              {formatNumber(missing.length)} แผงยังจดมิเตอร์ไม่ครบ ถ้าออกตอนนี้ค่าน้ำ/ไฟที่ยังไม่จดจะเป็น 0 บาท (แผงที่ไม่มีมิเตอร์ออกได้เลย) —{' '}
              <Link to={`/admin/readings?period=${period}`} className="font-semibold underline">
                ไปจดมิเตอร์รอบนี้
              </Link>
            </p>
          )}
          <ul className="divide-y divide-line rounded-lg border border-line" aria-label="ใบแจ้งหนี้ที่พร้อมออก">
            {ready.map((r) => {
              const miss = missingMeters(r)
              return (
                <li key={r.contract_id}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-leaf-50">
                    <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-leaf-700" checked={!excluded.has(r.contract_id)} onChange={() => toggle(r.contract_id)} />
                    <RowText row={r} />
                    <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
                      <span className="font-semibold tabular-nums">{formatBaht(r.total_amount, { withUnit: false })}</span>
                      {miss.length > 0 && <Badge tone="amber">ยังไม่จด{miss.join('/')}</Badge>}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </ModalSection>
      )}

      {preview.data && issued.length > 0 && (
        <ModalSection title={`ออกแล้ว ${formatNumber(issued.length)} ใบ`}>
          <ul className="space-y-1.5 text-sm">
            {issued.map((r) => (
              <li key={r.contract_id} className="flex flex-wrap justify-between gap-x-3">
                <span>
                  {r.stall_code} {r.market_name} · {r.tenant_name}
                </span>
                <span className="text-muted">{r.invoice_no}</span>
              </li>
            ))}
          </ul>
        </ModalSection>
      )}

      {preview.data && zero.length > 0 && (
        <ModalSection title={`ไม่มียอดเรียกเก็บ ${formatNumber(zero.length)} สัญญา`}>
          <p className="mb-1.5 text-sm text-muted">เช่น สัญญารายปีที่ไม่ใช่เดือนแรกของปีสัญญา และไม่มีค่าน้ำไฟ/ค่าธรรมเนียม — ไม่ต้องออกใบ</p>
          <ul className="space-y-1 text-sm">
            {zero.map((r) => (
              <li key={r.contract_id}>
                {r.stall_code} {r.market_name} · {r.tenant_name}
              </li>
            ))}
          </ul>
        </ModalSection>
      )}
    </Modal>
  )
}
