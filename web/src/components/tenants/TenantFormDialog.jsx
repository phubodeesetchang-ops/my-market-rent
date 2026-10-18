import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { thaiError } from '../../lib/errors'
import { maskIdCard } from '../../lib/format'
import { useLoader } from '../../lib/useLoader'
import { clearProblem, collectProblems, digitsOnly, phoneProblem, requiredProblem, thaiIdProblem } from '../../lib/validate'
import Modal, { ModalSection } from '../ui/Modal'
import { Field, FormActions, FormError, TextArea, TextInput } from '../ui/form'

const EMPTY = { full_name: '', business_name: '', phone: '', id_card: '', address: '' }

/** เลขบัตรเดิมของผู้เช่า (ใช้ตัดสินว่าต้องกรอกหรือไม่ และแสดงแบบปิดบังเป็นคำใบ้) */
async function fetchCurrentIdCard(tenantId) {
  if (!tenantId) return null
  const { data, error } = await supabase.rpc('get_tenant_id_card', { p_tenant_id: tenantId })
  if (error) throw error
  return data
}

/**
 * ฟอร์มเพิ่ม/แก้ไขผู้เช่า — ช่องที่ต้องกรอก: ชื่อ-นามสกุล, ชื่อร้าน, เบอร์โทร, เลขบัตรประชาชน, ที่อยู่
 * tenant = null คือเพิ่มใหม่ · ตอนแก้ไข เลขบัตรจะถูกบันทึกเฉพาะเมื่อกรอกเลขใหม่
 */
export default function TenantFormDialog({ tenant, onClose, onSaved }) {
  const isNew = !tenant
  const [form, setForm] = useState(() =>
    isNew
      ? EMPTY
      : {
          full_name: tenant.full_name ?? '',
          business_name: tenant.business_name ?? '',
          phone: tenant.phone ?? '',
          id_card: '',
          address: tenant.address ?? '',
        },
  )
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const current = useLoader(() => fetchCurrentIdCard(tenant?.tenant_id), tenant?.tenant_id ?? 'new')

  const hasIdCard = Boolean(current.data)
  const idRequired = isNew || (!current.loading && !current.error && !hasIdCard)
  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
    setErrors(clearProblem(key))
  }

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    const idDigits = digitsOnly(form.id_card)
    const problems = collectProblems({
      full_name: requiredProblem(form.full_name, 'ชื่อ-นามสกุล'),
      business_name: requiredProblem(form.business_name, 'ชื่อร้าน/กิจการ'),
      phone: phoneProblem(form.phone),
      id_card: idRequired || idDigits ? thaiIdProblem(form.id_card) : '',
      address: requiredProblem(form.address, 'ที่อยู่'),
    })
    setErrors(problems)
    if (Object.keys(problems).length > 0) return

    const payload = {
      full_name: form.full_name.trim(),
      business_name: form.business_name.trim(),
      phone: digitsOnly(form.phone),
      address: form.address.trim(),
    }
    if (idDigits) payload.id_card = idDigits

    setBusy(true)
    // ห้าม select('*') กับ tenants: คอลัมน์ id_card อ่านผ่าน API ไม่ได้ จึงขอคืนเฉพาะ tenant_id
    const query = isNew
      ? supabase.from('tenants').insert(payload).select('tenant_id')
      : supabase.from('tenants').update(payload).eq('tenant_id', tenant.tenant_id).select('tenant_id')
    const { data, error } = await query
    setBusy(false)
    if (error) {
      if (error.code === '23505' && /id_card/.test(error.message + (error.details ?? ''))) {
        return setErrors({ id_card: 'เลขบัตรประชาชนนี้มีผู้เช่าในระบบแล้ว ลองค้นหาจากชื่อหรือเบอร์โทร' })
      }
      return setFormError(thaiError(error))
    }
    if (!data?.length) return setFormError('บันทึกไม่สำเร็จ บัญชีนี้ไม่มีสิทธิ์แก้ไขข้อมูลผู้เช่า')
    onSaved(data[0].tenant_id, isNew, payload.full_name)
  }

  let idHint = 'ตัวเลข 13 หลัก ใส่ขีดหรือไม่ใส่ก็ได้'
  if (!isNew) {
    if (current.loading) idHint = 'กำลังตรวจเลขบัตรเดิม…'
    else if (current.error) idHint = `ตรวจเลขบัตรเดิมไม่ได้ (${current.error}) กรอกเฉพาะเมื่อต้องการเปลี่ยน`
    else if (hasIdCard) idHint = `เลขปัจจุบัน ${maskIdCard(current.data)} — เว้นว่างไว้ถ้าไม่เปลี่ยน`
    else idHint = 'ผู้เช่ารายนี้ยังไม่มีเลขบัตรในระบบ กรุณากรอก'
  }

  return (
    <Modal
      title={isNew ? 'เพิ่มผู้เช่า' : 'แก้ไขข้อมูลผู้เช่า'}
      subtitle={isNew ? undefined : tenant.full_name}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      initialFocus="field"
      closeOnBackdrop={false}
      size="lg"
      footer={
        <>
          <FormError>{formError}</FormError>
          <FormActions onCancel={onClose} busy={busy || (!isNew && current.loading)} submitLabel={isNew ? 'เพิ่มผู้เช่า' : 'บันทึก'} />
        </>
      }
    >
      <ModalSection>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ชื่อ-นามสกุล" error={errors.full_name}>
            <TextInput value={form.full_name} onChange={set('full_name')} autoComplete="off" maxLength={150} />
          </Field>
          <Field label="ชื่อร้าน/กิจการ" error={errors.business_name}>
            <TextInput value={form.business_name} onChange={set('business_name')} autoComplete="off" maxLength={150} />
          </Field>
          <Field label="เบอร์โทร" hint="มือถือ 10 หลัก หรือเบอร์บ้าน 9 หลัก" error={errors.phone}>
            <TextInput value={form.phone} onChange={set('phone')} inputMode="tel" autoComplete="off" maxLength={20} placeholder="0812345678" />
          </Field>
          <Field label="เลขบัตรประชาชน" optional={!idRequired} hint={idHint} error={errors.id_card}>
            <TextInput
              value={form.id_card}
              onChange={set('id_card')}
              inputMode="numeric"
              autoComplete="off"
              maxLength={17}
              placeholder={isNew ? '1234567890123' : 'กรอกเฉพาะเมื่อต้องการเปลี่ยน'}
            />
          </Field>
          <Field label="ที่อยู่" error={errors.address} className="sm:col-span-2">
            <TextArea value={form.address} onChange={set('address')} rows={3} />
          </Field>
        </div>
      </ModalSection>
    </Modal>
  )
}
