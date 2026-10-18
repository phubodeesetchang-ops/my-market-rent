import { useId } from 'react'
import { currentPeriod, formatPeriod } from '../../lib/format'
import { invoiceState, shiftPeriod } from '../../lib/billing'
import { INVOICE_STATUS } from '../../lib/labels'
import { Badge } from '../ui/feedback'
import { Button, SelectInput } from '../ui/form'

/** รายการรอบบิลให้เลือก: ย้อนหลัง 24 เดือนถึงเดือนหน้า (+ รอบที่เลือกอยู่ ถ้าอยู่นอกช่วง) */
function periodOptions(value) {
  const now = currentPeriod()
  const list = []
  for (let i = 1; i >= -24; i--) list.push(shiftPeriod(now, i))
  if (value && !list.includes(value)) list.push(value)
  return list.sort().reverse()
}

/**
 * เลือกรอบบิล: ปุ่มเดือนก่อน/ถัดไป + รายการเดือน (แสดงเป็น พ.ศ.)
 * ใช้ select แทน input type="month" เพราะ Safari/Firefox บางรุ่นไม่มีปฏิทินเดือน
 */
export function PeriodPicker({ value, onChange, disabled = false, hint, className = '', label = 'รอบบิล' }) {
  const id = useId()
  const options = periodOptions(value)
  const prev = shiftPeriod(value, -1)
  const next = shiftPeriod(value, 1)
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block font-medium text-ink">
        {label}
      </label>
      <div className="flex gap-1">
        <Button aria-label={`${label}ก่อนหน้า`} title="เดือนก่อนหน้า" className="px-2.5!" disabled={disabled || !options.includes(prev)} onClick={() => onChange(prev)}>
          ‹
        </Button>
        <SelectInput id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${id}-hint` : undefined}>
          {options.map((p) => (
            <option key={p} value={p}>
              {formatPeriod(p, { long: true })}
            </option>
          ))}
        </SelectInput>
        <Button aria-label={`${label}ถัดไป`} title="เดือนถัดไป" className="px-2.5!" disabled={disabled || !options.includes(next)} onClick={() => onChange(next)}>
          ›
        </Button>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
    </div>
  )
}

const STATE_TONE = { unpaid: 'amber', overdue: 'red', paid: 'solid', cancelled: 'gray' }

/** รอชำระ / เกินกำหนด / ชำระแล้ว / ยกเลิก */
export function InvoiceStatusBadge({ invoice }) {
  const state = invoiceState(invoice)
  return <Badge tone={STATE_TONE[state] ?? 'gray'}>{INVOICE_STATUS[state] ?? state}</Badge>
}
