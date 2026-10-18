import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { thaiError } from '../../lib/errors'
import { callAdminUsers, randomPassword } from '../../lib/adminUsers'
import { ROLE } from '../../lib/labels'
import { clearProblem, collectProblems, digitsOnly, emailProblem, phoneProblem, requiredProblem } from '../../lib/validate'
import Modal, { ModalSection } from '../ui/Modal'
import { Button, Field, FormActions, FormError, RadioGroup, SelectInput, TextInput } from '../ui/form'

const ROLE_HELP = {
  admin: 'จัดการได้ทุกอย่าง รวมถึงตลาด อัตราค่าบริการ และบัญชีผู้ใช้',
  staff: 'งานประจำวัน: แผง ผู้เช่า สัญญา มิเตอร์ ใบแจ้งหนี้ ตรวจชำระเงิน',
  manager: 'ดูข้อมูลและรายงานได้อย่างเดียว',
}

// ส่ง props ที่เหลือ (id, aria-*) ต่อให้ select เพื่อให้ป้ายชื่อจาก Field ผูกกับช่องได้
function RoleSelect(props) {
  return (
    <SelectInput {...props}>
      {Object.entries(ROLE).map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </SelectInput>
  )
}

/** ช่องรหัสผ่าน + ปุ่มสุ่ม (แสดงตัวอักษรให้เห็น เพื่อคัดลอกไปแจ้งเจ้าของบัญชี) */
function PasswordField({ value, onChange, error, label = 'รหัสผ่านชั่วคราว' }) {
  return (
    <Field label={label} hint="อย่างน้อย 8 ตัวอักษร แจ้งเจ้าของบัญชีเป็นการส่วนตัว" error={error}>
      <TextInputWithButton value={value} onChange={onChange} onGenerate={() => onChange({ target: { value: randomPassword() } })} />
    </Field>
  )
}

function TextInputWithButton({ onGenerate, ...props }) {
  return (
    <div className="flex gap-2">
      <TextInput {...props} autoComplete="new-password" spellCheck={false} className="font-mono" />
      <Button onClick={onGenerate}>สุ่ม</Button>
    </div>
  )
}

function FormModal({ title, subtitle, onClose, onSubmit, busy, formError, submitLabel, children }) {
  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      onSubmit={onSubmit}
      busy={busy}
      initialFocus="field"
      closeOnBackdrop={false}
      footer={
        <>
          <FormError>{formError}</FormError>
          <FormActions onCancel={onClose} busy={busy} submitLabel={submitLabel} />
        </>
      }
    >
      <ModalSection>
        <div className="space-y-4">{children}</div>
      </ModalSection>
    </Modal>
  )
}

// ---------------------------------------------------------------------
// เพิ่มบัญชีเจ้าหน้าที่ (ผ่าน Edge Function เพราะต้องสร้างบัญชีใน Supabase Auth ด้วย)
// ---------------------------------------------------------------------
export function UserCreateDialog({ onClose, onSaved }) {
  const [form, setForm] = useState({ full_name: '', username: '', email: '', password: randomPassword(), role: 'staff', phone: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
    setErrors(clearProblem(key))
  }

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    const problems = collectProblems({
      full_name: requiredProblem(form.full_name, 'ชื่อ-นามสกุล'),
      username: requiredProblem(form.username, 'ชื่อผู้ใช้') || (/\s/.test(form.username.trim()) ? 'ชื่อผู้ใช้ต้องไม่มีช่องว่าง' : ''),
      email: emailProblem(form.email),
      password: form.password.length < 8 ? 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' : '',
      phone: phoneProblem(form.phone, { required: false }),
    })
    setErrors(problems)
    if (Object.keys(problems).length > 0) return
    setBusy(true)
    try {
      await callAdminUsers({
        action: 'create',
        full_name: form.full_name.trim(),
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        phone: digitsOnly(form.phone) || null,
      })
    } catch (err) {
      setBusy(false)
      if (/อีเมล/.test(err.message)) return setErrors({ email: err.message })
      if (/ชื่อผู้ใช้/.test(err.message)) return setErrors({ username: err.message })
      return setFormError(err.message)
    }
    setBusy(false)
    onSaved({ name: form.full_name.trim(), email: form.email.trim().toLowerCase(), password: form.password })
  }

  return (
    <FormModal title="เพิ่มผู้ใช้ระบบ" onClose={onClose} onSubmit={submit} busy={busy} formError={formError} submitLabel="สร้างบัญชี">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="ชื่อ-นามสกุล" error={errors.full_name}>
          <TextInput value={form.full_name} onChange={set('full_name')} autoComplete="off" maxLength={150} />
        </Field>
        <Field label="ชื่อผู้ใช้" hint="ภาษาอังกฤษหรือตัวเลข ไม่ซ้ำกัน" error={errors.username}>
          <TextInput value={form.username} onChange={set('username')} autoComplete="off" maxLength={100} spellCheck={false} />
        </Field>
        <Field label="อีเมล (ใช้เข้าสู่ระบบ)" error={errors.email} className="sm:col-span-2">
          <TextInput type="email" value={form.email} onChange={set('email')} autoComplete="off" spellCheck={false} />
        </Field>
        <div className="sm:col-span-2">
          <PasswordField value={form.password} onChange={set('password')} error={errors.password} />
        </div>
        <Field label="บทบาท" hint={ROLE_HELP[form.role]}>
          <RoleSelect value={form.role} onChange={set('role')} />
        </Field>
        <Field label="เบอร์โทร" optional error={errors.phone}>
          <TextInput value={form.phone} onChange={set('phone')} inputMode="tel" autoComplete="off" maxLength={20} />
        </Field>
      </div>
    </FormModal>
  )
}

// ---------------------------------------------------------------------
// แก้ไขบัญชี (ตาราง users โดยตรง — RLS อนุญาตเฉพาะ admin)
// ---------------------------------------------------------------------
export function UserEditDialog({ user, isSelf, onClose, onSaved }) {
  const [form, setForm] = useState({
    full_name: user.full_name ?? '',
    username: user.username ?? '',
    phone: user.phone ?? '',
    role: user.role,
    status: user.status,
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e?.target ? e.target.value : e }))
    setErrors(clearProblem(key))
  }

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    const problems = collectProblems({
      full_name: requiredProblem(form.full_name, 'ชื่อ-นามสกุล'),
      username: requiredProblem(form.username, 'ชื่อผู้ใช้') || (/\s/.test(form.username.trim()) ? 'ชื่อผู้ใช้ต้องไม่มีช่องว่าง' : ''),
      phone: phoneProblem(form.phone, { required: false }),
    })
    setErrors(problems)
    if (Object.keys(problems).length > 0) return
    const payload = {
      full_name: form.full_name.trim(),
      username: form.username.trim(),
      phone: digitsOnly(form.phone) || null,
      // บัญชีตัวเอง: ไม่ส่งบทบาท/สถานะ กันล็อกตัวเองออกจากระบบ
      ...(isSelf ? {} : { role: form.role, status: form.status }),
    }
    setBusy(true)
    const { data, error } = await supabase.from('users').update(payload).eq('user_id', user.user_id).select('user_id')
    setBusy(false)
    if (error) {
      if (error.code === '23505') return setErrors({ username: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' })
      return setFormError(thaiError(error))
    }
    if (!data?.length) return setFormError('บันทึกไม่สำเร็จ เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขบัญชีได้')
    onSaved(`บันทึกบัญชี ${payload.full_name} แล้ว`)
  }

  return (
    <FormModal
      title="แก้ไขบัญชีผู้ใช้"
      subtitle={user.email ?? user.username}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      formError={formError}
      submitLabel="บันทึก"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="ชื่อ-นามสกุล" error={errors.full_name}>
          <TextInput value={form.full_name} onChange={set('full_name')} autoComplete="off" maxLength={150} />
        </Field>
        <Field label="ชื่อผู้ใช้" error={errors.username}>
          <TextInput value={form.username} onChange={set('username')} autoComplete="off" maxLength={100} spellCheck={false} />
        </Field>
        <Field label="เบอร์โทร" optional error={errors.phone}>
          <TextInput value={form.phone} onChange={set('phone')} inputMode="tel" autoComplete="off" maxLength={20} />
        </Field>
        <Field
          label="บทบาท"
          hint={isSelf ? 'เปลี่ยนบทบาทของตัวเองไม่ได้ ให้ผู้ดูแลระบบคนอื่นเปลี่ยนให้' : ROLE_HELP[form.role]}
        >
          <RoleSelect value={form.role} onChange={set('role')} disabled={isSelf} />
        </Field>
      </div>
      {!isSelf && (
        <RadioGroup
          legend="สถานะบัญชี"
          name="user_status"
          value={form.status}
          onChange={set('status')}
          options={[
            { value: 'active', label: 'ใช้งาน' },
            { value: 'inactive', label: 'ระงับ (เข้าสู่ระบบแล้วใช้งานไม่ได้)' },
          ]}
        />
      )}
      <p className="text-sm text-muted">อีเมลที่ใช้เข้าสู่ระบบแก้ไขในหน้านี้ไม่ได้ ถ้าต้องเปลี่ยนให้สร้างบัญชีใหม่แล้วระงับบัญชีเดิม</p>
    </FormModal>
  )
}

// ---------------------------------------------------------------------
// ตั้งรหัสผ่านใหม่ (ผ่าน Edge Function)
// ---------------------------------------------------------------------
export function PasswordDialog({ user, onClose, onSaved }) {
  const [password, setPassword] = useState(randomPassword())
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    const problem = password.length < 8 ? 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' : ''
    setError(problem)
    if (problem) return
    setBusy(true)
    try {
      await callAdminUsers({ action: 'set_password', user_id: user.user_id, password })
    } catch (err) {
      setBusy(false)
      return setFormError(err.message)
    }
    setBusy(false)
    onSaved({ name: user.full_name, email: user.email, password })
  }

  return (
    <FormModal
      title="ตั้งรหัสผ่านใหม่"
      subtitle={`${user.full_name} (${user.email ?? user.username})`}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      formError={formError}
      submitLabel="ตั้งรหัสผ่าน"
    >
      <PasswordField
        label="รหัสผ่านใหม่"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value)
          setError('')
        }}
        error={error}
      />
    </FormModal>
  )
}
