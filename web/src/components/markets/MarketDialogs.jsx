import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { thaiError } from '../../lib/errors'
import { firstOfNextMonth, formatBaht, formatDate } from '../../lib/format'
import { FEE_PERIOD, MARKET_TYPE, UTILITY_TYPE } from '../../lib/labels'
import { isPlaced } from '../../lib/siteLayouts'
import { clearProblem, collectProblems, digitsOnly, numberProblem, requiredProblem, toNumberOrNull } from '../../lib/validate'
import { promptPayProblem } from '../../lib/promptpay'
import { PromptPayQR } from '../payments/PromptPayQR'
import Modal, { ModalSection } from '../ui/Modal'
import { Field, FormActions, FormError, RadioGroup, SelectInput, TextArea, TextInput } from '../ui/form'

const STATUS_OPTIONS = [
  { value: 'active', label: 'ใช้งาน' },
  { value: 'inactive', label: 'ระงับ' },
]

/** ใช้ร่วมกันทุกฟอร์มในไฟล์นี้: state ของฟอร์ม + error + กำลังบันทึก */
function useFormState(initial) {
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e?.target ? e.target.value : e }))
    setErrors(clearProblem(key))
  }
  return { form, set, errors, setErrors, formError, setFormError, busy, setBusy }
}

function FormModal({ title, subtitle, onClose, onSubmit, state, submitLabel, children }) {
  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      onSubmit={onSubmit}
      busy={state.busy}
      initialFocus="field"
      closeOnBackdrop={false}
      footer={
        <>
          <FormError>{state.formError}</FormError>
          <FormActions onCancel={onClose} busy={state.busy} submitLabel={submitLabel} />
        </>
      }
    >
      <ModalSection>
        <div className="space-y-4">{children}</div>
      </ModalSection>
    </Modal>
  )
}

/** บันทึกแล้วตรวจผล: error → แสดงในฟอร์ม, ไม่มีแถวกลับมา = ไม่มีสิทธิ์ (RLS) */
async function save(state, query, duplicateField, duplicateMessage) {
  state.setBusy(true)
  const { data, error } = await query
  state.setBusy(false)
  if (error) {
    if (error.code === '23505' && duplicateField) state.setErrors({ [duplicateField]: duplicateMessage })
    else state.setFormError(thaiError(error))
    return null
  }
  if (!data?.length) {
    state.setFormError('บันทึกไม่สำเร็จ บัญชีนี้ไม่มีสิทธิ์แก้ไขข้อมูลตลาด (เฉพาะผู้ดูแลระบบ)')
    return null
  }
  return data[0]
}

// ---------------------------------------------------------------------
// ตลาด
// ---------------------------------------------------------------------
export function MarketFormDialog({ market, onClose, onSaved }) {
  const isNew = !market
  const state = useFormState({
    market_name: market?.market_name ?? '',
    market_type: market?.market_type ?? 'market',
    description: market?.description ?? '',
    status: market?.status ?? 'active',
  })
  const { form, set, errors } = state
  const renamingPlaced = !isNew && isPlaced(market.market_name) && form.market_name.trim() !== market.market_name

  async function submit(e) {
    e.preventDefault()
    state.setFormError('')
    const problems = collectProblems({ market_name: requiredProblem(form.market_name, 'ชื่อตลาด') })
    state.setErrors(problems)
    if (Object.keys(problems).length > 0) return
    const payload = {
      market_name: form.market_name.trim(),
      market_type: form.market_type,
      description: form.description.trim() || null,
      ...(isNew ? {} : { status: form.status }),
    }
    const row = await save(
      state,
      isNew
        ? supabase.from('markets').insert(payload).select('market_id')
        : supabase.from('markets').update(payload).eq('market_id', market.market_id).select('market_id'),
      'market_name',
      'มีตลาดชื่อนี้อยู่แล้ว',
    )
    if (row) onSaved(row.market_id, isNew ? `เพิ่ม${payload.market_name}แล้ว` : `บันทึกข้อมูล${payload.market_name}แล้ว`)
  }

  return (
    <FormModal
      title={isNew ? 'เพิ่มตลาด' : 'แก้ไขข้อมูลตลาด'}
      subtitle={market?.market_name}
      onClose={onClose}
      onSubmit={submit}
      state={state}
      submitLabel={isNew ? 'เพิ่มตลาด' : 'บันทึก'}
    >
      <Field
        label="ชื่อตลาด"
        error={errors.market_name}
        hint={
          renamingPlaced
            ? 'ผังพื้นที่ในหน้าภาพรวมอ้างอิงชื่อเดิม ถ้าเปลี่ยนชื่อ ตลาดนี้จะไปแสดงแยกท้ายหน้าภาพรวม จนกว่าจะแก้ชื่อในไฟล์ web/src/lib/siteLayouts.js'
            : undefined
        }
      >
        <TextInput value={form.market_name} onChange={set('market_name')} maxLength={150} autoComplete="off" />
      </Field>
      <RadioGroup
        legend="ประเภท"
        name="market_type"
        value={form.market_type}
        onChange={set('market_type')}
        options={Object.entries(MARKET_TYPE).map(([value, label]) => ({ value, label }))}
        hint="อาคาร = เช่าเป็นห้อง (เช่น อาคาร OTOP)"
      />
      <Field label="รายละเอียด" optional>
        <TextArea value={form.description} onChange={set('description')} rows={2} />
      </Field>
      {!isNew && (
        <RadioGroup
          legend="สถานะ"
          name="market_status"
          value={form.status}
          onChange={set('status')}
          options={STATUS_OPTIONS}
          hint="ตลาดที่ระงับจะไม่แสดงในหน้าภาพรวมและหน้าแผงค้า (ข้อมูลยังอยู่ครบ)"
        />
      )}
    </FormModal>
  )
}

// ---------------------------------------------------------------------
// พร้อมเพย์ของตลาด (ใช้สร้าง QR ในใบแจ้งหนี้)
// ---------------------------------------------------------------------
export function PromptPayDialog({ market, onClose, onSaved }) {
  const state = useFormState({ promptpay_id: market.promptpay_id ?? '', promptpay_name: market.promptpay_name ?? '' })
  const { form, set, errors } = state
  const id = digitsOnly(form.promptpay_id)
  const preview = id && !promptPayProblem(id)

  async function submit(e) {
    e.preventDefault()
    state.setFormError('')
    const clearing = !form.promptpay_id.trim()
    const problems = collectProblems({
      promptpay_id: clearing ? '' : promptPayProblem(form.promptpay_id),
      promptpay_name: clearing || form.promptpay_name.trim() ? '' : 'กรุณากรอกชื่อบัญชี (ให้ผู้เช่าตรวจก่อนโอน)',
    })
    state.setErrors(problems)
    if (Object.keys(problems).length > 0) return
    const payload = clearing ? { promptpay_id: null, promptpay_name: null } : { promptpay_id: id, promptpay_name: form.promptpay_name.trim() }
    const row = await save(state, supabase.from('markets').update(payload).eq('market_id', market.market_id).select('market_id'))
    if (row) onSaved(row.market_id, clearing ? `ลบพร้อมเพย์ของ${market.market_name}แล้ว` : `บันทึกพร้อมเพย์ของ${market.market_name}แล้ว`)
  }

  return (
    <FormModal title="พร้อมเพย์สำหรับรับชำระ" subtitle={market.market_name} onClose={onClose} onSubmit={submit} state={state} submitLabel="บันทึก">
      <Field
        label="เลขพร้อมเพย์"
        error={errors.promptpay_id}
        hint="เบอร์มือถือ 10 หลัก หรือเลขประจำตัวผู้เสียภาษี 13 หลัก (หน่วยงาน/นิติบุคคล) · เว้นว่างแล้วบันทึก = เลิกใช้ QR"
      >
        <TextInput value={form.promptpay_id} onChange={set('promptpay_id')} inputMode="numeric" autoComplete="off" maxLength={17} />
      </Field>
      <Field label="ชื่อบัญชี" error={errors.promptpay_name} hint="ต้องตรงกับชื่อที่แอปธนาคารแสดงตอนสแกน">
        <TextInput value={form.promptpay_name} onChange={set('promptpay_name')} maxLength={150} autoComplete="off" />
      </Field>
      {preview && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-leaf-50 p-3">
          <PromptPayQR promptpayId={id} name={form.promptpay_name.trim()} size={132} />
          <p className="min-w-0 flex-1 text-sm text-muted">
            ทดสอบก่อนบันทึก: สแกน QR นี้ด้วยแอปธนาคาร แล้วดูว่าชื่อผู้รับตรงกับบัญชีของตลาด (ไม่ต้องโอนจริง) · QR ในใบแจ้งหนี้จะใส่ยอดเงินให้อัตโนมัติ
          </p>
        </div>
      )}
    </FormModal>
  )
}

// ---------------------------------------------------------------------
// โซน
// ---------------------------------------------------------------------
export function ZoneFormDialog({ market, zone, onClose, onSaved }) {
  const isNew = !zone
  const state = useFormState({ zone_name: zone?.zone_name ?? '', description: zone?.description ?? '' })
  const { form, set, errors } = state
  const newName = form.zone_name.trim().toUpperCase()
  const renaming = !isNew && newName !== zone.zone_name

  async function submit(e) {
    e.preventDefault()
    state.setFormError('')
    const problems = collectProblems({
      zone_name: requiredProblem(form.zone_name, 'ชื่อโซน') || (/\s/.test(newName) ? 'ชื่อโซนต้องไม่มีช่องว่าง' : ''),
    })
    state.setErrors(problems)
    if (Object.keys(problems).length > 0) return
    const payload = { zone_name: newName, description: form.description.trim() || null }
    const row = await save(
      state,
      isNew
        ? supabase.from('zones').insert({ ...payload, market_id: market.market_id }).select('zone_id')
        : supabase.from('zones').update(payload).eq('zone_id', zone.zone_id).select('zone_id'),
      'zone_name',
      `${market.market_name}มีโซน ${newName} อยู่แล้ว`,
    )
    if (row) onSaved(isNew ? `เพิ่มโซน ${newName} ใน${market.market_name}แล้ว` : `บันทึกโซน ${newName} แล้ว`)
  }

  let hint = 'ใช้นำหน้ารหัสแผงที่เพิ่มใหม่ เช่น โซน C → C001, C002'
  if (renaming) {
    hint = 'รหัสแผงเดิมไม่เปลี่ยนตาม แผงที่เพิ่มใหม่จะขึ้นต้นด้วยชื่อโซนใหม่'
    if (isPlaced(market.market_name, zone.zone_name)) {
      hint += ' · ผังพื้นที่อ้างอิงชื่อโซนเดิม โซนนี้จะไปแสดงแยกท้ายหน้าภาพรวม จนกว่าจะแก้ชื่อในไฟล์ siteLayouts.js'
    }
  }

  return (
    <FormModal
      title={isNew ? 'เพิ่มโซน' : `แก้ไขโซน ${zone.zone_name}`}
      subtitle={market.market_name}
      onClose={onClose}
      onSubmit={submit}
      state={state}
      submitLabel={isNew ? 'เพิ่มโซน' : 'บันทึก'}
    >
      <Field label="ชื่อโซน" hint={hint} error={errors.zone_name}>
        <TextInput value={form.zone_name} onChange={set('zone_name')} maxLength={50} autoComplete="off" className="uppercase" />
      </Field>
      <Field label="รายละเอียด" optional>
        <TextInput value={form.description} onChange={set('description')} autoComplete="off" placeholder="เช่น ริมทางเดินหลัก" />
      </Field>
    </FormModal>
  )
}

// ---------------------------------------------------------------------
// อัตราค่าน้ำ-ไฟ
// ---------------------------------------------------------------------
function dayBefore(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function RateDialog({ market, utilityType, current, upcoming = [], onClose, onSaved }) {
  const state = useFormState({ rate: '', from: firstOfNextMonth() })
  const { form, set, errors } = state
  const label = UTILITY_TYPE[utilityType]
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(form.from)
  // อัตราล่าสุด (รวมที่ตั้งล่วงหน้า) คืออัตราที่จะถูกปิดเมื่อบันทึกอัตราใหม่
  const latest = upcoming.at(-1) ?? current

  async function submit(e) {
    e.preventDefault()
    state.setFormError('')
    const problems = collectProblems({
      rate: numberProblem(form.rate, 'อัตรา', { required: true, positive: true }),
      from: validDate ? '' : 'กรุณาเลือกวันที่เริ่มใช้',
    })
    state.setErrors(problems)
    if (Object.keys(problems).length > 0) return
    state.setBusy(true)
    const rate = toNumberOrNull(form.rate)
    const { error } = await supabase.rpc('change_utility_rate', {
      p_market_id: market.market_id,
      p_utility_type: utilityType,
      p_rate: rate,
      p_effective_from: form.from,
    })
    state.setBusy(false)
    if (error) return state.setFormError(thaiError(error))
    onSaved(`ตั้งค่า${label}${market.market_name} ${formatBaht(rate)}/หน่วย เริ่ม ${formatDate(form.from)} แล้ว`)
  }

  return (
    <FormModal
      title={latest ? `เปลี่ยนอัตราค่า${label}` : `ตั้งอัตราค่า${label}`}
      subtitle={market.market_name}
      onClose={onClose}
      onSubmit={submit}
      state={state}
      submitLabel="บันทึกอัตราใหม่"
    >
      {current && (
        <p className="text-ink">
          อัตราปัจจุบัน <span className="font-semibold">{formatBaht(current.rate_per_unit)}/หน่วย</span>
          <span className="text-muted"> ใช้ตั้งแต่ {formatDate(current.effective_from)}</span>
        </p>
      )}
      {upcoming.map((r) => (
        <p key={r.rate_id} className="rounded-lg bg-stall-reserved/60 px-3 py-1.5 text-sm text-stall-reserved-ink">
          ตั้งไว้ล่วงหน้าแล้ว {formatBaht(r.rate_per_unit)}/หน่วย เริ่ม {formatDate(r.effective_from)} — วันเริ่มใช้อัตราใหม่ต้องอยู่หลังวันนี้
        </p>
      ))}
      <Field label="อัตราใหม่ (บาทต่อหน่วย)" error={errors.rate}>
        <TextInput value={form.rate} onChange={set('rate')} inputMode="decimal" autoComplete="off" placeholder="เช่น 6" />
      </Field>
      <Field
        label="วันที่เริ่มใช้"
        error={errors.from}
        hint={
          validDate
            ? `${formatDate(form.from, { long: true })}${latest ? ` · อัตรา ${formatBaht(latest.rate_per_unit)} เดิมใช้ถึง ${formatDate(dayBefore(form.from))}` : ''}`
            : undefined
        }
      >
        <TextInput type="date" value={form.from} onChange={set('from')} />
      </Field>
      <p className="rounded-lg bg-leaf-50 px-3 py-2 text-sm text-muted">
        ใบแจ้งหนี้ที่ออกไปแล้วไม่เปลี่ยนตาม ประวัติอัตราเดิมยังเก็บไว้ครบ
      </p>
    </FormModal>
  )
}

// ---------------------------------------------------------------------
// ค่าธรรมเนียม
// ---------------------------------------------------------------------
export function FeeFormDialog({ market, fee, onClose, onSaved }) {
  const isNew = !fee
  const state = useFormState({
    fee_name: fee?.fee_name ?? '',
    fee_amount: fee ? String(Number(fee.fee_amount)) : '',
    fee_period: fee?.fee_period ?? 'monthly',
    status: fee?.status ?? 'active',
  })
  const { form, set, errors } = state

  async function submit(e) {
    e.preventDefault()
    state.setFormError('')
    const problems = collectProblems({
      fee_name: requiredProblem(form.fee_name, 'ชื่อค่าธรรมเนียม'),
      fee_amount: numberProblem(form.fee_amount, 'จำนวนเงิน', { required: true }),
    })
    state.setErrors(problems)
    if (Object.keys(problems).length > 0) return
    const payload = {
      fee_name: form.fee_name.trim(),
      fee_amount: toNumberOrNull(form.fee_amount),
      fee_period: form.fee_period,
      ...(isNew ? { market_id: market.market_id } : { status: form.status }),
    }
    const row = await save(
      state,
      isNew
        ? supabase.from('fees').insert(payload).select('fee_id')
        : supabase.from('fees').update(payload).eq('fee_id', fee.fee_id).select('fee_id'),
    )
    if (row) onSaved(isNew ? `เพิ่ม${payload.fee_name}แล้ว` : `บันทึก${payload.fee_name}แล้ว`)
  }

  return (
    <FormModal
      title={isNew ? 'เพิ่มค่าธรรมเนียม' : 'แก้ไขค่าธรรมเนียม'}
      subtitle={market.market_name}
      onClose={onClose}
      onSubmit={submit}
      state={state}
      submitLabel={isNew ? 'เพิ่มค่าธรรมเนียม' : 'บันทึก'}
    >
      <Field label="ชื่อค่าธรรมเนียม" error={errors.fee_name}>
        <TextInput value={form.fee_name} onChange={set('fee_name')} maxLength={100} autoComplete="off" placeholder="เช่น ค่าเก็บขยะ" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="จำนวนเงิน (บาท)" error={errors.fee_amount}>
          <TextInput value={form.fee_amount} onChange={set('fee_amount')} inputMode="decimal" autoComplete="off" />
        </Field>
        <Field label="เรียกเก็บ">
          <SelectInput value={form.fee_period} onChange={set('fee_period')}>
            {Object.entries(FEE_PERIOD).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      {!isNew && (
        <RadioGroup
          legend="สถานะ"
          name="fee_status"
          value={form.status}
          onChange={set('status')}
          options={STATUS_OPTIONS}
          hint="ค่าธรรมเนียมที่ระงับจะไม่ถูกรวมในใบแจ้งหนี้ใหม่"
        />
      )}
    </FormModal>
  )
}
