import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { thaiError } from '../../lib/errors'
import { formatBaht, formatNumber } from '../../lib/format'
import { RENT_PERIOD, UNIT_TYPE } from '../../lib/labels'
import { numberProblem, toNumberOrNull } from '../../lib/validate'
import Modal, { ModalSection } from '../ui/Modal'
import { Field, FormActions, FormError, RadioGroup, TextInput } from '../ui/form'

const PER = { monthly: 'เดือน', yearly: 'ปี' }

/** ค่าที่พบบ่อยที่สุดในรายการ */
function mostCommon(values, fallback) {
  const counts = new Map()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = fallback
  let max = 0
  for (const [v, n] of counts) if (n > max) [best, max] = [v, n]
  return best
}

/**
 * ตั้งค่าเช่าเริ่มต้นทั้งโซนในครั้งเดียว (เช่น ห้อง OTOP ทุกห้องในโซน A)
 * เปลี่ยนเฉพาะค่าตั้งต้นของแผง ไม่แตะสัญญาที่ทำไปแล้ว
 */
export default function ZoneRentDialog({ market, zone, onClose, onSaved }) {
  const stalls = zone.stalls
  const unitWord = UNIT_TYPE[mostCommon(stalls.map((s) => s.unit_type), market.market_type === 'building' ? 'room' : 'stall')]
  const rents = [...new Set(stalls.map((s) => s.base_rent).filter((v) => v !== null && v !== undefined).map(Number))]
  const unset = stalls.filter((s) => s.base_rent === null || s.base_rent === undefined).length

  const [rent, setRent] = useState(rents.length === 1 && unset === 0 ? String(rents[0]) : '')
  const [period, setPeriod] = useState(mostCommon(stalls.map((s) => s.rent_period), 'monthly'))
  const [scope, setScope] = useState(unset > 0 && unset < stalls.length ? 'unset' : 'all')
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    const problem = numberProblem(rent, 'ค่าเช่า', { required: true })
    setError(problem)
    if (problem) return

    const amount = toNumberOrNull(rent)
    setBusy(true)
    let query = supabase.from('stalls').update({ base_rent: amount, rent_period: period }).eq('zone_id', zone.zone_id)
    if (scope === 'unset') query = query.is('base_rent', null)
    const { data, error: e2 } = await query.select('stall_id')
    setBusy(false)
    if (e2) return setFormError(thaiError(e2))
    if (!data?.length) return setFormError(`ไม่มี${unitWord}ที่ถูกแก้ (อาจไม่มีสิทธิ์ หรือไม่มี${unitWord}ตามเงื่อนไขที่เลือก)`)
    onSaved(
      `ตั้งค่าเช่า ${formatNumber(data.length)} ${unitWord} ใน${market.market_name} โซน ${zone.zone_name} เป็น ${formatBaht(amount)} / ${PER[period]} แล้ว`,
    )
  }

  return (
    <Modal
      title="ตั้งค่าเช่าทั้งโซน"
      subtitle={`${market.market_name} โซน ${zone.zone_name} · ${formatNumber(stalls.length)} ${unitWord}`}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      initialFocus="field"
      closeOnBackdrop={false}
      footer={
        <>
          <FormError>{formError}</FormError>
          <FormActions onCancel={onClose} busy={busy} submitLabel="ตั้งค่าเช่า" />
        </>
      }
    >
      <ModalSection>
        <div className="space-y-4">
          <Field label={`ค่าเช่าเริ่มต้น (บาท / ${PER[period]})`} error={error}>
            <TextInput value={rent} onChange={(e) => {
                setRent(e.target.value)
                setError('')
              }} inputMode="decimal" autoComplete="off" placeholder="เช่น 18000" />
          </Field>
          <RadioGroup
            legend="รอบค่าเช่า"
            name="zone_rent_period"
            value={period}
            onChange={setPeriod}
            options={Object.entries(RENT_PERIOD).map(([value, label]) => ({ value, label }))}
          />
          {unset > 0 && unset < stalls.length && (
            <RadioGroup
              legend="ใช้กับ"
              name="zone_rent_scope"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'unset', label: `เฉพาะ${unitWord}ที่ยังไม่กำหนดค่าเช่า (${formatNumber(unset)})` },
                { value: 'all', label: `ทุก${unitWord}ในโซน (${formatNumber(stalls.length)})` },
              ]}
            />
          )}
          <p className="rounded-lg bg-leaf-50 px-3 py-2 text-sm text-muted">
            สัญญาที่ทำไปแล้วยังใช้ค่าเช่าตามสัญญาเดิม ค่านี้ใช้เป็นค่าตั้งต้นตอนทำสัญญาใหม่
          </p>
        </div>
      </ModalSection>
    </Modal>
  )
}
