import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { thaiError } from '../../lib/errors'
import { RENT_PERIOD, UNIT_TYPE } from '../../lib/labels'
import { newStallDefaults, nextStallCode, stallTitle } from '../../lib/stalls'
import { clearProblem, collectProblems, numberProblem, toNumberOrNull } from '../../lib/validate'
import Modal, { ModalSection } from '../ui/Modal'
import { Field, FormActions, FormError, RadioGroup, SelectInput, TextInput } from '../ui/form'

const SIZE_UNITS = ['ตร.ม.', 'ม.', 'ตร.ว.']
const asText = (v) => (v === null || v === undefined ? '' : String(Number(v)))

function fieldsFrom(source) {
  return {
    unit_type: source.unit_type ?? 'stall',
    rent_period: source.rent_period ?? 'monthly',
    base_rent: asText(source.base_rent),
    size: asText(source.size),
    size_unit: source.size_unit ?? 'ตร.ม.',
  }
}

/**
 * ฟอร์มเพิ่ม/แก้ไขแผงหรือห้อง
 * - แก้ไข: ส่ง info = { market, zone, stall }
 * - เพิ่ม: ส่ง markets (ทั้งหมด) + initialZoneId (ถ้ามี) — รหัสเว้นว่างได้ ระบบตั้งรหัสถัดไปให้
 */
export default function StallFormDialog({ info, markets, initialZoneId, onClose, onSaved }) {
  const isNew = !info
  const zones = (markets ?? []).flatMap((m) => m.zones.map((z) => ({ market: m, zone: z })))
  const [zoneId, setZoneId] = useState(() => info?.zone.zone_id ?? initialZoneId ?? zones[0]?.zone.zone_id ?? null)
  const place = isNew ? zones.find((x) => x.zone.zone_id === zoneId) : info
  const [form, setForm] = useState(() => ({
    stall_code: info?.stall.stall_code ?? '',
    ...(isNew ? (place ? fieldsFrom(newStallDefaults(place.market, place.zone)) : fieldsFrom({})) : fieldsFrom(info.stall)),
  }))
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const setValue = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors(clearProblem(key))
  }
  const set = (key) => (e) => setValue(key)(e.target.value)
  const unitWord = UNIT_TYPE[form.unit_type] ?? 'แผง'

  function changeZone(e) {
    const id = Number(e.target.value)
    setZoneId(id)
    const next = zones.find((x) => x.zone.zone_id === id)
    // ค่าเริ่มต้นตามแผงล่าสุดของโซนที่เลือก
    if (next) setForm((f) => ({ ...f, ...fieldsFrom(newStallDefaults(next.market, next.zone)) }))
  }

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    const code = form.stall_code.trim().toUpperCase()
    const problems = collectProblems({
      zone: isNew && !place ? 'กรุณาเลือกโซน' : '',
      stall_code: !isNew && !code ? 'กรุณากรอกรหัส' : /\s/.test(code) ? 'รหัสต้องไม่มีช่องว่าง' : '',
      base_rent: numberProblem(form.base_rent, 'ค่าเช่า'),
      size: numberProblem(form.size, 'ขนาด', { positive: true }),
    })
    setErrors(problems)
    if (Object.keys(problems).length > 0) return

    const payload = {
      unit_type: form.unit_type,
      rent_period: form.rent_period,
      base_rent: toNumberOrNull(form.base_rent),
      size: toNumberOrNull(form.size),
      size_unit: form.size.trim() ? form.size_unit.trim() || null : null,
    }
    if (code) payload.stall_code = code

    setBusy(true)
    const query = isNew
      ? supabase.from('stalls').insert({ ...payload, zone_id: place.zone.zone_id }).select('stall_id, stall_code, unit_type')
      : supabase.from('stalls').update(payload).eq('stall_id', info.stall.stall_id).select('stall_id, stall_code, unit_type')
    const { data, error } = await query
    setBusy(false)
    if (error) {
      if (error.code === '23505') return setErrors({ stall_code: `รหัส ${code} มีอยู่แล้วในโซนนี้` })
      return setFormError(thaiError(error))
    }
    if (!data?.length) return setFormError('บันทึกไม่สำเร็จ บัญชีนี้ไม่มีสิทธิ์แก้ไขแผง')
    onSaved(data[0], isNew)
  }

  return (
    <Modal
      title={isNew ? `เพิ่ม${unitWord}` : `แก้ไข${stallTitle(info.stall)}`}
      subtitle={isNew ? undefined : `${info.market.market_name} โซน ${info.zone.zone_name}`}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      initialFocus="field"
      closeOnBackdrop={false}
      footer={
        <>
          <FormError>{formError}</FormError>
          <FormActions onCancel={onClose} busy={busy} submitLabel={isNew ? `เพิ่ม${unitWord}` : 'บันทึก'} />
        </>
      }
    >
      <ModalSection>
        <div className="grid gap-4 sm:grid-cols-2">
          {isNew && (
            <Field label="ตลาด / โซน" error={errors.zone} className="sm:col-span-2">
              <SelectInput value={zoneId ?? ''} onChange={changeZone}>
                {(markets ?? []).map((m) => (
                  <optgroup key={m.market_id} label={m.market_name}>
                    {m.zones.map((z) => (
                      <option key={z.zone_id} value={z.zone_id}>
                        {m.market_name} โซน {z.zone_name} ({z.stalls.length})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </SelectInput>
            </Field>
          )}
          <Field
            label="รหัส"
            optional={isNew}
            hint={isNew && place ? `เว้นว่างให้ระบบตั้งรหัสถัดไปให้ (${nextStallCode(place.zone)})` : 'ไม่ซ้ำกันในโซนเดียวกัน'}
            error={errors.stall_code}
            className="sm:col-span-2"
          >
            <TextInput value={form.stall_code} onChange={set('stall_code')} autoComplete="off" maxLength={50} className="uppercase" />
          </Field>
          <RadioGroup
            legend="ประเภท"
            name="unit_type"
            value={form.unit_type}
            onChange={setValue('unit_type')}
            options={Object.entries(UNIT_TYPE).map(([value, label]) => ({ value, label }))}
          />
          <RadioGroup
            legend="รอบค่าเช่า"
            name="rent_period"
            value={form.rent_period}
            onChange={setValue('rent_period')}
            options={Object.entries(RENT_PERIOD).map(([value, label]) => ({ value, label }))}
          />
          <Field
            label={`ค่าเช่าเริ่มต้น (บาท / ${form.rent_period === 'yearly' ? 'ปี' : 'เดือน'})`}
            optional
            hint="ใช้เป็นค่าตั้งต้นตอนทำสัญญา สัญญาที่ทำไปแล้วไม่เปลี่ยนตาม"
            error={errors.base_rent}
            className="sm:col-span-2"
          >
            <TextInput value={form.base_rent} onChange={set('base_rent')} inputMode="decimal" autoComplete="off" placeholder="เช่น 150" />
          </Field>
          <Field label="ขนาด" optional error={errors.size}>
            <TextInput value={form.size} onChange={set('size')} inputMode="decimal" autoComplete="off" placeholder="เช่น 4" />
          </Field>
          <Field label="หน่วยของขนาด" optional>
            <TextInput value={form.size_unit} onChange={set('size_unit')} list="size-units" autoComplete="off" maxLength={20} />
          </Field>
          <datalist id="size-units">
            {SIZE_UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>
      </ModalSection>
    </Modal>
  )
}
