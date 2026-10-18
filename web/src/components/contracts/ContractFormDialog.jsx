import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { thaiError } from '../../lib/errors'
import { compareThai, formatBaht, formatDate, formatPhone, todayISO } from '../../lib/format'
import { RENT_PERIOD } from '../../lib/labels'
import { addDays, contractProblem, defaultEndDate, isISODate, termLabel, TERM_YEARS } from '../../lib/contracts'
import { stallPlace, stallTitle } from '../../lib/stalls'
import { useLoader } from '../../lib/useLoader'
import { clearProblem, collectProblems, digitsOnly, numberProblem, toNumberOrNull } from '../../lib/validate'
import Modal, { ModalSection } from '../ui/Modal'
import { Field, FormActions, FormError, RadioGroup, SelectInput, TextArea, TextInput } from '../ui/form'

const PER = { monthly: 'เดือน', yearly: 'ปี' }
const NOTE_MAX = 500

const TITLE = { new: 'ทำสัญญาเช่าใหม่', approve: 'อนุมัติคำขอเช่า', renew: 'ต่ออายุสัญญา', edit: 'แก้ไขสัญญา' }
const SUBMIT = { new: 'ทำสัญญา', approve: 'อนุมัติสัญญา', renew: 'ส่งคำขอต่ออายุ', edit: 'บันทึก' }

/** ผู้เช่าที่ใช้งานอยู่ + แผงว่าง (ใช้เฉพาะตอนทำสัญญาใหม่) */
async function fetchChoices() {
  const [tenants, stalls] = await Promise.all([
    supabase.from('tenants').select('tenant_id, full_name, business_name, phone').eq('status', 'active'),
    supabase
      .from('stalls')
      .select('stall_id, stall_code, unit_type, base_rent, rent_period, status, zones(zone_name, markets(market_id, market_name, status))')
      .order('stall_code'),
  ])
  if (tenants.error) throw tenants.error
  if (stalls.error) throw stalls.error
  return {
    tenants: tenants.data.sort((a, b) => compareThai(a.full_name, b.full_name)),
    stalls: stalls.data.filter((s) => s.zones?.markets?.status !== 'inactive'),
  }
}

/** เลือกผู้เช่า: ช่องค้นหา + รายการให้กดเลือก */
function TenantPicker({ tenants, value, onChange, error }) {
  const [query, setQuery] = useState('')
  const text = query.trim().toLowerCase()
  const digits = digitsOnly(query)
  const list = tenants.filter(
    (t) =>
      !text ||
      t.full_name.toLowerCase().includes(text) ||
      t.business_name?.toLowerCase().includes(text) ||
      (digits.length >= 3 && digitsOnly(t.phone).includes(digits)),
  )
  const selected = tenants.find((t) => t.tenant_id === value)
  return (
    <fieldset className="sm:col-span-2">
      <legend className="mb-1 font-medium text-ink">ผู้เช่า</legend>
      <TextInput
        type="search"
        aria-label="ค้นหาผู้เช่า"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="พิมพ์ชื่อ ร้าน หรือเบอร์โทรเพื่อค้นหา"
      />
      <div
        className={`mt-2 max-h-48 overflow-y-auto rounded-lg border ${error ? 'border-danger' : 'border-line'}`}
        role="radiogroup"
        aria-label="รายชื่อผู้เช่า"
      >
        {list.length === 0 && <p className="px-3 py-2 text-muted">ไม่พบผู้เช่าที่ตรงกับคำค้น</p>}
        {list.map((t) => (
          <label
            key={t.tenant_id}
            className={`flex cursor-pointer items-start gap-2.5 border-b border-line px-3 py-2 last:border-b-0 ${
              t.tenant_id === value ? 'bg-leaf-100' : 'hover:bg-leaf-50'
            }`}
          >
            <input
              type="radio"
              name="tenant"
              className="mt-1.5 h-4 w-4 accent-leaf-700"
              checked={t.tenant_id === value}
              onChange={() => onChange(t.tenant_id)}
            />
            <span>
              <span className="font-medium text-ink">{t.full_name}</span>
              <span className="block text-sm text-muted">
                {[t.business_name, formatPhone(t.phone)].filter((v) => v && v !== '-').join(' · ')}
              </span>
            </span>
          </label>
        ))}
      </div>
      {error && <p className="mt-1 text-sm font-medium text-danger">{error}</p>}
      <p className="mt-1 text-sm text-muted">
        {selected ? `เลือก: ${selected.full_name}` : 'แสดงเฉพาะผู้เช่าที่ใช้งานอยู่'} · ยังไม่มีในระบบ?{' '}
        <Link to="/admin/tenants" className="font-medium text-leaf-700 hover:underline">
          เพิ่มที่หน้าผู้เช่า
        </Link>
      </p>
    </fieldset>
  )
}

function initialValues(mode, contract, stall) {
  const today = todayISO()
  const asText = (v) => (v === null || v === undefined ? '' : String(Number(v)))
  if (mode === 'new') {
    const period = stall?.rent_period ?? 'monthly'
    return { start: today, end: defaultEndDate(today, period), period, rent: asText(stall?.base_rent), deposit: '', note: '', endAuto: true }
  }
  if (mode === 'renew') {
    const start = addDays(contract.end_date, 1)
    const period = contract.stalls?.rent_period ?? contract.rent_period
    const rent = contract.stalls?.base_rent ?? contract.rent_amount
    return { start, end: defaultEndDate(start, period), period, rent: asText(rent), deposit: asText(contract.deposit_amount), note: '', endAuto: true }
  }
  // approve / edit: ใช้ค่าในสัญญา (คำขอจากผู้เช่าใช้ค่าเช่าตามแผง ถ้าแผงยังไม่กำหนดจะเป็น 0)
  return {
    start: contract.start_date,
    end: contract.end_date,
    period: contract.rent_period,
    rent: asText(contract.rent_amount),
    deposit: asText(contract.deposit_amount),
    note: contract.note ?? '',
    endAuto: false,
  }
}

/**
 * ฟอร์มสัญญา 4 แบบ
 * - new     : ทำสัญญาที่สำนักงาน (เลือกผู้เช่า + แผงว่าง) → ใช้งานทันที
 * - approve : อนุมัติคำขอ (แก้วันที่/ค่าเช่า/เงินประกันก่อนอนุมัติได้)
 * - renew   : ต่ออายุ → สร้างคำขอรออนุมัติ เริ่มวันถัดจากวันสิ้นสุดเดิม
 * - edit    : แก้สัญญาที่รออนุมัติหรือใช้งานอยู่
 */
export default function ContractFormDialog({ mode, contract, presetStallId, presetTenantId, onClose, onSaved }) {
  const isNew = mode === 'new'
  const choices = useLoader(() => (isNew ? fetchChoices() : Promise.resolve(null)), `choices:${mode}`)
  const [tenantId, setTenantId] = useState(presetTenantId ?? null)
  const [stallId, setStallId] = useState(presetStallId ?? null)
  const [form, setForm] = useState(() => initialValues(mode, contract, null))
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const stalls = choices.data?.stalls ?? []
  const vacant = stalls.filter((s) => s.status === 'vacant')
  const stall = isNew ? stalls.find((s) => s.stall_id === stallId) : contract.stalls
  const presetStall = isNew && presetStallId ? stalls.find((s) => s.stall_id === presetStallId) : null
  const presetBusy = presetStall && presetStall.status !== 'vacant'

  // ค่าตั้งต้นของแผงที่ส่งมาจากหน้าต่างแผง: ใส่ให้ครั้งเดียวตอนโหลดรายชื่อแผงเสร็จ
  const [presetApplied, setPresetApplied] = useState(false)
  if (isNew && presetStall && !presetApplied) {
    setPresetApplied(true)
    if (presetStall.status === 'vacant') setForm(initialValues('new', null, presetStall))
    else setStallId(null) // แผงไม่ว่างแล้ว (มีคนทำสัญญาไปก่อน) → ให้เลือกใหม่
  }

  function setField(key, value) {
    setForm((f) => {
      const next = { ...f, [key]: value }
      if (key === 'end') next.endAuto = false
      // วันสิ้นสุดยังเป็นค่าอัตโนมัติ → คำนวณใหม่เมื่อเปลี่ยนวันเริ่มหรือรอบค่าเช่า
      if ((key === 'start' || key === 'period') && f.endAuto) next.end = defaultEndDate(next.start, next.period)
      return next
    })
    setErrors(clearProblem(key))
  }

  function chooseStall(e) {
    const id = Number(e.target.value) || null
    setStallId(id)
    setErrors(clearProblem('stall'))
    const s = stalls.find((x) => x.stall_id === id)
    if (s) {
      setForm((f) => ({
        ...f,
        period: s.rent_period,
        rent: s.base_rent === null || s.base_rent === undefined ? '' : String(Number(s.base_rent)),
        end: f.endAuto ? defaultEndDate(f.start, s.rent_period) : f.end,
      }))
    }
  }

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    const problems = collectProblems({
      tenant: isNew && !tenantId ? 'กรุณาเลือกผู้เช่า' : '',
      stall: isNew && !stallId ? 'กรุณาเลือกแผง/ห้อง' : '',
      start: !isISODate(form.start)
        ? 'กรุณาเลือกวันเริ่มสัญญา'
        : mode === 'renew' && form.start <= contract.end_date
          ? `วันเริ่มต้องอยู่หลังวันสิ้นสุดสัญญาเดิม (${formatDate(contract.end_date)})`
          : '',
      end: !isISODate(form.end) ? 'กรุณาเลือกวันสิ้นสุดสัญญา' : isISODate(form.start) && form.end <= form.start ? 'วันสิ้นสุดต้องอยู่หลังวันเริ่ม' : '',
      rent: numberProblem(form.rent, 'ค่าเช่า', { required: true }),
      deposit: numberProblem(form.deposit, 'เงินประกัน'),
      note: form.note.length > NOTE_MAX ? `หมายเหตุยาวเกิน ${NOTE_MAX} ตัวอักษร` : '',
    })
    setErrors(problems)
    if (Object.keys(problems).length > 0) return

    const fields = {
      start_date: form.start,
      end_date: form.end,
      rent_amount: toNumberOrNull(form.rent),
      rent_period: form.period,
      deposit_amount: toNumberOrNull(form.deposit),
      note: form.note.trim() || null,
    }
    const columns = 'contract_id, contract_no'
    let query
    if (mode === 'new') {
      query = supabase.from('contracts').insert({ ...fields, tenant_id: tenantId, stall_id: stallId, status: 'active' }).select(columns)
    } else if (mode === 'renew') {
      query = supabase
        .from('contracts')
        .insert({ ...fields, tenant_id: contract.tenant_id, stall_id: contract.stall_id, renewed_from_id: contract.contract_id, status: 'pending' })
        .select(columns)
    } else {
      const patch = mode === 'approve' ? { ...fields, status: 'active' } : fields
      query = supabase.from('contracts').update(patch).eq('contract_id', contract.contract_id).select(columns)
    }
    setBusy(true)
    const { data, error } = await query
    setBusy(false)
    if (error) return setFormError(contractProblem(error) ?? thaiError(error))
    if (!data?.length) return setFormError('บันทึกไม่สำเร็จ บัญชีนี้ไม่มีสิทธิ์จัดการสัญญา')
    const row = data[0]
    const text = {
      new: `ทำสัญญา ${row.contract_no} แล้ว`,
      approve: `อนุมัติ ${row.contract_no} แล้ว`,
      renew: `ส่งคำขอต่ออายุ ${row.contract_no} แล้ว รออนุมัติ`,
      edit: `บันทึก ${row.contract_no} แล้ว`,
    }[mode]
    onSaved(text, row.contract_id)
  }

  const term = termLabel(form.start, form.end)
  const zeroRent = toNumberOrNull(form.rent) === 0
  const oldRent = mode === 'renew' ? Number(contract.rent_amount) : null

  let subtitle
  if (!isNew) subtitle = `${contract.contract_no} · ${stallPlace(contract.stalls)} · ${contract.tenants?.full_name ?? ''}`

  return (
    <Modal
      title={TITLE[mode]}
      subtitle={subtitle}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      initialFocus="field"
      closeOnBackdrop={false}
      size="lg"
      footer={
        <>
          <FormError>{formError}</FormError>
          <FormActions onCancel={onClose} busy={busy || (isNew && choices.loading)} submitLabel={SUBMIT[mode]} />
        </>
      }
    >
      <ModalSection>
        {isNew && choices.error && <FormError>โหลดรายชื่อผู้เช่า/แผงไม่สำเร็จ: {choices.error}</FormError>}
        {isNew && choices.loading && !choices.data && <p className="text-muted">กำลังโหลดรายชื่อผู้เช่าและแผงว่าง…</p>}
        {(!isNew || choices.data) && (
          <div className="grid gap-4 sm:grid-cols-2">
            {isNew && (
              <>
                <TenantPicker
                  tenants={choices.data.tenants}
                  value={tenantId}
                  onChange={(id) => {
                    setTenantId(id)
                    setErrors(clearProblem('tenant'))
                  }}
                  error={errors.tenant}
                />
                {presetBusy && (
                  <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-danger sm:col-span-2">
                    {stallTitle(presetStall)} ไม่ว่างแล้ว ให้เลือกแผงอื่น
                  </p>
                )}
                <Field label="แผง/ห้องที่ว่าง" error={errors.stall} className="sm:col-span-2">
                  <SelectInput value={stallId ?? ''} onChange={chooseStall}>
                    <option value="">— เลือกแผง/ห้อง ({vacant.length} ว่าง) —</option>
                    {[...new Set(vacant.map((s) => s.zones?.markets?.market_name))].map((m) => (
                      <optgroup key={m} label={m}>
                        {vacant
                          .filter((s) => s.zones?.markets?.market_name === m)
                          .map((s) => (
                            <option key={s.stall_id} value={s.stall_id}>
                              {m} โซน {s.zones?.zone_name} · {stallTitle(s)}
                              {s.base_rent !== null && s.base_rent !== undefined ? ` · ${formatBaht(s.base_rent)}/${PER[s.rent_period]}` : ' · ยังไม่กำหนดค่าเช่า'}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </SelectInput>
                </Field>
              </>
            )}

            <Field label="วันเริ่มสัญญา" error={errors.start} hint={isISODate(form.start) ? formatDate(form.start, { long: true }) : undefined}>
              <TextInput type="date" value={form.start} onChange={(e) => setField('start', e.target.value)} />
            </Field>
            <Field
              label="วันสิ้นสุดสัญญา"
              error={errors.end}
              hint={
                isISODate(form.end)
                  ? `${formatDate(form.end, { long: true })}${term ? ` · ระยะ ${term}` : ''}${form.endAuto ? ` (ตั้งต้น ${TERM_YEARS[form.period]} ปี)` : ''}`
                  : undefined
              }
            >
              <TextInput type="date" value={form.end} onChange={(e) => setField('end', e.target.value)} />
            </Field>
            <RadioGroup
              legend="รอบค่าเช่า"
              name="contract_period"
              value={form.period}
              onChange={(v) => setField('period', v)}
              options={Object.entries(RENT_PERIOD).map(([value, label]) => ({ value, label }))}
            />
            <Field
              label={`ค่าเช่า (บาท / ${PER[form.period]})`}
              error={errors.rent}
              hint={
                zeroRent
                  ? 'ค่าเช่า 0 บาท — ตรวจอีกครั้ง (แผงนี้อาจยังไม่ได้กำหนดค่าเช่า)'
                  : oldRent !== null
                    ? `สัญญาเดิม ${formatBaht(oldRent)} / ${PER[contract.rent_period]}`
                    : stall?.base_rent !== null && stall?.base_rent !== undefined
                      ? `ค่าเช่าตั้งต้นของแผง ${formatBaht(stall.base_rent)}`
                      : undefined
              }
            >
              <TextInput value={form.rent} onChange={(e) => setField('rent', e.target.value)} inputMode="decimal" autoComplete="off" />
            </Field>
            <Field label="เงินประกัน (บาท)" optional error={errors.deposit} className="sm:col-start-2">
              <TextInput value={form.deposit} onChange={(e) => setField('deposit', e.target.value)} inputMode="decimal" autoComplete="off" />
            </Field>
            <Field
              label="หมายเหตุ"
              optional
              error={errors.note}
              hint={`${form.note.length}/${NOTE_MAX} ตัวอักษร`}
              className="sm:col-span-2"
            >
              <TextArea value={form.note} onChange={(e) => setField('note', e.target.value)} rows={2} maxLength={NOTE_MAX + 50} />
            </Field>
          </div>
        )}
        {mode === 'renew' && (
          <p className="mt-4 rounded-lg bg-leaf-50 px-3 py-2 text-sm text-muted">
            สัญญาต่ออายุจะเป็น "รออนุมัติ" ก่อน แล้วกดอนุมัติที่แท็บคำขอรออนุมัติ · สัญญาเดิมยังใช้ได้ถึง {formatDate(contract.end_date)}
          </p>
        )}
        {mode === 'edit' && contract.status === 'active' && (
          <p className="mt-4 rounded-lg bg-leaf-50 px-3 py-2 text-sm text-muted">ใบแจ้งหนี้ที่ออกไปแล้วไม่เปลี่ยนตาม ค่าใหม่ใช้กับใบแจ้งหนี้รอบถัดไป</p>
        )}
      </ModalSection>
    </Modal>
  )
}
